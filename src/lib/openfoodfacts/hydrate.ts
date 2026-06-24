/**
 * OpenFoodFacts Hydration
 *
 * Persists an OFF product (from the search response) into the local
 * OpenFoodFactsCache + OpenFoodFactsServingCache tables.
 *
 * Key difference from FatSecret hydration:
 *   OFF products already include macros in the search response — no
 *   separate "food.get" API call needed. rawData IS the full OFFProduct.
 */

import { prisma } from '../db';
import { logger } from '../logger';
import type { OFFProduct, OFFNutriments } from './client';
import { parseOffServingSize } from './serving-resolver';

// ============================================================
// Types
// ============================================================

export interface HydratedOffFood {
    foodId: string;                                 // "off_<barcode>"
    foodName: string;
    brandName: string | null;
    nutrientsPer100g: Record<string, number> | null; // null → AI nutrition backfill will fill
    servingGrams: number | null;
}

// ============================================================
// Public API
// ============================================================

/**
 * Hydrate an OpenFoodFacts candidate into the local DB cache.
 *
 * Called when an OFF candidate wins the scoring phase in
 * map-ingredient-with-fallback.ts.
 *
 * Idempotent — safe to call multiple times for the same barcode.
 *
 * @param candidate - A UnifiedCandidate with source='openfoodfacts'
 *                    and rawData containing the full OFFProduct.
 */
export async function hydrateOffCandidate(candidate: {
    id: string;       // "off_<barcode>"
    name: string;
    rawData: unknown;
}): Promise<HydratedOffFood> {
    // ── 1. Assert rawData is present ──────────────────────────────────────
    if (!candidate.rawData) {
        throw new Error(
            `hydrateOffCandidate: missing rawData on candidate ${candidate.id}`
        );
    }

    // ── 2. Cache-first: return immediately if already hydrated ───────────
    const existing = await prisma.openFoodFactsCache.findUnique({
        where: { id: candidate.id },
    });
    if (existing) {
        return {
            foodId:          existing.id,
            foodName:        existing.name,
            brandName:       existing.brandName,
            nutrientsPer100g: existing.nutrientsPer100g as Record<string, number> | null,
            servingGrams:    existing.servingGrams,
        };
    }

    // ── 3. Extract product from rawData ───────────────────────────────────
    // rawData may be an OFFProduct (live search) or an OpenFoodFactsCache
    // row (cache hit in searchOffSimple). Handle both shapes.
    const rawData = candidate.rawData as Record<string, unknown>;

    // Distinguish cache row vs live OFFProduct:
    //   - OFFProduct has `nutriments` (object)
    //   - Cache row has `nutrientsPer100g` (JSON column)
    const isLiveProduct = typeof rawData['nutriments'] === 'object';

    let product: OFFProduct;
    if (isLiveProduct) {
        product = rawData as unknown as OFFProduct;
    } else {
        // rawData is a cached row — re-shape it into OFFProduct for processing
        const nutrients = (rawData['nutrientsPer100g'] ?? {}) as Record<string, number>;
        product = {
            code:             (rawData['barcode'] as string) ?? candidate.id.replace(/^off_/, ''),
            product_name:     (rawData['name'] as string)    ?? candidate.name,
            brands:           (rawData['brandName'] as string | undefined) ?? undefined,
            serving_size:     rawData['servingSize'] as string | undefined,
            serving_quantity: rawData['servingGrams'] as number | undefined,
            nutriments: {
                'energy-kcal_100g':     nutrients['calories'],
                'proteins_100g':        nutrients['protein'],
                'carbohydrates_100g':   nutrients['carbs'],
                'fat_100g':             nutrients['fat'],
                'fiber_100g':           nutrients['fiber'],
                'sugars_100g':          nutrients['sugars'],
                'sodium_100g':          nutrients['sodium'],
            },
        };
    }

    const barcode = candidate.id.replace(/^off_/, '');

    // ── 4. Extract and validate nutrients ─────────────────────────────────
    const nutrientsPer100g = extractAndValidateNutrients(product.nutriments);

    // ── 5. Parse serving size ─────────────────────────────────────────────
    const { grams: servingGrams, description: servingDescription } =
        parseOffServingSize(product.serving_size, product.serving_quantity);

    const primaryBrand = product.brands?.split(',')[0].trim() ?? null;

    // ── 6. Upsert into OpenFoodFactsCache ─────────────────────────────────
    await prisma.openFoodFactsCache.upsert({
        where:  { id: candidate.id },
        create: {
            id:               candidate.id,
            barcode,
            name:             product.product_name,
            brandName:        primaryBrand,
            nutrientsPer100g: nutrientsPer100g ?? undefined,
            servingSize:      product.serving_size ?? null,
            servingGrams:     servingGrams ?? null,
            expiresAt:        new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
        },
        update: {
            syncedAt: new Date(),
        },
    });

    // ── 7. Upsert label-derived serving into OpenFoodFactsServingCache ────
    if (servingGrams && servingDescription) {
        await prisma.openFoodFactsServingCache.upsert({
            where: {
                offId_description: {
                    offId:       candidate.id,
                    description: servingDescription,
                },
            },
            create: {
                offId:       candidate.id,
                description: servingDescription,
                grams:       servingGrams,
                source:      'openfoodfacts',
                isAiEstimated: false,
            },
            update: {
                grams: servingGrams,
            },
        });
    }

    logger.info('off.hydrate.complete', {
        foodId:   candidate.id,
        foodName: product.product_name,
        brandName: primaryBrand,
        hasNutrients: nutrientsPer100g !== null,
        servingGrams,
    });

    return {
        foodId:           candidate.id,
        foodName:         product.product_name,
        brandName:        primaryBrand,
        nutrientsPer100g,
        servingGrams:     servingGrams ?? null,
    };
}

// ============================================================
// OFF Data Quality Gate
// ============================================================

/**
 * Extract macros from OFF nutriments and validate data quality.
 *
 * Returns null when:
 *   - All macros are zero / missing (product has no data)
 *   - kcal > 980 (suspiciously high — likely a data entry error)
 *   - Atwater check fails with > 20% tolerance (internally inconsistent data)
 *
 * When null is returned the product is still cached (name/brand are useful
 * for scoring), but ai-nutrition-backfill.ts will generate macros on first use.
 */
export function extractAndValidateNutrients(
    raw: OFFNutriments,
): Record<string, number> | null {
    const kcal    = raw['energy-kcal_100g']       ?? 0;
    const protein = raw['proteins_100g']          ?? 0;
    const carbs   = raw['carbohydrates_100g']     ?? 0;
    const fat     = raw['fat_100g']               ?? 0;

    // Guard 1: all macros are zero → no nutritional data at all
    if (kcal === 0 && protein === 0 && carbs === 0 && fat === 0) {
        return null;
    }

    // Guard 2: kcal wildly high for a non-oil product (oils are ~900 kcal/100g)
    if (kcal > 980) {
        return null;
    }

    // Guard 3: Atwater consistency check — allow 20% tolerance
    // kcal should ≈ protein×4 + carbs×4 + fat×9
    const atwater = protein * 4 + carbs * 4 + fat * 9;
    if (kcal > 5 && Math.abs(kcal - atwater) / kcal > 0.20) {
        return null;
    }

    return {
        calories: kcal,
        protein,
        carbs,
        fat,
        fiber:   raw['fiber_100g']   ?? 0,
        sugars:  raw['sugars_100g']  ?? 0,
        sodium:  raw['sodium_100g']  ?? 0,
    };
}
