/**
 * OpenFoodFacts Local Search
 *
 * Searches the local OffFood table for products matching the query.
 * Returns results shaped as UnifiedCandidate.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { isCorruptExclusionEnabled } from '../mapping/corrupt-mark';
import type { UnifiedCandidate } from '../mapping/gather-candidates';

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

    // Penalize excessively long titles to favor clean, concise names (document length normalization)
    const wordCount = nameLower.split(/\s+/).filter(Boolean).length;
    score -= wordCount * 0.05;

    return score;
}

/**
 * A candidate with no nutrition data at all can never produce usable macros —
 * drop it at the source. Rows with explicit zeros are kept: zero-calorie
 * products (water, diet soda) are legitimate, and the contextual zero-macro
 * filter downstream handles the suspicious ones.
 */
function hasUsableNutrition(n: unknown): boolean {
    if (!n || typeof n !== 'object') return false;
    return Object.values(n).some(v => typeof v === 'number' && Number.isFinite(v));
}

function candidateHasUsableNutrition(c: UnifiedCandidate): boolean {
    return hasUsableNutrition((c.rawData as any)?.nutrientsPer100g);
}

function decodeHtmlEntities(str: string): string {
    if (!str) return '';
    return str
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");
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

    const decodedName = decodeHtmlEntities(row.name);

    return {
        id:        `off_${row.barcode}`,
        source:    'openfoodfacts',
        name:      decodedName,
        brandName: row.brandName,
        score:     computeOffScore(query, decodedName, row.brandName, isBrandedQuery),
        nutrition: hasNutrition
            ? { kcal, protein, carbs, fat, per100g: true }
            : undefined,
        rawData: {
            barcode:         row.barcode,
            name:            decodedName,
            brandName:       row.brandName,
            nutrientsPer100g: row.nutrientsPer100g,
            servingGrams:    row.servingGrams,
            servingSize:     row.servingSize,
        },
    };
}

function mapOffHitToCandidate(hit: any, query: string, isBrandedQuery: boolean): UnifiedCandidate {
    let n = hit.nutrientsPer100g || {};
    if (typeof n === 'string') {
        try { n = JSON.parse(n); } catch (e) {}
    }

    const kcal    = n['calories'] ?? n['kcal'] ?? 0;
    const protein = n['protein']  ?? 0;
    const carbs   = n['carbs']    ?? 0;
    const fat     = n['fat']      ?? 0;
    const hasNutrition = kcal > 0 || protein > 0 || carbs > 0 || fat > 0;

    const decodedName = decodeHtmlEntities(hit.name);

    return {
        id:        `off_${hit.barcode}`,
        source:    'openfoodfacts' as const,
        name:      decodedName,
        brandName: hit.brandName || null,
        score:     computeOffScore(query, decodedName, hit.brandName, isBrandedQuery),
        nutrition: hasNutrition
            ? { kcal, protein, carbs, fat, per100g: true }
            : undefined,
        rawData: {
            barcode:         hit.barcode,
            name:            hit.name,
            brandName:       hit.brandName,
            nutrientsPer100g: n,
            servingGrams:    hit.servingGrams,
            servingSize:     hit.servingSize,
        },
    };
}

// ============================================================
// Semantic (vector) Search
// ============================================================

// Hits below this cosine similarity are noise, not matches. Verified
// similarities for good matches ran 0.87–0.96 during the 2026-07-13 backfill.
const SEMANTIC_MIN_SIMILARITY = 0.72;

/**
 * Semantic nearest-neighbor search over the OFF corpus (only source with
 * embeddings today). Recall net for queries whose wording doesn't match
 * product names ("protein yogurt" → "Oikos Triple Zero").
 *
 * Returns [] whenever semantic search is disabled or any stage fails —
 * the keyword path must never depend on this.
 */
