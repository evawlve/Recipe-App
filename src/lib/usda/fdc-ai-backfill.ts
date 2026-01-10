import crypto from 'node:crypto';
import { prisma } from '../db';
import { logger } from '../logger';
import { requestAiServing, type ServingGapType } from '../ai/serving-estimator';
import {
    FATSECRET_CACHE_AI_MAX_DENSITY,
    FATSECRET_CACHE_AI_MIN_DENSITY,
} from '../fatsecret/config';

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

// Size qualifiers for produce (small, medium, large, etc.)
const SIZE_QUALIFIERS = new Set([
    'small', 'sm',
    'medium', 'med',
    'large', 'lg',
    'extra-large', 'xl', 'extralarge',
]);

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
 * TODO: Implement actual AI estimation and caching
 */
export async function getOrCreateFdcSizeServings(
    fdcId: number,
    foodName: string
): Promise<Record<string, number> | null> {
    // Stub implementation - return common produce size estimates
    // These are rough averages that should be replaced with AI-estimated values
    logger.info('fdc.size_servings_stub', { fdcId, foodName });

    // Return null to trigger fallback - actual implementation would query cache or call AI
    return null;
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
): Promise<{ success: boolean; reason?: string }> {
    const food = await (prisma as any).fdcFoodCache.findUnique({
        where: { id: fdcId },
        include: { servings: true },
    });

    if (!food) {
        logger.warn({ fdcId: String(fdcId) }, 'FDC food missing from cache');
        return { success: false, reason: 'food_missing' };
    }

    // Adapt FDC food to FatSecret structure expected by requestAiServing
    const mockFood: any = {
        id: String(food.id),
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
        logger.info({ fdcId: String(fdcId), gapType, prompt: aiResult.prompt }, 'AI prompt debug (FDC)');
    }

    if (aiResult.status === 'error') {
        logger.warn({ fdcId: String(fdcId), reason: aiResult.reason }, 'AI serving suggestion failed (FDC)');
        return { success: false, reason: aiResult.reason };
    }

    const suggestion = aiResult.suggestion;
    let volumeMl =
        suggestion.volumeUnit && suggestion.volumeAmount
            ? convertVolumeToMl(suggestion.volumeUnit, suggestion.volumeAmount)
            : null;

    let countServing = false;
    let countUnit: string | undefined;

    if (gapType === 'volume' && !volumeMl) {
        const unit = suggestion.volumeUnit?.toLowerCase().trim();
        if (suggestion.volumeAmount && suggestion.volumeAmount > 0 && (unit ? COUNT_UNITS.has(unit) : true)) {
            countServing = true;
            countUnit = unit ?? 'count';
            volumeMl = suggestion.volumeAmount;
        } else if (unit && COUNT_UNITS.has(unit)) {
            countServing = true;
            countUnit = unit;
            volumeMl = suggestion.volumeAmount ?? 1;
        }
    }

    if (gapType === 'volume' && !volumeMl && !countServing) {
        return { success: false, reason: 'missing_volume_unit' };
    }

    if (suggestion.grams <= 0) {
        return { success: false, reason: 'invalid_grams' };
    }

    const density = volumeMl && !countServing ? suggestion.grams / volumeMl : null;
    if (
        density &&
        (density < FATSECRET_CACHE_AI_MIN_DENSITY || density > FATSECRET_CACHE_AI_MAX_DENSITY)
    ) {
        return { success: false, reason: 'density_outside_bounds' };
    }

    if (options.dryRun) {
        return { success: true };
    }

    await (prisma as any).fdcServingCache.create({
        data: {
            fdcId: fdcId,
            description: suggestion.servingLabel,
            grams: suggestion.grams,
            source: 'ai',
            isAiEstimated: true,
        }
    });

    logger.info(
        { fdcId: String(fdcId), gapType, label: suggestion.servingLabel },
        'Inserted AI-derived FDC serving',
    );

    return { success: true };
}
