/**
 * FatSecret Retrieval Lane (Phase 1, Jul 2026)
 *
 * On cache miss, fatsecret Premier candidates compete in rerank alongside
 * OFF/FDC. Every hit is persisted locally (FatSecretFood/FatSecretServing)
 * fire-and-forget, so cache hits never touch the external API.
 *
 * Kill-switch: FATSECRET_RETRIEVAL_ENABLED (default OFF) — the lane is a
 * silent no-op unless enabled. FAIL-OPEN: any client error (timeouts, 429
 * FatSecretRateLimitError, auth) collapses to an empty lane; the gather
 * boundary's Promise.allSettled stays isolated either way.
 */

import { prisma } from '../db';
import { logger } from '../logger';
import {
    FATSECRET_RETRIEVAL_ENABLED,
    FATSECRET_LANE_TIMEOUT_MS,
    FATSECRET_LANE_MAX_RESULTS,
    FATSECRET_CLIENT_ID,
    FATSECRET_CLIENT_SECRET,
} from './config';
import {
    FatSecretClient,
    type FatSecretFoodSummary,
    type FatSecretServing as FatSecretApiServing,
} from './client';
import type { UnifiedCandidate } from './gather-candidates';
import { registerBackgroundTask } from './deferred-hydration';

// ============================================================
// Client Singleton (lazy; unit tests inject their own)
// ============================================================

/** Minimal surface the lane needs — lets tests inject a plain mock. */
export type FatSecretLaneClient = Pick<FatSecretClient, 'searchFoodsV4'>;

// undefined = not yet initialized; null = credentials missing (lane disabled)
let clientSingleton: FatSecretLaneClient | null | undefined;

function getClient(): FatSecretLaneClient | null {
    if (clientSingleton !== undefined) return clientSingleton;
    if (!FATSECRET_CLIENT_ID || !FATSECRET_CLIENT_SECRET) {
        clientSingleton = null;
        return null;
    }
    clientSingleton = new FatSecretClient();
    return clientSingleton;
}

/** Test seam: override (or reset with undefined) the module-level singleton. */
export function __setFatSecretLaneClientForTests(
    client: FatSecretLaneClient | null | undefined
): void {
    clientSingleton = client;
}

// ============================================================
// Per-100g Derivation
// ============================================================

/**
 * Per-100g nutrient object persisted on FatSecretFood.nutrientsPer100g.
 * Key names deliberately match the OffFood.nutrientsPer100g convention
 * (ingest-off.ts / extractAndValidateNutrients): `calories` (not kcal),
 * `sugars` (plural), `sodium` in GRAMS per 100g (fatsecret reports mg —
 * converted here so corpus-wide sodium checks stay unit-consistent).
 */
export interface FsNutrientsPer100g {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber?: number;
    sugars?: number;
    sodium?: number;
    saturatedFat?: number;
}

/** Usable gram weight of a serving, or null. */
function servingGramsOf(s: FatSecretApiServing): number | null {
    if (
        s.metricServingUnit?.toLowerCase() === 'g' &&
        typeof s.metricServingAmount === 'number' &&
        Number.isFinite(s.metricServingAmount) &&
        s.metricServingAmount > 0
    ) {
        return s.metricServingAmount;
    }
    if (
        typeof s.servingWeightGrams === 'number' &&
        Number.isFinite(s.servingWeightGrams) &&
        s.servingWeightGrams > 0
    ) {
        return s.servingWeightGrams;
    }
    return null;
}

function servingVolumeMlOf(s: FatSecretApiServing): number | null {
    if (
        s.metricServingUnit?.toLowerCase() === 'ml' &&
        typeof s.metricServingAmount === 'number' &&
        Number.isFinite(s.metricServingAmount) &&
        s.metricServingAmount > 0
    ) {
        return s.metricServingAmount;
    }
    return null;
}

function round2(v: number): number {
    return Math.round(v * 100) / 100;
}

/**
 * Derive per-100g nutrition from a fatsecret inline servings array.
 * Preference order:
 *   1. A metric serving of exactly 100 g that carries calories.
 *   2. The serving with the LARGEST usable gram weight that carries
 *      calories, scaled to 100g (larger servings minimize rounding error).
 * Returns null when no serving has usable grams + calories (the candidate
 * is still emitted with nutrition undefined — rerank tolerates that, same
 * as OFF rows without nutrientsPer100g).
 */
