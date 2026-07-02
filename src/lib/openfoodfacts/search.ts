/**
 * OpenFoodFacts Local Search
 *
 * Searches the local OffFood table for products matching the query.
 * Returns results shaped as UnifiedCandidate.
 */

import { prisma } from '../db';
import { logger } from '../logger';
import type { UnifiedCandidate } from '../mapping/gather-candidates';
import { MEILISEARCH_ENABLED } from '../mapping/config';
import { searchMeili } from '../search/meilisearch-client';

// ============================================================
// Scoring Helpers
// ============================================================

function computeOffScore(
    query: string,
    productName: string,
    brandName: string | null,
    isBrandedQuery: boolean,
): number {
    const queryLower  = query.toLowerCase();
    const nameLower   = productName.toLowerCase();
    const brandLower  = (brandName ?? '').toLowerCase();
    const queryWords  = queryLower.split(/\s+/).filter(w => w.length > 1);

    let score = 0;

    // Brand match bonus — strong signal when user explicitly named the brand
    if (isBrandedQuery && brandLower && queryLower.includes(brandLower)) {
        score += 4;
    }

    // Name starts with query (most relevant)
    if (nameLower.startsWith(queryLower)) {
        score += 3;
    }

    // Per-word overlap
    for (const word of queryWords) {
        if (nameLower.includes(word)) {
            score += 2;
        } else {
            score -= 1;
        }
    }

    return score;
}

/**
 * Shape a cached DB row into a UnifiedCandidate.
 */
function cachedRowToCandidate(
    row: any,
    query: string,
    isBrandedQuery: boolean,
): UnifiedCandidate {
    const n = (row.nutrientsPer100g ?? {}) as Record<string, number>;
    const kcal    = n['calories'] ?? n['kcal'] ?? 0;
    const protein = n['protein']  ?? 0;
    const carbs   = n['carbs']    ?? 0;
    const fat     = n['fat']      ?? 0;
    const hasNutrition = kcal > 0 || protein > 0 || carbs > 0 || fat > 0;

    return {
        id:        `off_${row.barcode}`,
        source:    'openfoodfacts',
        name:      row.name,
        brandName: row.brandName,
        score:     computeOffScore(query, row.name, row.brandName, isBrandedQuery),
        nutrition: hasNutrition
            ? { kcal, protein, carbs, fat, per100g: true }
            : undefined,
        rawData: {
            barcode:         row.barcode,
            name:            row.name,
            brandName:       row.brandName,
            nutrientsPer100g: row.nutrientsPer100g,
            servingGrams:    row.servingGrams,
            servingSize:     row.servingSize,
        },
    };
}

// ============================================================
// Main Export
// ============================================================

export interface SearchOffOptions {
    limit?: number;
    isBrandedQuery?: boolean;
}

/**
 * Local-only search for OpenFoodFacts products.
 */
export async function searchOffSimple(
    query: string,
    options: SearchOffOptions = {},
): Promise<UnifiedCandidate[]> {
    const { limit = 5, isBrandedQuery = false } = options;

    const queryLower = query.toLowerCase().trim();

    if (MEILISEARCH_ENABLED) {
        try {
            const hits = await searchMeili('off_foods', query, limit * 2);
            if (hits.length > 0) {
                const candidates = hits
                    .map(hit => {
                        const n = (hit.nutrientsPer100g ?? {}) as Record<string, number>;
                        const kcal    = n['calories'] ?? n['kcal'] ?? 0;
                        const protein = n['protein']  ?? 0;
                        const carbs   = n['carbs']    ?? 0;
                        const fat     = n['fat']      ?? 0;
                        const hasNutrition = kcal > 0 || protein > 0 || carbs > 0 || fat > 0;

                        return {
                            id:        `off_${hit.barcode}`,
                            source:    'openfoodfacts' as const,
                            name:      hit.name,
                            brandName: hit.brandName || null,
                            score:     computeOffScore(query, hit.name, hit.brandName, isBrandedQuery),
                            nutrition: hasNutrition
                                ? { kcal, protein, carbs, fat, per100g: true }
                                : undefined,
                            rawData: {
                                barcode:         hit.barcode,
                                name:            hit.name,
                                brandName:       hit.brandName,
                                nutrientsPer100g: hit.nutrientsPer100g,
                                servingGrams:    hit.servingGrams,
                                servingSize:     hit.servingSize,
                            },
                        };
                    })
                    .sort((a, b) => b.score - a.score)
                    .slice(0, limit);
                
                logger.debug('off.search.meilisearch_hit', { query, count: candidates.length });
                return candidates;
            }
        } catch (err) {
            logger.warn('off.search.meilisearch_failed_fallback_to_postgres', {
                query,
                error: (err as Error).message,
            });
        }
    }

    try {
        const results = await prisma.offFood.findMany({
            where: {
                OR: [
                    { name:      { contains: queryLower, mode: 'insensitive' } },
                    { brandName: { contains: queryLower, mode: 'insensitive' } },
                ],
            },
            take: limit * 2,  // Fetch extras so we can sort and trim
            orderBy: { name: 'asc' }, // fallback order
        });

        const candidates = results
            .map(row => cachedRowToCandidate(row, query, isBrandedQuery))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        logger.debug('off.search.local_hit', {
            query,
            count: candidates.length,
            isBrandedQuery,
        });

        return candidates;
    } catch (err) {
        logger.warn('off.search.local_lookup_failed', {
            query,
            error: (err as Error).message,
        });
        return [];
    }
}
