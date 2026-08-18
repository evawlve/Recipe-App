import crypto from 'node:crypto';
import { prisma } from '../db';
import { logger } from '../logger';
import { requestAiServing, type ServingGapType } from '../ai/serving-estimator';
import { isWriteSuppressed, noteRefusedWrite } from '../write-policy';
import {
    FATSECRET_CACHE_AI_MAX_DENSITY,
    FATSECRET_CACHE_AI_MIN_DENSITY,
} from '../mapping/config';

// Reusing volume conversion logic from fatsecret/ai-backfill.ts
// Ideally this should be extracted to a shared utility
const VOLUME_UNIT_TO_ML: Record<string, number> = {
    ml: 1, milliliter: 1, milliliters: 1, millilitre: 1, millilitres: 1,
    l: 1000, liter: 1000, liters: 1000, litre: 1000, litres: 1000,
    cup: 240, cups: 240,
    tbsp: 15, tablespoon: 15, tablespoons: 15,
    tsp: 5, teaspoon: 5, teaspoons: 5,
    floz: 30, 'fl oz': 30, 'fluid ounce': 30, 'fluid ounces': 30,
    // Small volume units
    dash: 0.625, dashes: 0.625,    // 1 dash ≈ 1/8 tsp
    pinch: 0.3, pinches: 0.3,       // 1 pinch ≈ 1/16 tsp
};

// Count-based units - synced with unit-type.ts COUNT_UNITS
const COUNT_UNITS = new Set([
    'count', 'item', 'items', 'piece', 'pieces', 'pc', 'pcs',
    'each', 'ea', 'unit', 'units',
    // Food-specific counts
    'tortilla', 'tortillas', 'egg', 'eggs', 'bagel', 'bagels',
    'patty', 'patties', 'fillet', 'fillets', 'breast', 'breasts',
    'thigh', 'thighs', 'wing', 'wings', 'drumstick', 'drumsticks',
    'clove', 'cloves', 'stalk', 'stalks', 'leaf', 'leaves', 'sprig', 'sprigs',
    'strip', 'strips', 'wedge', 'wedges', 'cube', 'cubes', 'slice', 'slices',
    // Packages and containers
    'packet', 'packets', 'sachet', 'sachets', 'pouch', 'pouches',
    'scoop', 'scoops', 'stick', 'sticks', 'bar', 'bars',
    'envelope', 'envelopes', 'container', 'containers', 'can', 'cans',
    'bottle', 'bottles', 'serving', 'servings',
    // Baked goods
    'cookie', 'cookies', 'cracker', 'crackers', 'chip', 'chips',
    'muffin', 'muffins', 'roll', 'rolls', 'bun', 'buns',
    'wafer', 'wafers', 'sheet', 'sheets',
    // Size descriptors (for whole foods)
    'small', 'medium', 'large', 'whole',
]);

/**
 * Size qualifiers for produce, each with the ratio it scales `medium` by.
 *
 * ONE DECLARATION ON PURPOSE (2026-08-17). This used to be two: a `SIZE_QUALIFIERS`
 * Set that `isSizeQualifier()` gates on, and a separate hand-written object literal
 * inside `getOrCreateFdcSizeServings()` that the caller then indexes. The Set held
 * TEN spellings and the literal NINE — `extralarge` was accepted and never answered,
 * so `buildFdcResult()` branch 3 (serving/hydration-lane.ts) entered the size arm on
 * a successful estimate, read `undefined`, and billed a flat 100 g.
 *
 * Two lists whose only relationship is that a human keeps them equal is the drift
 * this repo has paid for repeatedly (the retired winner-diff/correctness-screen tier
 * regexes, both missing `discrete_unit_backfill`). Deriving the acceptance set FROM
 * the answer table makes the two incapable of disagreeing: a spelling that cannot be
 * answered can no longer be accepted.
 *
 * The nine pre-existing ratios are unchanged and `extralarge` takes 1.60, the value
 * its two synonyms `extra-large` and `xl` already carry.
 */
const SIZE_RATIOS: Readonly<Record<string, number>> = Object.freeze({
    'mini': 0.55,
    'small': 0.70, 'sm': 0.70,
    'medium': 1, 'med': 1,
    'large': 1.40, 'lg': 1.40,
    'extra-large': 1.60, 'xl': 1.60, 'extralarge': 1.60,
});

/**
 * The spellings `isSizeQualifier()` accepts. Exported so the invariant
 * "everything accepted is answerable" can be asserted against the map
 * `getOrCreateFdcSizeServings()` returns, rather than restated in a test —
 * a restated copy is free to drift, which is the defect above.
 */
export const SIZE_QUALIFIERS: ReadonlySet<string> = new Set(Object.keys(SIZE_RATIOS));

/**
 * Check if a unit is a size qualifier (small, medium, large, etc.)
 */