export function derivePer100gFromServings(
    servings: FatSecretApiServing[] | undefined | null
): FsNutrientsPer100g | null {
    if (!servings || servings.length === 0) return null;

    let chosen: FatSecretApiServing | null = null;
    let chosenGrams = 0;

    for (const s of servings) {
        if (s.calories == null) continue;
        if (
            s.metricServingUnit?.toLowerCase() === 'g' &&
            s.metricServingAmount === 100
        ) {
            chosen = s;
            chosenGrams = 100;
            break; // exact per-100g panel — done
        }
        const grams = servingGramsOf(s);
        if (grams != null && grams > chosenGrams) {
            chosen = s;
            chosenGrams = grams;
        }
    }

    if (!chosen || !(chosenGrams > 0)) return null; // zero/null-division guard

    const factor = 100 / chosenGrams;
    const scale = (v: number | null | undefined): number | undefined =>
        typeof v === 'number' && Number.isFinite(v) ? round2(v * factor) : undefined;

    const per100: FsNutrientsPer100g = {
        calories: scale(chosen.calories) ?? 0,
        protein: scale(chosen.protein) ?? 0,
        carbs: scale(chosen.carbohydrate) ?? 0,
        fat: scale(chosen.fat) ?? 0,
    };

    const fiber = scale(chosen.fiber);
    if (fiber !== undefined) per100.fiber = fiber;
    const sugars = scale(chosen.sugar);
    if (sugars !== undefined) per100.sugars = sugars;
    // fatsecret sodium is mg per serving; OffFood convention stores grams.
    if (typeof chosen.sodium === 'number' && Number.isFinite(chosen.sodium)) {
        per100.sodium = Math.round(chosen.sodium * factor) / 1000;
    }
    const saturatedFat = scale(chosen.saturatedFat);
    if (saturatedFat !== undefined) per100.saturatedFat = saturatedFat;

    return per100;
}

// ============================================================
// Candidate Mapping
// ============================================================

/** Position-rank score on the FDC-style 0-1 scale (rerank clamps at 1). */
function positionScore(index: number): number {
    return Math.max(0.5, 1 - index * 0.06);
}

function toUnifiedCandidate(hit: FatSecretFoodSummary, index: number): UnifiedCandidate {
    const per100 = derivePer100gFromServings(hit.servings);

    const servings = (hit.servings ?? [])
        .map(s => ({
            description: (s.description ?? s.measurementDescription ?? '').trim(),
            grams: servingGramsOf(s),
        }))
        .filter((s): s is { description: string; grams: number } =>
            Boolean(s.description) && s.grams != null
        );

    return {
        id: `fs_${hit.id}`,
        source: 'fatsecret',
        name: hit.name,
        brandName: hit.brandName ?? null,
        score: positionScore(index),
        foodType: hit.foodType ?? undefined,
        nutrition: per100
            ? {
                  kcal: per100.calories,
                  protein: per100.protein,
                  carbs: per100.carbs,
                  fat: per100.fat,
                  per100g: true,
              }
            : undefined,
        servings: servings.length > 0 ? servings : undefined,
        rawData: {
            fsId: hit.id,
            nutrientsPer100g: per100,
            servings: hit.servings ?? [],
            summary: hit,
        },
    };
}

// ============================================================
// Persistence (fire-and-forget, drainable)
// ============================================================

const SERVING_NUTRIENT_FIELDS = [
    'calories',
    'carbohydrate',
    'protein',
    'fat',
    'saturatedFat',
    'polyunsaturatedFat',
    'monounsaturatedFat',
    'transFat',
    'cholesterol',
    'sodium',
    'potassium',
    'fiber',
    'sugar',
] as const;

/** Raw per-serving macro fields (client-normalized names, unconverted units). */
function rawServingNutrients(s: FatSecretApiServing): Record<string, number> | null {
    const out: Record<string, number> = {};
    for (const field of SERVING_NUTRIENT_FIELDS) {
        const v = s[field];
        if (typeof v === 'number' && Number.isFinite(v)) out[field] = v;
    }
    return Object.keys(out).length > 0 ? out : null;
}

