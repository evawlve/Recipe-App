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
    FATSECRET_PERSIST_RUNNERS_UP,
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
import { queryTokenCoverage } from '../search/query-token-coverage';
import { inferCategoryFromName, categoryDensity, DRY_GRANULE_DENSITY_CATEGORIES } from '../units/density';

// ============================================================
// Client Singleton (lazy; unit tests inject their own)
// ============================================================

/**
 * Minimal surface the lane needs — lets tests inject a plain mock.
 *
 * `getFood` is OPTIONAL on purpose. It is used by exactly one path
 * (`ensureFatSecretParentPersisted`'s last-resort refetch) and every existing test mock
 * predates it; making it required would break them all for a path most of them never take.
 * A mock without it degrades to "cannot refetch", which is the same as having no credentials.
 */
export type FatSecretLaneClient = Pick<FatSecretClient, 'searchFoodsV4'> &
    Partial<Pick<FatSecretClient, 'getFood'>>;

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

/**
 * Usable gram weight of a serving, or null.
 *
 * `foodName` is optional only so the volume branch can degrade to water
 * density; pass it wherever it's available.
 *
 * The ml branch matters more than it looks. fatsecret reports a large share of
 * beverages and condiments with `metric_serving_unit = "ml"` and no gram weight
 * at all — 976 of the 3,504 foods that ended up with an empty
 * `nutrientsPer100g` in production had exactly that shape (Capri Sun 177 ml,
 * Gatorade 591 ml, Heinz relish 15 ml). Returning null for them threw away
 * complete, correct nutrition over a unit we can convert. The legacy lane's
 * `gramsForServing` has always applied category density here; this restores
 * parity. `volumeMl` is persisted separately, so nothing is lost by deriving.
 */
