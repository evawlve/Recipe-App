import { fdcApi } from './fdc-api';
import { parseIngredientLine } from '../parse/ingredient-line';
import { normalizeIngredientName } from '../fatsecret/normalization-rules';
import { debugLogger } from '../fatsecret/debug-logger';
import { prisma } from '../db';
import { insertFdcAiServing } from './fdc-ai-backfill';

export type FdcMappedIngredient = {
    source: 'fdc';
    fdcId: number;
    description: string;
    brandName?: string;
    confidence: number;
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
    grams: number; // Normalized to 100g usually, or serving size if available
};

function normalizeQuery(q: string): string {
    return q.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

function calculateConfidence(query: string, food: { description: string; brandName?: string }, baseScore: number): number {
    const normalizedQuery = normalizeQuery(query);
    const normalizedFood = normalizeQuery(food.description);

    // Exact match bonus
    if (normalizedQuery === normalizedFood) return Math.min(1, baseScore + 0.2);

    // Token overlap
    const queryTokens = new Set(normalizedQuery.split(/\s+/));
    const foodTokens = new Set(normalizedFood.split(/\s+/));
    let overlap = 0;
    for (const t of queryTokens) {
        if (foodTokens.has(t)) overlap++;
    }
    const overlapScore = overlap / queryTokens.size;

    return Math.min(1, baseScore * 0.6 + overlapScore * 0.4);
}

export async function mapIngredientWithFdc(rawLine: string): Promise<FdcMappedIngredient | null> {
    const parsed = parseIngredientLine(rawLine);
    const query = parsed?.name || rawLine;
    const normalized = normalizeIngredientName(query);
    const queryTerm = normalized.cleaned || query;

    try {
        const results = await fdcApi.searchFoods({ query: queryTerm, pageSize: 5 });

        if (!results || !results.foods || results.foods.length === 0) {
            return null;
        }

        // Score candidates
        const candidates = results.foods.map(food => {
            // Prefer Foundation foods over Branded for generic queries
            const isBranded = food.dataType === 'Branded';
            const baseScore = isBranded ? 0.7 : 0.9;

            const confidence = calculateConfidence(queryTerm, food, baseScore);

            return { food, confidence };
        }).sort((a, b) => b.confidence - a.confidence);

        const best = candidates[0];
        if (!best || best.confidence < 0.4) return null;

        // Check Cache First
        const cachedFood = await (prisma as any).fdcFoodCache.findUnique({
            where: { id: best.food.fdcId },
            include: { servings: true }
        });

        let details: any;
        let nutrients: any[];

        if (cachedFood) {
            details = {
                description: cachedFood.description,
                foodNutrients: cachedFood.nutrients as any[],
                servingSize: cachedFood.servingSize,
                servingSizeUnit: cachedFood.servingSizeUnit
            };
            nutrients = details.foodNutrients;
        } else {
            // Fetch full details from API
            details = await fdcApi.getFoodDetails(best.food.fdcId);
            if (!details) return null;
            nutrients = details.foodNutrients || [];

            // Run AI Backfill for Servings if needed
            try {
                // Determine if we need volume servings
                // If servingSizeUnit is missing or weight-based (g, oz), we likely need volume
                const needsVolume = !details.servingSizeUnit || ['g', 'gram', 'oz', 'ounce'].includes(details.servingSizeUnit.toLowerCase());

                // Save to Cache first so AI backfill can find it
                await (prisma as any).fdcFoodCache.create({
                    data: {
                        id: best.food.fdcId,
                        description: details.description,
                        brandName: best.food.brandName,
                        dataType: best.food.dataType,
                        nutrients: nutrients,
                        servingSize: details.servingSize,
                        servingSizeUnit: details.servingSizeUnit,
                    }
                });

                if (needsVolume) {
                    // We need to insert AI serving. 
                    // Note: insertFdcAiServing expects the food to be in cache!
                    await insertFdcAiServing(best.food.fdcId, 'volume');
                }
            } catch (err) {
                console.error('Failed to cache FDC food or run AI backfill', err);
            }
        }

        // Extract nutrients (FDC uses nutrientId or nutrientName)
        // Common IDs: 1008=Energy(kcal), 1003=Protein, 1005=Carbs, 1004=Fat
        const getNutrient = (id: number) => {
            const n = nutrients.find((x: any) => x.nutrient?.id === id || x.nutrientId === id);
            return n?.amount || 0;
        };

        const kcal = getNutrient(1008);
        const protein = getNutrient(1003);
        const carbs = getNutrient(1005);
        const fat = getNutrient(1004);

        // Determine serving size
        let grams = 100;

        if (details.servingSize && details.servingSizeUnit) {
            grams = details.servingSize;
        }

        return {
            source: 'fdc',
            fdcId: best.food.fdcId,
            description: best.food.description,
            brandName: best.food.brandName,
            confidence: best.confidence,
            kcal,
            protein,
            carbs,
            fat,
            grams
        };
    } catch (e) {
        console.error('FDC mapping error', e);
        return null;
    }
}