/**
 * Upsert search hits into FatSecretFood/FatSecretServing. Called
 * fire-and-forget from the lane (registered with the deferred-hydration
 * drain so scripts can await it before prisma.$disconnect()), but exported
 * + awaitable for tests and batch warmers. Never throws: per-hit failures
 * are logged and skipped.
 */
export async function persistFatSecretHits(hits: FatSecretFoodSummary[]): Promise<void> {
    const fetchedAt = new Date();

    for (const hit of hits) {
        try {
            const per100 = derivePer100gFromServings(hit.servings);
            const defaultServingId = hit.servings?.[0]?.id ?? null;

            const foodData = {
                name: hit.name,
                brandName: hit.brandName ?? null,
                foodType: hit.foodType ?? null,
                nutrientsPer100g: (per100 ?? {}) as object,
                defaultServingId,
                fetchedAt,
            };

            await prisma.fatSecretFood.upsert({
                where: { fsId: hit.id },
                create: { fsId: hit.id, ...foodData },
                update: foodData,
            });

            for (const s of hit.servings ?? []) {
                if (!s.id) continue;
                const description = (s.description ?? s.measurementDescription ?? '').trim();
                if (!description) continue;

                const nutrients = rawServingNutrients(s);
                const servingData = {
                    description,
                    measurementDescription: s.measurementDescription ?? null,
                    grams: servingGramsOf(s),
                    volumeMl: servingVolumeMlOf(s),
                    numberOfUnits: s.numberOfUnits ?? null,
                    // omit when null: Json? columns reject plain JS null writes
                    ...(nutrients ? { nutrients: nutrients as object } : {}),
                };

                await prisma.fatSecretServing.upsert({
                    where: { fsId_servingId: { fsId: hit.id, servingId: s.id } },
                    create: { fsId: hit.id, servingId: s.id, ...servingData },
                    update: servingData,
                });
            }
        } catch (err) {
            logger.warn('fatsecret_lane.persist_failed', {
                fsId: hit.id,
                error: (err as Error).message,
            });
        }
    }
}

// ============================================================
// Lane Entry Point
// ============================================================

/**
 * Search fatsecret and shape hits as UnifiedCandidates for the gather pool.
 *
 * - No-op ([]): flag off, blank query, or missing credentials.
 * - FAIL-OPEN: any client error (incl. FatSecretRateLimitError) → one warn
 *   log, empty lane.
 * - Persists hits fire-and-forget (drainable via
 *   drainPendingBackgroundTasks()).
 *
 * @param injectedClient - unit-test seam; production callers omit it.
 */
export async function searchFatSecretLane(
    query: string,
    limit?: number,
    injectedClient?: FatSecretLaneClient
): Promise<UnifiedCandidate[]> {
    if (!FATSECRET_RETRIEVAL_ENABLED) return [];

    const trimmed = query?.trim();
    if (!trimmed) return [];

    const client = injectedClient ?? getClient();
    if (!client) return []; // credentials missing

    try {
        const maxResults = Math.min(limit ?? FATSECRET_LANE_MAX_RESULTS, 10);
        const hits = await client.searchFoodsV4(trimmed, {
            maxResults,
            timeoutMs: FATSECRET_LANE_TIMEOUT_MS,
        });
        if (hits.length === 0) return [];

        // Fire-and-forget persist — registered so scripts can drain before
        // prisma.$disconnect(). persistFatSecretHits never throws, but keep
        // the catch so the registered task can never reject.
        const task = persistFatSecretHits(hits).catch(err => {
            logger.debug('fatsecret_lane.persist_task_failed', {
                error: (err as Error).message,
            });
        });
        registerBackgroundTask(task);

        return hits.map(toUnifiedCandidate);
    } catch (err) {
        // FAIL-OPEN: rate limits, timeouts (AbortError), auth failures — the
        // lane never breaks a mapping request.
        logger.warn('fatsecret_lane.search_failed_open', {
            query: trimmed,
            error: (err as Error).message,
            errorName: (err as Error).name,
        });
        return [];
    }
}