export function isSizeQualifier(unit: string | undefined | null): boolean {
    if (!unit) return false;
    return SIZE_QUALIFIERS.has(unit.toLowerCase().trim());
}

/**
 * Get or create AI-estimated servings for size qualifiers (small/medium/large).
 * Returns a map of size -> grams, or null if estimation fails.
 * 
 * This function calls AI synchronously to estimate weight for "1 medium {foodName}".
 * Results should be cached in a future enhancement.
 */
export async function getOrCreateFdcSizeServings(
    fdcId: number,
    foodName: string
): Promise<Record<string, number> | null> {
    logger.info('fdc.size_servings_estimating', { fdcId, foodName });

    try {
        // Use the ambiguous serving estimator to get "medium" weight
        const { estimateAmbiguousServing } = await import('../ai/ambiguous-serving-estimator');

        const result = await estimateAmbiguousServing({
            foodName,
            brandName: null,
            unit: 'medium',  // Ask: "What does 1 medium {foodName} weigh?"
        });

        if (result.status === 'success' && result.estimatedGrams && result.estimatedGrams > 0) {
            logger.info('fdc.size_servings_estimated', {
                fdcId,
                foodName,
                mediumGrams: result.estimatedGrams,
                confidence: result.confidence,
                reasoning: result.reasoning,
            });

            // Return estimated weights for EVERY spelling isSizeQualifier() accepts,
            // built from SIZE_RATIOS so the two can never disagree again.
            // Standard ratios: small ≈ 70% of medium, large ≈ 140% of medium.
            const mediumGrams = result.estimatedGrams;
            const sizes: Record<string, number> = {};
            for (const [size, ratio] of Object.entries(SIZE_RATIOS)) {
                sizes[size] = Math.round(mediumGrams * ratio);
            }
            // `whole` is deliberately NOT a SIZE_QUALIFIERS member — it is a COUNT_UNITS
            // spelling that branch 3 never asks for — but callers indexing this map by a
            // parsed unit can, so it is answered here as it always has been.
            sizes['whole'] = Math.round(mediumGrams);  // "whole" = "medium" by default
            return sizes;
        }

        logger.warn('fdc.size_servings_ai_failed', {
            fdcId,
            foodName,
            error: result.error,
        });
        return null;
    } catch (error) {
        logger.error('fdc.size_servings_error', {
            fdcId,
            foodName,
            error: (error as Error).message,
        });
        return null;
    }
}

function convertVolumeToMl(unit: string, amount: number): number | null {
    if (!unit || !Number.isFinite(amount) || amount <= 0) return null;
    const normalized = unit.trim().toLowerCase();
    const scale = VOLUME_UNIT_TO_ML[normalized];
    if (!scale) return null;
    return amount * scale;
}

export interface InsertFdcAiServingOptions {
    dryRun?: boolean;
    promptDebug?: boolean;
    /** Specific unit to estimate (e.g., "packet", "egg", "slice") */
    targetUnit?: string;
}

