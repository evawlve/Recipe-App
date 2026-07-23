/**
 * FatSecret result builder (fatsecret retrieval lane, Phase 1 — Jul 2026).
 *
 * Hydrates a `fs_<food_id>` candidate from the local FatSecretFood /
 * FatSecretServing store (persisted at retrieval time by the lane in
 * gather-candidates) and resolves grams + macros for the parsed request.
 * Same signature/return contract as buildOffResult / buildFdcResult in
 * map-ingredient-with-fallback.ts, but deliberately FOCUSED: fs servings are
 * clean household measures ("1 bar", "1 cup") with per-serving macros, so
 * none of the OFF label-placeholder / sibling-median / package-quantity
 * machinery is needed here.
 *
 * Gram-resolution priority:
 *   (a) explicit weight unit  → direct conversion       ('fs_weight_direct')
 *   (b) volume unit           → serving volumeMl match  ('fs_label_volume'),
 *       else category-density fallback                  ('fs_volume_density')
 *   (c) count/serving request → noun-matched serving    ('fs_label_count'),
 *       else default serving                            ('fs_default_serving')
 *   (d) nothing usable        → per-100g × qty          ('fs_per100g_fallback')
 * Bare unitless qty-1 requests get the same bare-query-guard CAP/REPLACE
 * parity as buildOffResult (see the guard wire-in below).
 */

import { prisma } from '../db';
import { logger } from '../logger';
import { FATSECRET_REFRESH_DAYS } from './config';
import { singularizeUnit, inferDiscreteUnit } from './count-label';
import { applyOffBareQueryGuard } from '../servings/bare-query-guard';
import type { ParsedIngredient } from '../parse/ingredient-line';
import type { UnifiedCandidate } from './gather-candidates';
import type { FatsecretMappedIngredient } from './map-ingredient-with-fallback';

// ============================================================
// Local copies of unexported map-ingredient-with-fallback helpers.
// map-ingredient-with-fallback imports THIS module (hydrateAndSelectServing
// branch), so a value import back into it would create an import cycle —
// requestBillsByServing / EXPLICIT_MEASURE_UNIT_RE are unexported there
// anyway. Keep the regex byte-identical to the mapper's copy.
// ============================================================
const EXPLICIT_MEASURE_UNIT_RE = /^(g|gram|grams|oz|ounce|ounces|lb|lbs|pound|pounds|kg|kilogram|kilograms|cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons|ml|milliliter|milliliters|l|liter|liters|floz|fl\s*oz|fluid\s*ounces?|pint|pints|quart|quarts|gallon|gallons)$/i;
function requestBillsByServing(parsed: ParsedIngredient | null): boolean {
    return !(parsed?.unit && EXPLICIT_MEASURE_UNIT_RE.test(parsed.unit.trim()));
}

const WEIGHT_TO_GRAMS: Record<string, number> = {
    'g': 1, 'gram': 1, 'grams': 1,
    'oz': 28.35, 'ounce': 28.35, 'ounces': 28.35,
    'lb': 453.6, 'lbs': 453.6, 'pound': 453.6, 'pounds': 453.6,
    'kg': 1000, 'kilogram': 1000,
};

const VOLUME_UNIT_ML: Record<string, number> = {
    'cup': 240, 'cups': 240,
    'tbsp': 15, 'tablespoon': 15, 'tablespoons': 15,
    'tsp': 5, 'teaspoon': 5, 'teaspoons': 5,
    'ml': 1, 'milliliter': 1, 'milliliters': 1,
    'floz': 30, 'fl oz': 30,
};

/** Serving-description stems for matching a requested volume unit ("1 cup" for "cup"). */
const VOLUME_UNIT_STEMS: Record<string, string[]> = {
    'cup': ['cup'], 'cups': ['cup'],
    'tbsp': ['tbsp', 'tablespoon'], 'tablespoon': ['tbsp', 'tablespoon'], 'tablespoons': ['tbsp', 'tablespoon'],
    'tsp': ['tsp', 'teaspoon'], 'teaspoon': ['tsp', 'teaspoon'], 'teaspoons': ['tsp', 'teaspoon'],
    'floz': ['fl oz', 'fluid ounce'], 'fl oz': ['fl oz', 'fluid ounce'],
    'ml': ['ml', 'milliliter'], 'milliliter': ['ml', 'milliliter'], 'milliliters': ['ml', 'milliliter'],
};

// ============================================================
// Normalized serving view (DB row or candidate fallback)
// ============================================================

interface FsServingView {
    /** FatSecret serving_id when hydrated from DB; null on the candidate fallback. */
    servingId: string | null;
    description: string;
    measurementDescription: string | null;
    grams: number | null;
    volumeMl: number | null;
    numberOfUnits: number | null;
    /** Per-serving macros Json when hydrated from DB. */
    nutrients: Record<string, unknown> | null;
}