export async function searchOffSemantic(
    query: string,
    options: SearchOffOptions = {},
): Promise<UnifiedCandidate[]> {
    const { limit = 5, isBrandedQuery = false } = options;

    try {
        const { embedQuery } = await import('../search/query-embedding');
        const embedding = await embedQuery(query);
        if (!embedding) return [];

        const { vectorSearchTypesense } = await import('../search/typesense-client');
        const hits = await vectorSearchTypesense('off_foods', embedding, limit * 2);

        const candidates: UnifiedCandidate[] = [];
        for (const hit of hits) {
            const similarity = 1 - (hit._vectorDistance ?? 1);
            if (similarity < SEMANTIC_MIN_SIMILARITY) continue;

            const candidate = mapOffHitToCandidate(hit, query, isBrandedQuery);
            if (!candidateHasUsableNutrition(candidate)) continue;
            // Keyword score can go negative on semantic-only matches (little
            // token overlap); similarity is the honest signal for these.
            candidate.score = Math.max(candidate.score, similarity);
            candidate.semanticSimilarity = similarity;
            candidates.push(candidate);
        }

        const top = candidates
            .sort((a, b) => (b.semanticSimilarity ?? 0) - (a.semanticSimilarity ?? 0))
            .slice(0, limit);

        logger.debug('off.search.semantic_hit', {
            query,
            count: top.length,
            topSimilarity: top[0]?.semanticSimilarity ?? null,
        });
        return top;
    } catch (err) {
        logger.warn('off.search.semantic_failed', {
            query,
            error: (err as Error).message,
        });
        return [];
    }
}

// ============================================================
// Main Export
// ============================================================

export interface SearchOffOptions {
    limit?: number;
    isBrandedQuery?: boolean;
    /**
     * Set when the user's line counts pieces of a packaged snack ("13 tortilla
     * chips"). Adds a secondary Typesense query filtered to SKUs whose label
     * serving enumerates pieces (hasCountServing) so those candidates reach the
     * rerank pool even when plain name relevance wouldn't surface them.
     */
    countedPieceQuery?: boolean;
}

/** Extra count-labeled SKUs appended to the pool for counted-piece queries. */
const COUNT_LABELED_EXTRA = 3;

/**
 * Secondary retrieval for counted-piece queries: same keyword search, but
 * filtered to count-labeled SKUs. Failure (e.g. the hasCountServing field is
 * not in the collection schema yet) is non-fatal — the primary results stand.
 */
async function searchOffCountLabeled(
    query: string,
    isBrandedQuery: boolean,
): Promise<UnifiedCandidate[]> {
    try {
        const { searchTypesense } = await import('../search/typesense-client');
        const hits = await searchTypesense(
            'off_foods', query, 'name,brandName', COUNT_LABELED_EXTRA * 2, 'hasCountServing:=true');
        const candidates = hits
            .map(hit => mapOffHitToCandidate(hit, query, isBrandedQuery))
            .filter(candidateHasUsableNutrition)
            .sort((a, b) => b.score - a.score)
            .slice(0, COUNT_LABELED_EXTRA);
        logger.debug('off.search.count_labeled_hit', { query, count: candidates.length });
        return candidates;
    } catch (err) {
        logger.debug('off.search.count_labeled_failed', {
            query,
            error: (err as Error).message,
        });
        return [];
    }
}

/**
 * Local-only search for OpenFoodFacts products.
 */
export async function searchOffSimple(
    query: string,
    options: SearchOffOptions = {},
): Promise<UnifiedCandidate[]> {
    const { limit = 5, isBrandedQuery = false, countedPieceQuery = false } = options;

    const queryLower = query.toLowerCase().trim();

    try {
        const { searchTypesense } = await import('../search/typesense-client');
        const hits = await searchTypesense('off_foods', query, 'name,brandName', limit * 2);
        if (hits.length > 0) {
            const candidates = hits
                .map(hit => mapOffHitToCandidate(hit, query, isBrandedQuery))
                .filter(candidateHasUsableNutrition)
                .sort((a, b) => b.score - a.score)
                .slice(0, limit);

            // Counted-piece queries: append count-labeled SKUs the primary
            // search didn't surface. They still have to win rerank on merit.
            if (countedPieceQuery) {
                const seen = new Set(candidates.map(c => c.id));
                for (const extra of await searchOffCountLabeled(query, isBrandedQuery)) {
                    if (!seen.has(extra.id)) candidates.push(extra);
                }
            }

            logger.debug('off.search.typesense_hit', { query, count: candidates.length });
            return candidates;
        }
    } catch (err) {
        logger.warn('off.search.typesense_failed_fallback_to_postgres', {
            query,
            error: (err as Error).message,
        });
    }

    try {
        const results = await prisma.offFood.findMany({
            where: {
                nutrientsPer100g: { not: Prisma.DbNull },
                duplicateOfBarcode: null,
                ...(isCorruptExclusionEnabled() ? { corruptReason: null } : {}),
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
            .filter(candidateHasUsableNutrition)
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
