/**
 * Cross-Reference Serving Lookup
 * 
 * Finds serving weights from similar foods to help estimate unknown servings.
 * Example: "slice" serving for "Uncured Capocollo" → find other capocollo entries with slice servings
 */

import { prisma } from '../db';
import { logger } from '../logger';

export interface SimilarServingMatch {
    foodId: string;
    foodName: string;
    brandName?: string;
    servingDescription: string;
    grams: number;
    source: 'fatsecret' | 'fdc';
}

export interface SimilarServingResult {
    found: boolean;
    matches: SimilarServingMatch[];
    averageGrams?: number;
    confidence: number;  // Higher if matches agree (low variance)
}

// Common serving unit variations to match
const SERVING_UNIT_ALIASES: Record<string, string[]> = {
    slice: ['slice', 'slices', 'sliced'],
    piece: ['piece', 'pieces', 'pc', 'pcs'],
    cup: ['cup', 'cups'],
    tbsp: ['tbsp', 'tablespoon', 'tablespoons'],
    tsp: ['tsp', 'teaspoon', 'teaspoons'],
    oz: ['oz', 'ounce', 'ounces'],
    item: ['item', 'items', 'each', 'ea'],
    serving: ['serving', 'servings'],
};

/**
 * Extract base food name for similarity search
 * "Uncured Capocollo" → "capocollo"
 * "Niman Ranch Capocollo" → "capocollo"
 */
function extractBaseFoodName(fullName: string): string {
    const lower = fullName.toLowerCase();

    // Remove common prefixes/modifiers
    const removePatterns = [
        /^(uncured|cured|smoked|sliced|diced|chopped|fresh|frozen|organic|natural)\s+/i,
        /\s+(uncured|cured|smoked|sliced|diced|chopped|fresh|frozen|organic|natural)$/i,
    ];

    let cleaned = lower;
    for (const pattern of removePatterns) {
        cleaned = cleaned.replace(pattern, '');
    }

    // Get the last word(s) which is usually the main food item
    const words = cleaned.trim().split(/\s+/);

    // For compound names, take last 1-2 significant words
    if (words.length >= 2) {
        return words.slice(-2).join(' ');
    }
    return words[0] || lower;
}

/**
 * Find the serving unit pattern to search for
 */
function getServingUnitPatterns(unit: string): string[] {
    const lower = unit.toLowerCase().trim();

    // Check aliases
    for (const [key, aliases] of Object.entries(SERVING_UNIT_ALIASES)) {
        if (aliases.includes(lower) || key === lower) {
            return aliases;
        }
    }

    // Return as-is if no alias found
    return [lower];
}

/**
 * Find similar foods in FatSecret cache that have the target serving type
 */
async function findSimilarServingsInFatSecret(
    baseFoodName: string,
    servingUnit: string
): Promise<SimilarServingMatch[]> {
    const unitPatterns = getServingUnitPatterns(servingUnit);

    // Search for foods with similar names
    const similarFoods = await prisma.fatSecretFoodCache.findMany({
        where: {
            name: {
                contains: baseFoodName,
                mode: 'insensitive',
            },
        },
        include: {
            servings: true,
        },
        take: 20,
    });

    const matches: SimilarServingMatch[] = [];

    for (const food of similarFoods) {
        for (const serving of food.servings) {
            const desc = (serving.measurementDescription || '').toLowerCase();
            const matchesUnit = unitPatterns.some(pattern =>
                desc.includes(pattern) || desc === pattern
            );

            if (matchesUnit && serving.servingWeightGrams && serving.servingWeightGrams > 0) {
                matches.push({
                    foodId: food.id,
                    foodName: food.name,
                    brandName: food.brandName || undefined,
                    servingDescription: serving.measurementDescription || servingUnit,
                    grams: serving.servingWeightGrams,
                    source: 'fatsecret',
                });
            }
        }
    }

    return matches;
}

/**
 * Find similar foods in FDC cache that have the target serving type
 */