interface Macros { kcal: number; protein: number; carbs: number; fat: number }

function num(v: unknown): number | null {
    const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
    return Number.isFinite(n) ? n : null;
}

/**
 * Per-serving macros from a FatSecretServing.nutrients Json. The lane persists
 * the client's normalized field names (calories/protein/carbohydrate/fat);
 * accept kcal/carbs synonyms defensively — Json columns carry no schema.
 */
function servingMacros(nutrients: Record<string, unknown> | null): Macros | null {
    if (!nutrients) return null;
    const kcal = num(nutrients['calories'] ?? nutrients['kcal']);
    if (kcal == null) return null;
    return {
        kcal,
        protein: num(nutrients['protein']) ?? 0,
        carbs: num(nutrients['carbohydrate'] ?? nutrients['carbs']) ?? 0,
        fat: num(nutrients['fat']) ?? 0,
    };
}

/** Per-100g macros from FatSecretFood.nutrientsPer100g (or candidate.nutrition). */
function per100gMacros(source: Record<string, unknown> | null | undefined): Macros | null {
    if (!source) return null;
    const kcal = num(source['kcal'] ?? source['calories']);
    if (kcal == null) return null;
    return {
        kcal,
        protein: num(source['protein']) ?? 0,
        carbs: num(source['carbs'] ?? source['carbohydrate']) ?? 0,
        fat: num(source['fat']) ?? 0,
    };
}

/** True when any token of the serving's description(s) singularizes to the noun. */
function servingMatchesNoun(s: FsServingView, noun: string): boolean {
    const text = `${s.description ?? ''} ${s.measurementDescription ?? ''}`.toLowerCase();
    return text.split(/[^a-z]+/).some(tok => tok !== '' && singularizeUnit(tok) === noun);
}

/** True when the serving's description names the requested volume unit. */
function servingMatchesVolumeUnit(s: FsServingView, unit: string): boolean {
    const stems = VOLUME_UNIT_STEMS[unit];
    if (!stems) return false;
    const text = `${s.description ?? ''} ${s.measurementDescription ?? ''}`;
    return stems.some(stem => new RegExp(`\\b${stem.replace(' ', '\\s+')}s?\\b`, 'i').test(text));
}

// ============================================================
// Builder
// ============================================================

