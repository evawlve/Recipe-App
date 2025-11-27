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
};

const COUNT_UNITS = new Set(['count', 'item', 'items', 'piece', 'pieces', 'tortilla', 'egg', 'bagel']);

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

    const aiResult = await requestAiServing({ gapType, food: mockFood });

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
