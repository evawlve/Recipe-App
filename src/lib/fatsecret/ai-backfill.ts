import crypto from 'node:crypto';
import { prisma } from '../db';
import { logger } from '../logger';
import { requestAiServing, type ServingGapType } from '../ai/serving-estimator';
import {
    FATSECRET_CACHE_AI_MAX_DENSITY,
    FATSECRET_CACHE_AI_MIN_DENSITY,
} from './config';

const VOLUME_UNIT_TO_ML: Record<string, number> = {
    ml: 1,
    milliliter: 1,
    milliliters: 1,
    millilitre: 1,
    millilitres: 1,
    l: 1000,
    liter: 1000,
    liters: 1000,
    litre: 1000,
    litres: 1000,
    cup: 240,
    cups: 240,
    tbsp: 15,
    tablespoon: 15,
    tablespoons: 15,
    tsp: 5,
    teaspoon: 5,
    teaspoons: 5,
    floz: 30,
    'fl oz': 30,
    'fluid ounce': 30,
    'fluid ounces': 30,
};

const COUNT_UNITS = new Set(['count', 'item', 'items', 'piece', 'pieces', 'tortilla', 'egg', 'bagel']);

function convertVolumeToMl(unit: string, amount: number): number | null {
    if (!unit || !Number.isFinite(amount) || amount <= 0) return null;
    const normalized = unit.trim().toLowerCase();
    const scale = VOLUME_UNIT_TO_ML[normalized];
    if (!scale) return null;
    return amount * scale;
}

function buildServingId(foodId: string, label: string): string {
    const hash = crypto.createHash('sha1').update(`${foodId}:${label}`).digest('hex').slice(0, 12);
    return `ai_${hash}`;
}

export interface InsertAiServingOptions {
    dryRun?: boolean;
    promptDebug?: boolean;
}

export async function insertAiServing(
    foodId: string,
    gapType: ServingGapType,
    options: InsertAiServingOptions = {}
): Promise<{ success: boolean; reason?: string }> {
    const food = await prisma.fatSecretFoodCache.findUnique({
        where: { id: foodId },
        include: { servings: true },
    });

    if (!food) {
        logger.warn({ foodId }, 'FatSecret food missing from cache');
        return { success: false, reason: 'food_missing' };
    }

    const aiResult = await requestAiServing({ gapType, food });

    if (options.promptDebug) {
        logger.info(
            { foodId, gapType, prompt: aiResult.prompt },
            'AI prompt debug',
        );
        logger.info(
            { foodId, gapType, raw: aiResult.raw, suggestion: aiResult.status === 'success' ? aiResult.suggestion : undefined },
            'AI response debug',
        );
    }

    if (aiResult.status === 'error') {
        logger.warn({ foodId, reason: aiResult.reason }, 'AI serving suggestion failed');
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
        logger.warn(
            { foodId, serving: suggestion.servingLabel },
            'AI did not return a convertible volume',
        );
        return { success: false, reason: 'missing_volume_unit' };
    }

    if (suggestion.grams <= 0) {
        logger.warn({ foodId }, 'AI returned invalid gram weight');
        return { success: false, reason: 'invalid_grams' };
    }

    const density = volumeMl && !countServing ? suggestion.grams / volumeMl : null;
    if (
        density &&
        (density < FATSECRET_CACHE_AI_MIN_DENSITY || density > FATSECRET_CACHE_AI_MAX_DENSITY)
    ) {
        logger.warn({ foodId, density }, 'AI density outside bounds');
        return { success: false, reason: 'density_outside_bounds' };
    }

    const servingId = buildServingId(foodId, suggestion.servingLabel);

    if (options.dryRun) {
        logger.info(
            {
                foodId,
                gapType,
                servingId,
                label: suggestion.servingLabel,
                grams: suggestion.grams,
                volumeMl,
                confidence: suggestion.confidence,
            },
            'DRY RUN: would insert AI-derived serving',
        );
        return { success: true };
    }

    let densityEstimateId: string | undefined;
    await prisma.$transaction(async (tx) => {
        if (density && volumeMl) {
            const densityRow = await tx.fatSecretDensityEstimate.create({
                data: {
                    foodId,
                    densityGml: density,
                    source: 'ai',
                    confidence: suggestion.confidence,
                    notes: suggestion.rationale,
                },
            });
            densityEstimateId = densityRow.id;
        }

        await tx.fatSecretServingCache.upsert({
            where: { id: servingId },
            create: {
                id: servingId,
                foodId,
                measurementDescription: suggestion.servingLabel,
                numberOfUnits: suggestion.volumeAmount ?? (countServing ? 1 : undefined),
                metricServingAmount: volumeMl ?? suggestion.grams,
                metricServingUnit: countServing ? (countUnit ?? suggestion.volumeUnit ?? 'count') : volumeMl ? 'ml' : 'g',
                servingWeightGrams: suggestion.grams,
                volumeMl,
                isVolume: gapType === 'volume',
                isDefault: false,
                derivedViaDensity: volumeMl != null && !countServing,
                densityEstimateId,
                source: 'ai',
                confidence: suggestion.confidence,
                note: suggestion.rationale,
            },
            update: {
                measurementDescription: suggestion.servingLabel,
                numberOfUnits: suggestion.volumeAmount ?? (countServing ? 1 : undefined),
                metricServingAmount: volumeMl ?? suggestion.grams,
                metricServingUnit: countServing ? (countUnit ?? suggestion.volumeUnit ?? 'count') : volumeMl ? 'ml' : 'g',
                servingWeightGrams: suggestion.grams,
                volumeMl,
                isVolume: gapType === 'volume',
                derivedViaDensity: volumeMl != null && !countServing,
                densityEstimateId,
                source: 'ai',
                confidence: suggestion.confidence,
                note: suggestion.rationale,
            },
        });
    });

    logger.info(
        { foodId, servingId, gapType, label: suggestion.servingLabel },
        'Inserted AI-derived FatSecret serving',
    );

    return { success: true };
}