export async function buildFatSecretResult(
    candidate: UnifiedCandidate,
    parsed: ParsedIngredient | null,
    confidence: number,
    rawLine: string
): Promise<FatsecretMappedIngredient | null> {
    const fsId = candidate.id.replace(/^fs_/, '');

    // 1. Hydrate from the local store (persisted at retrieval time by the lane).
    const row = await prisma.fatSecretFood.findUnique({
        where: { fsId },
        include: { servings: true },
    }).catch((err: Error) => {
        logger.warn('fs.build_result.hydrate_failed', {
            foodId: candidate.id,
            error: err.message,
        });
        return null;
    });

    // TODO(fs-refresh): when row.fetchedAt is older than FATSECRET_REFRESH_DAYS,
    // a background fail-open refresh from foods.get should re-persist the row
    // (spec §4). Deliberately NOT implemented in this PR — we only log, and the
    // stale row still serves (local data beats an extra external call).
    if (row && Date.now() - row.fetchedAt.getTime() > FATSECRET_REFRESH_DAYS * 86_400_000) {
        logger.debug('fs.build_result.stale_row', {
            foodId: candidate.id,
            fetchedAt: row.fetchedAt.toISOString(),
            refreshDays: FATSECRET_REFRESH_DAYS,
        });
    }

    // 2. Normalize servings: DB rows preferred; else candidate rawData/servings
    // (the lane's inline search payload) so a not-yet-persisted hit still bills.
    let servings: FsServingView[];
    if (row?.servings?.length) {
        servings = row.servings.map(s => ({
            servingId: s.servingId,
            description: s.description,
            measurementDescription: s.measurementDescription,
            grams: num(s.grams),
            volumeMl: num(s.volumeMl),
            numberOfUnits: num(s.numberOfUnits),
            nutrients: (s.nutrients && typeof s.nutrients === 'object')
                ? s.nutrients as Record<string, unknown> : null,
        }));
    } else {
        // Prefer candidate.servings: the lane normalizes those to
        // {description, grams}. rawData.servings are the RAW API servings
        // (metricServingAmount, no grams field) — last-resort only.
        const rawServings = (candidate.rawData as { servings?: unknown } | undefined)?.servings;
        const fallback = candidate.servings?.length
            ? candidate.servings
            : Array.isArray(rawServings) ? rawServings : [];
        servings = (fallback as unknown as Array<Record<string, unknown>>)
            .filter(s => s && typeof s['description'] === 'string')
            .map(s => ({
                servingId: typeof s['servingId'] === 'string' ? s['servingId'] as string : null,
                description: s['description'] as string,
                measurementDescription: typeof s['measurementDescription'] === 'string'
                    ? s['measurementDescription'] as string : null,
                grams: num(s['grams']),
                volumeMl: num(s['volumeMl']),
                numberOfUnits: num(s['numberOfUnits']),
                nutrients: (s['nutrients'] && typeof s['nutrients'] === 'object')
                    ? s['nutrients'] as Record<string, unknown> : null,
            }));
    }

    const per100 = per100gMacros(
        (row?.nutrientsPer100g && typeof row.nutrientsPer100g === 'object'
            ? row.nutrientsPer100g as Record<string, unknown> : null)
        ?? (candidate.nutrition?.per100g
            ? candidate.nutrition as unknown as Record<string, unknown> : null)
    );

    const usableServings = servings.filter(s => s.grams != null && s.grams > 0);
    if (!per100 && usableServings.every(s => servingMacros(s.nutrients) == null)) {
        // No per-100g nutrition and no per-serving macros anywhere — nothing
        // this builder could bill. (Distinct from "no servings": per-100g alone
        // still supports the fallback path below.)
        logger.warn('fs.build_result.no_nutrition', { foodId: candidate.id });
        return null;
    }

    const foodName = row?.name ?? candidate.name;
    const brandName = row?.brandName ?? candidate.brandName ?? null;
    const qty = parsed ? parsed.qty * parsed.multiplier : 1;
    const unit = parsed?.unit?.toLowerCase().trim();

    // 3. Gram resolution cascade.
    let grams: number | null = null;
    let servingDescription: string | null = null;
    let servingTier: string | undefined;
    /** The serving whose grams anchored the result, for per-serving macro scaling. */
    let pickedServing: FsServingView | null = null;

    if (unit && WEIGHT_TO_GRAMS[unit]) {
        // (a) Explicit weight unit — direct conversion.
        grams = qty * WEIGHT_TO_GRAMS[unit];
        servingDescription = `${grams.toFixed(1)}g`;
        servingTier = 'fs_weight_direct';
    } else if (unit && VOLUME_UNIT_ML[unit]) {
        // (b) Volume unit — a serving carrying volumeMl gives this food's own
        // density (grams / volumeMl). Prefer a serving whose description names
        // the requested unit; else any volume-quantified serving.
        const totalMl = qty * VOLUME_UNIT_ML[unit];
        const volServings = usableServings.filter(s => s.volumeMl != null && s.volumeMl > 0);
        const volMatch = volServings.find(s => servingMatchesVolumeUnit(s, unit)) ?? volServings[0];
        if (volMatch) {
            grams = totalMl * (volMatch.grams! / volMatch.volumeMl!);
            servingDescription = `${qty} ${unit}`;
            servingTier = 'fs_label_volume';
            pickedServing = volMatch;
        } else {
            // Category-density fallback, mirroring buildFdcResult: dry-granular
            // categories get their tuned density, everything else the flat
            // liquid=1.0 / solid=0.5 defaults.
            const isLiquid = /broth|stock|water|juice|milk|sauce|vinegar|oil|syrup/i
                .test(`${foodName} ${parsed?.name ?? ''}`);
            let densityGml = isLiquid ? 1.0 : 0.5;
            try {
                const { inferCategoryFromName, categoryDensity, DRY_GRANULE_DENSITY_CATEGORIES } = require('../units/density');
                const category = inferCategoryFromName(foodName) || inferCategoryFromName(parsed?.name || '');
                if (category && DRY_GRANULE_DENSITY_CATEGORIES.has(category)) {
                    const catDensity = categoryDensity(category);
                    if (catDensity && catDensity > 0) densityGml = catDensity;
                }
            } catch {
                // density.ts unavailable — keep the flat default
            }
            grams = totalMl * densityGml;
            servingDescription = `${qty} ${unit}`;
            servingTier = 'fs_volume_density';
        }
    } else if (requestBillsByServing(parsed)) {
        // (c) Count/serving-style request: either an explicit count/container
        // unit ("bar", "scoop", "bottle") or a unitless line whose NAME implies
        // a discrete piece. Token-match the noun against serving descriptions —
        // the fs "1 bar" serving is exactly the missing-serving-shape class
        // this lane exists to fix.
        const noun = unit
            ? singularizeUnit(unit)
            : inferDiscreteUnit(parsed?.name || foodName);
        if (noun) {
            const match = usableServings.find(s => servingMatchesNoun(s, noun));
            if (match) {
                const unitsPerServing = match.numberOfUnits && match.numberOfUnits > 0
                    ? match.numberOfUnits : 1;
                const perUnitGrams = match.grams! / unitsPerServing;
                grams = qty * perUnitGrams;
                servingDescription = `${qty} ${noun} (${perUnitGrams.toFixed(1)}g each)`;
                servingTier = 'fs_label_count';
                pickedServing = match;
                logger.info('fs.build_result.label_count_matched', {
                    foodId: candidate.id,
                    noun,
                    serving: match.description,
                    perUnitGrams,
                });
            }
        }
        // Default-serving fallback for serving-billed requests the noun match
        // couldn't resolve (bare qty-1, "1 serving", unmatched nouns).
        if (grams == null) {
            const defaultServing =
                (row?.defaultServingId
                    ? usableServings.find(s => s.servingId === row!.defaultServingId)
                    : undefined)
                ?? usableServings[0];
            if (defaultServing) {
                grams = qty * defaultServing.grams!;
                servingDescription = qty === 1
                    ? `${defaultServing.description} (${defaultServing.grams}g)`
                    : `${qty} x ${defaultServing.description} (${defaultServing.grams}g each)`;
                servingTier = 'fs_default_serving';
                pickedServing = defaultServing;
            }
        }
    }

    // (d) Per-100g fallback — no serving data usable for this request.
    if (grams == null || servingDescription == null) {
        if (!per100) {
            logger.warn('fs.build_result.no_usable_serving_or_per100g', { foodId: candidate.id });
            return null;
        }
        grams = 100 * qty;
        servingDescription = `${grams.toFixed(1)}g`;
        servingTier = 'fs_per100g_fallback';
        pickedServing = null;
    }

    // Bare-query guard parity (PR D pt3 Lever A, reused generically): the
    // guard's entry point is tier-keyed on the OFF tier names, so map the two
    // fs tiers it should police onto their OFF semantic twins —
    //   fs_default_serving  → 'label_serving_default' (CAP-only: fires when the
    //     default serving is package-scale, >2x the category default);
    //   fs_per100g_fallback → 'flat_100g_default' (REPLACE: a fabricated 100g
    //     yields to the category default / discrete-piece floor).
    // Guard eligibility (bare unitless qty-1, digitless raw line) is checked
    // inside applyOffBareQueryGuard itself; non-bare requests pass through.
    const GUARD_TIER_ALIAS: Record<string, string> = {
        'fs_default_serving': 'label_serving_default',
        'fs_per100g_fallback': 'flat_100g_default',
    };
    if (servingTier && GUARD_TIER_ALIAS[servingTier]) {
        const bareOverride = applyOffBareQueryGuard({
            grams,
            servingTier: GUARD_TIER_ALIAS[servingTier],
            parsed,
            rawLine,
            queryName: parsed?.name || '',
            foodName,
        });
        if (bareOverride) {
            logger.info('fs.build_result.bare_category_default', {
                foodId: candidate.id,
                previousTier: servingTier,
                previousGrams: grams,
                grams: bareOverride.grams,
            });
            grams = bareOverride.grams;
            servingDescription = bareOverride.servingDescription;
            servingTier = bareOverride.servingTier;
        }
    }

    // 4. Macros: per-serving macros scaled by grams are the most accurate
    // (they ARE this serving's label panel); per-100g rescale is the fallback.
    const pickedMacros = pickedServing?.grams && pickedServing.grams > 0
        ? servingMacros(pickedServing.nutrients) : null;
    let macros: Macros;
    if (pickedMacros) {
        const factor = grams / pickedServing!.grams!;
        macros = {
            kcal: pickedMacros.kcal * factor,
            protein: pickedMacros.protein * factor,
            carbs: pickedMacros.carbs * factor,
            fat: pickedMacros.fat * factor,
        };
    } else if (per100) {
        const factor = grams / 100;
        macros = {
            kcal: per100.kcal * factor,
            protein: per100.protein * factor,
            carbs: per100.carbs * factor,
            fat: per100.fat * factor,
        };
    } else {
        logger.warn('fs.build_result.no_macros_for_serving', { foodId: candidate.id });
        return null;
    }

    return {
        source: 'fatsecret',
        foodId: `fs_${fsId}`,
        foodName,
        brandName,
        servingId: pickedServing?.servingId ?? null,
        servingDescription,
        grams,
        kcal: macros.kcal,
        protein: macros.protein,
        carbs: macros.carbs,
        fat: macros.fat,
        confidence,
        quality: confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low',
        rawLine,
        servingTier,
    };
}