function servingGramsOf(s: FatSecretApiServing, foodName?: string | null): number | null {
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
    const ml = servingVolumeMlOf(s);
    if (ml != null) {
        // 1.0 g/ml (water-like) is the right default here rather than a
        // refusal: the ml servings fatsecret reports are overwhelmingly
        // beverages, whose density is within a few percent of water.
        //
        // Dry-granule categories are refused outright, because a serving
        // REPORTED IN ML IS A LIQUID and those densities describe the dry
        // solid. inferCategoryFromName matches on substrings, so "Oat Milk"
        // reaches `oats` (0.36 g/ml, dry flakes) and "Almond Nog" reaches
        // `nut` (0.55) — a 240 ml oat milk would weigh 86 g and its per-100g
        // would come out ~3x too high. The category is not wrong about the
        // ingredient, only about the form, and ml tells us the form.
        const category = foodName ? inferCategoryFromName(foodName) : null;
        const usableCategory = category && !DRY_GRANULE_DENSITY_CATEGORIES.has(category)
            ? category
            : null;
        const density = (usableCategory ? categoryDensity(usableCategory) : undefined) ?? 1.0;
        return round2(ml * density);
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
    servings: FatSecretApiServing[] | undefined | null,
    foodName?: string | null
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
        const grams = servingGramsOf(s, foodName);
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

/**
 * Position-rank score on the FDC-style scale (rerank clamps at 1).
 * The positional base decays with rank; the name-quality multiplier
 * mirrors FDC's computePositionScore so a fatsecret record whose
 * name/brand fully covers the query saturates the rerank's
 * ORIGINAL_SCORE term the way name-boosted OFF/FDC scores do. A purely
 * positional score can never saturate, which structurally under-ranked
 * genuinely-good fatsecret records against mediocre OFF matches.
 */
function positionScore(index: number, query: string, hit: FatSecretFoodSummary): number {
    const base = Math.max(0.5, 0.95 - index * 0.02);
    const coverage = queryTokenCoverage(query, hit.name, hit.brandName);
    if (coverage >= 1) return base * 1.5;
    if (coverage >= 0.5) return base * 1.2;
    return base;
}

function toUnifiedCandidate(
    hit: FatSecretFoodSummary,
    index: number,
    query: string
): UnifiedCandidate {
    const per100 = derivePer100gFromServings(hit.servings, hit.name);

    // THE LIVE PATH USED TO LOSE EXACTLY THE DATA THE BUILDER NEEDS (A8 row 1).
    //
    // Two lossy steps sat here, and together they made a first-sighting
    // restaurant record unbillable. (1) The map dropped every macro field, so a
    // serving reached `buildFatSecretResult()` with `nutrients` undefined; the
    // builder's raw-array last resort reads `s['nutrients']`, a key the RAW api
    // serving does not have (its macros are flat: `calories`, `carbohydrate`,
    // `protein`, `fat` — exactly what `servingMacros()` reads). (2) The filter
    // then deleted any serving with no gram weight, which for a chain record is
    // the ONLY serving it has: `fs_124375163` "Nachos Bellgrande - Beef" ships
    // one serving, `1 serving` = 730 kcal, `metricServingAmount` null,
    // `servingWeightGrams` null.
    //
    // So `anyServingHasMacros` read false on BOTH paths, the builder logged
    // `fs.build_result.no_nutrition` and returned null, and the mapper's serving
    // fallback billed an OFF sibling instead. Measured on the box 2026-08-25:
    // 1,432 such events over 413 distinct records, 246 of which are not in
    // `FatSecretFood` at all — a failed build never reaches the winner-persist
    // path, so the record stays first-sighting and fails again on every request.
    // The PERSISTED analogue of the same shape bills fine (3,472 Brand foods,
    // 14.4%): the DB path keeps `nutrients`. Only the live path lost them.
    //
    // Carrying the macros and keeping a gram-less serving that HAS macros hands
    // the builder's existing macro-only branch the data it was written for — its
    // own comment names the Impossible Whopper — and nothing new is written to
    // `FatSecretServing` (DNB-1/DNB-2 untouched); the winner then persists
    // through the path every winner already uses.
    //
    // A gram-less serving with NO macros is still dropped: it states neither a
    // weight nor a bill, so it is not data. Owner:
    // `sync-docs/reports/2026-08-25_a8-the-catalogue-holds-13-of-31-and-the-within-brand-block.md` §4 K3.
    const servings = (hit.servings ?? [])
        .map(s => ({
            description: (s.description ?? s.measurementDescription ?? '').trim(),
            grams: servingGramsOf(s, hit.name),
            nutrients: rawServingNutrients(s),
        }))
        .filter(s => Boolean(s.description) && (s.grams != null || s.nutrients != null));

    return {
        id: `fs_${hit.id}`,
        source: 'fatsecret',
        name: hit.name,
        brandName: hit.brandName ?? null,
        score: positionScore(index, query, hit),
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

// ============================================================
// In-flight persist registry (FK persist race)
// ============================================================

/**
 * fsId → the in-flight `persistFatSecretHits` promise that will write that
 * food's FatSecretFood parent row.
 *
 * FoodMapping.fsId is a FOREIGN KEY to FatSecretFood.fsId, but the lane
 * persists its hits fire-and-forget, so on a food's first-ever sighting the
 * child write can reach the database before its parent. The FK then rejects
 * the save, `saveValidatedMapping` swallows the error, and the mapping is
 * silently never cached (11 of warm batch 01's 92 reported saves; 67 such
 * events since 2026-07-23).
 *
 * Entries live only while a persist is actually in flight — the `.finally`
 * below removes them — so the registry is bounded by concurrent lane
 * searches, and a lookup after the persist drained is a Map miss (free).
 */
const pendingPersistByFsId = new Map<string, Promise<void>>();

/**
 * Cap on how long a save may wait for an in-flight persist. The measured
 * window is under 2s for every observed failure; the cap exists so a stalled
 * background write can never hold a request open — on timeout the caller
 * proceeds and the write behaves exactly as it does today.
 */
const PERSIST_WAIT_TIMEOUT_MS = 3000;

function trackPendingPersist(hits: FatSecretFoodSummary[], task: Promise<void>): void {
    const ids = hits.map(h => h.id).filter((id): id is string => !!id);
    if (ids.length === 0) return;
    for (const id of ids) pendingPersistByFsId.set(id, task);
    void task.finally(() => {
        for (const id of ids) {
            // Only clear entries this task owns — a later search for the same
            // food may already have replaced them.
            if (pendingPersistByFsId.get(id) === task) pendingPersistByFsId.delete(id);
        }
    });
}

/**
 * fsId → the summary of a hit the lane deliberately did NOT persist, because it fell
 * outside FATSECRET_PERSIST_RUNNERS_UP.
 *
 * This exists so a deferred hit can still be written the moment it turns out to have WON.
 * Rerank order is not lane order — that is the entire point of the reranker — so the
 * winner is routinely a hit we chose not to persist speculatively. `FoodMapping.fsId` is a
 * foreign key to `FatSecretFood.fsId`, so saving a mapping for an unpersisted winner fails
 * the FK and loses the mapping silently.
 *
 * Bounded and FIFO-evicted: entries are only useful between a lane search and the save
 * that follows it, and eviction is harmless — a miss just means we persist nothing extra,
 * which is the pre-existing behaviour for a food whose parent row is already there.
 */
const deferredHitsByFsId = new Map<string, FatSecretFoodSummary>();
const DEFERRED_HITS_MAX = 500;

function rememberDeferredHits(hits: FatSecretFoodSummary[]): void {
    for (const hit of hits) {
        if (!hit.id) continue;
        // Re-insert to refresh FIFO position.
        deferredHitsByFsId.delete(hit.id);
        deferredHitsByFsId.set(hit.id, hit);
    }
    while (deferredHitsByFsId.size > DEFERRED_HITS_MAX) {
        const oldest = deferredHitsByFsId.keys().next();
        if (oldest.done) break;
        deferredHitsByFsId.delete(oldest.value);
    }
}

/** Test seam: drop every deferred entry (tests only). */
export function __resetDeferredFatSecretHitsForTests(): void {
    deferredHitsByFsId.clear();
}

/**
 * Guarantee that `fsId`'s FatSecretFood parent row exists before a child row references it.
 *
 * Four cases, in order, cheapest first:
 *  1. A speculative persist is still in flight — wait for it (the pre-existing behaviour).
 *  2. The hit was deferred by the runners-up cap and never persisted at all — persist it
 *     NOW, synchronously, because it just won.
 *  3. The parent row is already in Postgres (the common case: a previous request persisted
 *     it, or this fsId was inside the cap). One indexed PK read, then done.
 *  4. Nothing has it and it is not in memory — refetch the single record from FatSecret and
 *     persist that.
 *
 * Cases 2–4 are what make reducing the cache safe. Without them, capping speculative writes
 * silently reintroduces the FK failure that cost warm batch 01 31.4% of its saves.
 *
 * **Case 4 is what the user-override feature depends on** (design_food_customization_2026-07-28).
 * The runners-up exist so a user can correct an automatic pick, and that correction arrives in a
 * LATER request — by then `deferredHitsByFsId` has almost certainly evicted the entry (it is
 * in-process, FIFO-capped at DEFERRED_HITS_MAX, and empty after any restart). Cases 1–3 all miss,
 * and without the refetch the override would fail the FK and lose the mapping with no error.
 *
 * Never throws. A refetch that fails (no credentials, no `getFood` on an injected mock, rate
 * limit, 404) leaves the parent absent, which is exactly the pre-existing behaviour — the
 * caller's insert then fails the FK as it always would have.
 */
export async function ensureFatSecretParentPersisted(fsId: string): Promise<void> {
    if (!fsId) return;
    await awaitPendingFatSecretPersist(fsId);

    const deferred = deferredHitsByFsId.get(fsId);
    if (deferred) {
        deferredHitsByFsId.delete(fsId);
        logger.info('fatsecret_lane.deferred_winner_persisted', { fsId });
        await persistFatSecretHits([deferred]).catch(err => {
            logger.warn('fatsecret_lane.deferred_persist_failed', {
                fsId,
                error: (err as Error).message,
            });
        });
        return;
    }

    // Already ours? Nothing to do — and this is the hot path, so it stays a single PK read.
    try {
        const existing = await prisma.fatSecretFood.findUnique({
            where: { fsId },
            select: { fsId: true },
        });
        if (existing) return;
    } catch (err) {
        logger.warn('fatsecret_lane.parent_lookup_failed', {
            fsId,
            error: (err as Error).message,
        });
        return;
    }

    const client = getClient();
    if (!client?.getFood) {
        logger.warn('fatsecret_lane.parent_refetch_unavailable', { fsId });
        return;
    }

    try {
        const details = await client.getFood(fsId);
        if (!details) {
            logger.warn('fatsecret_lane.parent_refetch_empty', { fsId });
            return;
        }
        logger.info('fatsecret_lane.parent_refetched', { fsId });
        await persistFatSecretHits([details]);
    } catch (err) {
        logger.warn('fatsecret_lane.parent_refetch_failed', {
            fsId,
            error: (err as Error).message,
        });
    }
}

/**
 * Wait for the background persist that owns `fsId`, if one is still running.
 *
 * Returns immediately (a Map lookup) when nothing is in flight — the common
 * case, since a persist started at retrieval time has normally drained long
 * before rerank + AI validation finish. Callers writing a row that references
 * FatSecretFood.fsId should await this first; see the insert-bound call in
 * `saveValidatedMapping`.
 *
 * Never throws: the registered task already carries its own `.catch`, and a
 * failed persist simply leaves the parent absent, which is today's behavior.
 */
export async function awaitPendingFatSecretPersist(fsId: string): Promise<void> {
    const task = pendingPersistByFsId.get(fsId);
    if (!task) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            task,
            new Promise<void>(resolve => {
                timer = setTimeout(() => {
                    logger.warn('fatsecret_lane.persist_wait_timeout', { fsId });
                    resolve();
                }, PERSIST_WAIT_TIMEOUT_MS);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Test seam: drop every registry entry (tests only). */
export function __resetPendingFatSecretPersistForTests(): void {
    pendingPersistByFsId.clear();
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
            const per100 = derivePer100gFromServings(hit.servings, hit.name);
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
                    grams: servingGramsOf(s, hit.name),
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

        // Persist only the first FATSECRET_PERSIST_RUNNERS_UP hits speculatively; the rest
        // are remembered in-process and written ONLY if one of them turns out to have won
        // (see ensureFatSecretParentPersisted). We asked FatSecret for these candidates on
        // one user's behalf — keeping the food they chose is defensible, keeping all 8
        // copies of someone else's database on every query is not, and 97.6% of the rows
        // we had accumulated this way never backed a single mapping.
        const toPersist = hits.slice(0, FATSECRET_PERSIST_RUNNERS_UP);
        const deferred = hits.slice(FATSECRET_PERSIST_RUNNERS_UP);
        rememberDeferredHits(deferred);
        if (deferred.length > 0) {
            logger.debug('fatsecret_lane.persist_capped', {
                query: trimmed,
                persisted: toPersist.length,
                deferred: deferred.length,
            });
        }

        // Fire-and-forget persist — registered so scripts can drain before
        // prisma.$disconnect(). persistFatSecretHits never throws, but keep
        // the catch so the registered task can never reject.
        const task = persistFatSecretHits(toPersist).catch(err => {
            logger.debug('fatsecret_lane.persist_task_failed', {
                error: (err as Error).message,
            });
        });
        registerBackgroundTask(task);
        // ...and indexed by fsId, so a save that needs one of these FK parents
        // can wait for exactly that write instead of the whole drain.
        // Track only what this task actually writes — a fsId registered against a task
        // that never persists it would make `ensureFatSecretParentPersisted` wait on a
        // promise that cannot help it.
        trackPendingPersist(toPersist, task);

        return hits.map((hit, index) => toUnifiedCandidate(hit, index, trimmed));
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