async function findSimilarServingsInFdc(
    baseFoodName: string,
    servingUnit: string
): Promise<SimilarServingMatch[]> {
    const unitPatterns = getServingUnitPatterns(servingUnit);

    // Search for foods with similar names
    const similarFoods = await prisma.fdcFoodCache.findMany({
        where: {
            description: {
                contains: baseFoodName,
                mode: 'insensitive',
            },
        },
        include: {
            servings: true,
        },
        take: 20,
    });

    const matches: SimilarServingMatch[] = [];

    for (const food of similarFoods) {
        for (const serving of food.servings) {
            const desc = (serving.description || '').toLowerCase();
            const matchesUnit = unitPatterns.some(pattern =>
                desc.includes(pattern) || desc === pattern
            );

            if (matchesUnit && serving.grams && serving.grams > 0) {
                matches.push({
                    foodId: `fdc_${food.id}`,
                    foodName: food.description,
                    brandName: food.brandName || undefined,
                    servingDescription: serving.description,
                    grams: serving.grams,
                    source: 'fdc',
                });
            }
        }
    }

    return matches;
}

/**
 * Calculate confidence based on how well matches agree
 */
function calculateConfidence(matches: SimilarServingMatch[]): number {
    if (matches.length === 0) return 0;
    if (matches.length === 1) return 0.6;  // Single match - moderate confidence

    const weights = matches.map(m => m.grams);
    const avg = weights.reduce((a, b) => a + b, 0) / weights.length;

    // Calculate coefficient of variation (lower = more agreement)
    const variance = weights.reduce((sum, w) => sum + Math.pow(w - avg, 2), 0) / weights.length;
    const stdDev = Math.sqrt(variance);
    const cv = avg > 0 ? stdDev / avg : 1;

    // Convert CV to confidence (CV of 0 = 1.0 confidence, CV of 0.5+ = 0.5 confidence)
    if (cv < 0.1) return 0.95;      // Very tight agreement
    if (cv < 0.2) return 0.85;      // Good agreement
    if (cv < 0.35) return 0.7;      // Moderate agreement
    if (cv < 0.5) return 0.6;       // Weak agreement
    return 0.5;                      // High variance - low confidence
}

/**
 * Main function: Find similar foods' serving weights
 */
export async function findSimilarServings(
    foodName: string,
    targetServingUnit: string,
    excludeFoodId?: string
): Promise<SimilarServingResult> {
    const baseName = extractBaseFoodName(foodName);

    logger.debug('findSimilarServings.start', {
        foodName,
        baseName,
        targetServingUnit
    });

    try {
        // Search both FatSecret and FDC in parallel
        const [fatSecretMatches, fdcMatches] = await Promise.all([
            findSimilarServingsInFatSecret(baseName, targetServingUnit),
            findSimilarServingsInFdc(baseName, targetServingUnit),
        ]);

        // Combine and dedupe (exclude the food we're looking up for)
        let allMatches = [...fatSecretMatches, ...fdcMatches];

        if (excludeFoodId) {
            allMatches = allMatches.filter(m => m.foodId !== excludeFoodId);
        }

        if (allMatches.length === 0) {
            logger.debug('findSimilarServings.no_matches', { foodName, baseName });
            return { found: false, matches: [], confidence: 0 };
        }

        // Calculate average and confidence
        const avgGrams = allMatches.reduce((sum, m) => sum + m.grams, 0) / allMatches.length;
        const confidence = calculateConfidence(allMatches);

        logger.info('findSimilarServings.found', {
            foodName,
            baseName,
            targetServingUnit,
            matchCount: allMatches.length,
            averageGrams: avgGrams.toFixed(1),
            confidence,
        });

        return {
            found: true,
            matches: allMatches,
            averageGrams: avgGrams,
            confidence,
        };
    } catch (error) {
        logger.warn('findSimilarServings.error', {
            error: (error as Error).message,
            foodName,
        });
        return { found: false, matches: [], confidence: 0 };
    }
}

/**
 * Try to get a serving weight from similar foods first, before falling back to AI
 */
export async function tryServingFromSimilarFoods(
    foodId: string,
    foodName: string,
    targetServingUnit: string,
    minConfidence: number = 0.7
): Promise<{ success: boolean; grams?: number; confidence?: number; matches?: SimilarServingMatch[] }> {
    const result = await findSimilarServings(foodName, targetServingUnit, foodId);

    if (!result.found || result.matches.length < 2) {
        // Need at least 2 matches for confidence
        return { success: false };
    }

    if (result.confidence < minConfidence) {
        logger.debug('tryServingFromSimilarFoods.low_confidence', {
            foodId,
            foodName,
            confidence: result.confidence,
            minRequired: minConfidence,
        });
        return { success: false, confidence: result.confidence, matches: result.matches };
    }

    return {
        success: true,
        grams: result.averageGrams,
        confidence: result.confidence,
        matches: result.matches,
    };
}
