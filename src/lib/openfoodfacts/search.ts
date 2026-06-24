/**
 * OpenFoodFacts Cache-First Search
 *
 * Two-tier lookup:
 *   1. DB cache (OpenFoodFactsCache table) — exact brand-name match first,
 *      then full-text LIKE on product name.
 *   2. Live OFF API via searchOff() — only called on a cache miss.
 *
 * Returns results shaped as UnifiedCandidate so gather-candidates.ts can
 * merge them into the standard scoring pipeline without special-casing.
 */

import { prisma } from '../db';
import { logger } from '../logger';
import type { UnifiedCandidate } from '../fatsecret/gather-candidates';
import { searchOff } from './client';
import type { OFFProduct } from './client';

// ============================================================
// Scoring Helpers
// ============================================================

/**
 * Compute a preliminary relevance score for an OFF product given the query.
 *
 * Criteria (additive):
 *  +4 — brand token found in query (user explicitly named this brand)
 *  +3 — product name starts with the query
 *  +2 — each query word found in product name (capped at 6 words)
 *  -1 — each query word NOT found in product name
 *
 * The scores are rough — simpleRerank will do the final accurate scoring.
 */
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
 * Shape an OFFProduct into a UnifiedCandidate.
 */
function toUnifiedCandidate(
    product: OFFProduct,
    query: string,
    isBrandedQuery: boolean,
): UnifiedCandidate {
    const foodId = `off_${product.code}`;
    const brand  = product.brands?.split(',')[0].trim() ?? null;

    const n = product.nutriments;
    const kcal    = n['energy-kcal_100g'] ?? 0;
    const protein = n['proteins_100g']    ?? 0;
    const carbs   = n['carbohydrates_100g'] ?? 0;
    const fat     = n['fat_100g']         ?? 0;

    const hasNutrition = kcal > 0 || protein > 0 || carbs > 0 || fat > 0;

    return {
        id:        foodId,
        source:    'openfoodfacts',
        name:      product.product_name,
        brandName: brand,
        score:     computeOffScore(query, product.product_name, brand, isBrandedQuery),
        nutrition: hasNutrition
            ? { kcal, protein, carbs, fat, per100g: true }
            : undefined,
        rawData: product,   // Full OFFProduct so hydrateOffCandidate can upsert it
    };
}

/**
 * Shape a cached DB row into a UnifiedCandidate (avoids live API call).
 */
function cachedRowToCandidate(
    row: {
        id: string;
        name: string;
        brandName: string | null;
        nutrientsPer100g: unknown;
        servingGrams: number | null;
        servingSize: string | null;
        barcode: string;
    },
    query: string,
    isBrandedQuery: boolean,
): UnifiedCandidate {
    const n = (row.nutrientsPer100g ?? {}) as Record<string, number>;
    // bulk-seed-branded-off.ts stores energy as 'kcal'; hydrate.ts uses 'calories'.
    // Accept both keys so scoring works for all 15k bulk-seeded rows.
    const kcal    = n['calories'] ?? n['kcal'] ?? 0;
    const protein = n['protein']  ?? 0;
    const carbs   = n['carbs']    ?? 0;
    const fat     = n['fat']      ?? 0;
    const hasNutrition = kcal > 0 || protein > 0 || carbs > 0 || fat > 0;

    return {
        id:        row.id,
        source:    'openfoodfacts',
        name:      row.name,
        brandName: row.brandName,
        score:     computeOffScore(query, row.name, row.brandName, isBrandedQuery),
        nutrition: hasNutrition
            ? { kcal, protein, carbs, fat, per100g: true }
            : undefined,
        // rawData mirrors the cache shape — hydrateOffCandidate handles both forms
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
    /** Number of results to return (default 5) */
    limit?: number;
    /** If true, brand-name overlap gets a scoring bonus */
    isBrandedQuery?: boolean;
    /** Skip the live API and return only cached results (e.g. quick gate checks) */
    cacheOnly?: boolean;
}

/**
 * Cache-first search for OpenFoodFacts products.
 *
 * 1. Hit the local DB (OpenFoodFactsCache) for expired+unexpired rows.
 * 2. If enough fresh cache hits exist, return them without calling the OFF API.
 * 3. Otherwise, call searchOff() and return results (they are hydrated on first
 *    win, not on every search hit — see hydrateOffCandidate).
 *
 * Returns an empty array on any error so callers are never blocked.
 */
export async function searchOffSimple(
    query: string,
    options: SearchOffOptions = {},
): Promise<UnifiedCandidate[]> {
    const { limit = 5, isBrandedQuery = false, cacheOnly = false } = options;

    const queryLower = query.toLowerCase().trim();

    // ── 1. DB Cache Lookup ─────────────────────────────────────────────────
    try {
        const cached = await prisma.openFoodFactsCache.findMany({
            where: {
                expiresAt: { gt: new Date() },   // Only fresh cache rows
                OR: [
                    { name:      { contains: queryLower, mode: 'insensitive' } },
                    { brandName: { contains: queryLower, mode: 'insensitive' } },
                ],
            },
            take: limit * 2,  // Fetch extras so we can sort and trim
            orderBy: { syncedAt: 'desc' },
        });

        if (cached.length >= limit) {
            // Good cache coverage — return without hitting the live API
            const candidates = cached
                .map(row => cachedRowToCandidate(row, query, isBrandedQuery))
                .sort((a, b) => b.score - a.score)
                .slice(0, limit);

            logger.debug('off.search.cache_hit', {
                query,
                count: candidates.length,
                isBrandedQuery,
            });

            return candidates;
        }
    } catch (err) {
        logger.warn('off.search.cache_lookup_failed', {
            query,
            error: (err as Error).message,
        });
        // Fall through to live API
    }

    // ── 2. Live API ────────────────────────────────────────────────────────
    if (cacheOnly) {
        return [];
    }

    try {
        const products = await searchOff(query, limit * 2);

        const candidates = products
            .map(p => toUnifiedCandidate(p, query, isBrandedQuery))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        logger.debug('off.search.api_hit', {
            query,
            returned: products.length,
            scored: candidates.length,
            isBrandedQuery,
        });

        return candidates;
    } catch (err) {
        logger.warn('off.search.api_failed', {
            query,
            error: (err as Error).message,
        });
        return [];
    }
}