export async function insertFdcAiServing(
    fdcId: number,
    gapType: ServingGapType,
    options: InsertFdcAiServingOptions = {}
): Promise<{ success: boolean; reason?: string; grams?: number; servingLabel?: string }> {
    const food = await prisma.fdcFood.findUnique({
        where: { fdcId },
        include: { servings: true },
    });

    if (!food) {
        logger.warn('FDC food missing from cache', { fdcId: String(fdcId) });
        return { success: false, reason: 'food_missing' };
    }

    // Adapt FDC food to FatSecret structure expected by requestAiServing
    const mockFood: any = {
        id: String(food.fdcId),
        name: food.description,
        description: food.description,
        brandName: food.brandName,
        foodType: food.dataType,
        servings: food.servings.map((s: any) => ({
            measurementDescription: s.description,
            metricServingAmount: s.grams,
            metricServingUnit: 'g',
            numberOfUnits: 1,
        }))
    };

    const aiResult = await requestAiServing({
        gapType,
        food: mockFood,
        targetServingUnit: options.targetUnit,
        isOnDemandBackfill: !!options.targetUnit,  // Use lower threshold for on-demand
    });

    if (options.promptDebug) {
        logger.info('AI prompt debug (FDC)', { fdcId: String(fdcId), gapType, prompt: aiResult.prompt });
    }

    if (aiResult.status === 'error') {
        logger.warn('AI serving suggestion failed (FDC)', { fdcId: String(fdcId), reason: aiResult.reason });
        return { success: false, reason: aiResult.reason };
    }

    const suggestion = aiResult.suggestion;
    const volumeMl =
        suggestion.volumeUnit && suggestion.volumeAmount
            ? convertVolumeToMl(suggestion.volumeUnit, suggestion.volumeAmount)
            : null;

    if (gapType === 'volume' && !volumeMl) {
        // A COUNT answer to a VOLUME question is refused, not rescued (2026-08-17).
        //
        // Until now this arm did the opposite: a suggestion whose `volumeUnit` was
        // a COUNT_UNITS spelling — or that carried NO unit at all with a positive
        // `volumeAmount` — was accepted as a "count serving", the density band was
        // skipped for it, and the grams of the WHOLE label were persisted and
        // returned undivided. The only caller, the volume branch of
        // `buildFdcResult()` (serving/hydration-lane.ts), then billed
        // `qty × grams` under `servingDescription "1 <unit>"`: FdcServing 8377
        // (`3 egg whites = 65 g`, note "about equivalent to one cup of liquid egg
        // whites") billed 65 g for ONE CUP of egg whites, and 8376 (`1 egg white =
        // 33 g`) billed 33 g — the two answers flapping across cold draws.
        //
        // The prompt (`buildUserPrompt()` in ../ai/serving-estimator.ts) still
        // solicits the count escape even when a target unit is named, because the
        // FatSecret lane's on-demand callers rely on it for count targets. So the
        // refusal lives here, where the question is always a volume unit: the
        // caller falls through to its density fallback (`volume_unit`) and nothing
        // is persisted. Weight gaps are untouched.
        const unit = suggestion.volumeUnit?.toLowerCase().trim();
        const answeredAsCount = unit
            ? COUNT_UNITS.has(unit)
            : suggestion.volumeAmount != null && suggestion.volumeAmount > 0;
        if (answeredAsCount) {
            logger.info('fdc.volume_ai_count_answer_refused', {
                fdcId: String(fdcId),
                targetUnit: options.targetUnit,
                label: suggestion.servingLabel,
                volumeUnit: suggestion.volumeUnit,
                volumeAmount: suggestion.volumeAmount,
                grams: suggestion.grams,
            });
            return { success: false, reason: 'count_answer_for_volume_gap' };
        }
        return { success: false, reason: 'missing_volume_unit' };
    }

    if (suggestion.grams <= 0) {
        return { success: false, reason: 'invalid_grams' };
    }

    const density = volumeMl ? suggestion.grams / volumeMl : null;
    if (
        density &&
        (density < FATSECRET_CACHE_AI_MIN_DENSITY || density > FATSECRET_CACHE_AI_MAX_DENSITY)
    ) {
        return { success: false, reason: 'density_outside_bounds' };
    }

    if (options.dryRun) {
        return { success: true };
    }

    // REQUEST-SCOPED WRITE SUPPRESSION (nosave=1). Deliberately NOT `dryRun` — read the
    // two returns next to each other. `dryRun` answers `{ success: true }` with NO grams,
    // and the only caller (the volume branch of `buildFdcResult()` in
    // serving/hydration-lane.ts) reads a missing `grams` as failure and silently reroutes
    // to the hardcoded `volume_unit` density. A measurement run on `dryRun` would
    // therefore measure a DIFFERENT pipeline from the one a real request takes.
    //
    // So the refusal sits AFTER the model has answered and after every validity guard,
    // and returns exactly what the persisted path returns — same success, same grams,
    // same label. Only the upsert and its "Inserted" log are skipped. The caller bills
    // the same number it would have billed; the row simply does not land.
    if (isWriteSuppressed('aiServing')) {
        noteRefusedWrite('aiServing', 'FdcServing', `fdc_${fdcId}:${suggestion.servingLabel}`);
        return { success: true, grams: suggestion.grams, servingLabel: suggestion.servingLabel };
    }

    await prisma.fdcServing.upsert({
        where: {
            FdcServing_fdcId_description_key: {
                fdcId,
                description: suggestion.servingLabel,
            },
        },
        create: {
            fdcId,
            description: suggestion.servingLabel,
            grams: suggestion.grams,
            source: 'ai',
            isAiEstimated: true,
            derivedViaDensity: !!density,
            densityGml: density,
            confidence: aiResult.status === 'success' ? suggestion.confidence : null,
            note: aiResult.status === 'success' ? suggestion.rationale : null,
        },
        update: {
            grams: suggestion.grams,
            isAiEstimated: true,
            derivedViaDensity: !!density,
            densityGml: density,
            confidence: aiResult.status === 'success' ? suggestion.confidence : null,
            note: aiResult.status === 'success' ? suggestion.rationale : null,
        },
    });

    logger.info('Inserted AI-derived FDC serving', {
        fdcId: String(fdcId), gapType, label: suggestion.servingLabel,
    });

    // Return the grams we just computed for THIS requested unit. Callers must use
    // this rather than re-reading the fdcServing table by id — a food can have
    // several AI volume servings (tbsp/tsp/cup) and an id-ordered readback would
    // grab an arbitrary one, decoupling the result from the requested unit. (honey tbsp→7g bug)
    return { success: true, grams: suggestion.grams, servingLabel: suggestion.servingLabel };
}
