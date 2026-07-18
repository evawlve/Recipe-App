/**
 * Ambiguous Unit Backfill
 * 
 * Handles backfill for ambiguous units (container, scoop, bowl, etc.)
 * that require AI estimation to determine weight.
 * 
 * Saves to fdcServing, offServing, or aiGeneratedServing.
 * Uses simpler AI prompt focused on package/portion size estimation.
 */

import { prisma } from '../db';
import { logger } from '../logger';
import {
    isAmbiguousUnit,
    isEstimableUnknownUnit,
    estimateAmbiguousServing,
    AMBIGUOUS_UNITS,
} from '../ai/ambiguous-serving-estimator';

export { isAmbiguousUnit, AMBIGUOUS_UNITS };

export interface AmbiguousBackfillResult {
    status: 'success' | 'cached' | 'error';
    grams?: number;
    confidence?: number;
    error?: string;
}

async function findExistingServing(foodId: string, normalizedUnit: string) {
    if (foodId.startsWith('fdc_') || foodId.startsWith('fdc:')) {
        const id = foodId.startsWith('fdc:') ? parseInt(foodId.split(':')[1], 10) : parseInt(foodId.split('_')[1], 10);
        const s = await prisma.fdcServing.findUnique({
            where: {
                FdcServing_fdcId_description_key: { fdcId: id, description: normalizedUnit }
            }
        });
        return s ? { grams: s.grams } : null;
    } else if (foodId.startsWith('off_')) {
        const barcode = foodId.replace('off_', '');
        const s = await prisma.offServing.findUnique({
            where: {
                barcode_description: { barcode, description: normalizedUnit }
            }
        });
        return s ? { grams: s.grams } : null;
    } else {
        const s = await prisma.aiGeneratedServing.findUnique({
            where: {
                foodId_label: { foodId, label: normalizedUnit }
            }
        });
        return s ? { grams: s.grams } : null;
    }
}

async function upsertServing(
    foodId: string,
    normalizedUnit: string,
    grams: number,
    confidence: number,
    note?: string,
    source: string = 'ai',
    isAiEstimated: boolean = true,
) {
    if (foodId.startsWith('fdc_') || foodId.startsWith('fdc:')) {
        const id = foodId.startsWith('fdc:') ? parseInt(foodId.split(':')[1], 10) : parseInt(foodId.split('_')[1], 10);
        await prisma.fdcServing.upsert({
            where: {
                FdcServing_fdcId_description_key: { fdcId: id, description: normalizedUnit }
            },
            create: {
                fdcId: id,
                description: normalizedUnit,
                grams,
                source,
                isAiEstimated
            },
            update: {
                grams,
                source,
                isAiEstimated
            }
        });
    } else if (foodId.startsWith('off_')) {
        const barcode = foodId.replace('off_', '');
        await prisma.offServing.upsert({
            where: {
                barcode_description: { barcode, description: normalizedUnit }
            },
            create: {
                barcode,
                description: normalizedUnit,
                grams,
                source,
                isAiEstimated
            },
            update: {
                grams,
                source,
                isAiEstimated
            }
        });
    } else {
        await prisma.aiGeneratedServing.upsert({
            where: {
                foodId_label: { foodId, label: normalizedUnit }
            },
            create: {
                foodId,
                label: normalizedUnit,
                grams,
                aiConfidence: confidence,
                aiNotes: note
            },
            update: {
                grams,
                aiConfidence: confidence,
                aiNotes: note
            }
        });
    }
}

async function getExistingServingDescriptions(foodId: string): Promise<string[]> {
    if (foodId.startsWith('fdc_') || foodId.startsWith('fdc:')) {
        const id = foodId.startsWith('fdc:') ? parseInt(foodId.split(':')[1], 10) : parseInt(foodId.split('_')[1], 10);
        const servings = await prisma.fdcServing.findMany({
            where: { fdcId: id },
            select: { description: true }
        });
        return servings.map(s => s.description);
    } else if (foodId.startsWith('off_')) {
        const barcode = foodId.replace('off_', '');
        const servings = await prisma.offServing.findMany({
            where: { barcode },
            select: { description: true }
        });
        return servings.map(s => s.description);
    } else {
        const servings = await prisma.aiGeneratedServing.findMany({
            where: { foodId },
            select: { label: true }
        });
        return servings.map(s => s.label);
    }
}

// ============================================================
// Sibling-serving borrow
// ============================================================

function siblingSingularize(w: string): string {
    const s = w.toLowerCase();
    if (s.endsWith('ies')) return s.slice(0, -3) + 'y';
    if (s.endsWith('sses')) return s.slice(0, -2);
    if (s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1);
    return s;
}

function siblingLeadingCount(description: string): number {
    const m = description.match(/^\s*(\d+(?:\.\d+)?)/);
    if (!m) return 1;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) && n > 0 ? n : 1;
}

function median(nums: number[]): number {
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Confidence scales with the number of sibling samples backing the borrow. */
function siblingConfidence(sampleCount: number): number {
    return Math.min(0.6 + 0.1 * sampleCount, 0.95);
}

/**
 * Before AI-estimating an ambiguous serving, look for a GENUINE (label-derived)
 * serving of the same unit on another product from the SAME brand. Within a
 * brand's product line a "bar" or "scoop" is near-constant, so this resolves
 * the weight deterministically from real label data. OFF-only for v1.
 *
 * The requested unit self-segments the product line: only bar SKUs carry a
 * "bar" serving and only powders carry a "scoop", so brand + unit isolates the
 * right sub-line without name-token clustering.
 */
async function borrowSiblingServing(
    foodId: string,
    brandName: string | null | undefined,
    normalizedUnit: string,
): Promise<{ grams: number; sampleCount: number } | null> {
    if (!foodId.startsWith('off_')) return null;          // OFF-only (v1)
    const brand = brandName?.trim();
    if (!brand || brand.length < 2) return null;          // no brand → no product line
    const unitStem = siblingSingularize(normalizedUnit).replace(/[^a-z]/g, '');
    if (!unitStem) return null;
    const selfBarcode = foodId.replace('off_', '');

    // Genuine servings only (isAiEstimated=false AND source='openfoodfacts') so
    // borrowed rows (source='sibling_borrow') never seed further borrows — that
    // exclusion is what prevents transitive estimate drift.
    let rows: Array<{ grams: number; description: string }>;
    try {
        rows = await prisma.$queryRaw<Array<{ grams: number; description: string }>>`
            SELECT s.grams, s.description
            FROM "OffServing" s
            JOIN "OffFood" f ON s.barcode = f.barcode
            WHERE lower(f."brandName") = ${brand.toLowerCase()}
              AND s."isAiEstimated" = false
              AND s.source = 'openfoodfacts'
              AND s.barcode <> ${selfBarcode}
              AND s.description ~* ${'\\m' + unitStem + 's?\\M'}
            LIMIT 50
        `;
    } catch (e) {
        logger.warn('ambiguous_backfill.sibling_query_failed', {
            foodId, unit: normalizedUnit, error: (e as Error).message,
        });
        return null;
    }
    if (!rows.length) return null;

    // Per-unit grams = serving grams / leading count ("2 scoops (46g)" → 23g).
    const perUnit: number[] = [];
    for (const r of rows) {
        const count = siblingLeadingCount(r.description);
        const g = r.grams / (count > 0 ? count : 1);
        if (g >= 0.2 && g <= 600) perUnit.push(g);
    }
    if (!perUnit.length) return null;

    // Median, then drop values outside [0.5x, 2x] of it and re-median — robust
    // to a few mislabeled sibling SKUs.
    const m0 = median(perUnit);
    const keep = perUnit.filter(g => g >= 0.5 * m0 && g <= 2 * m0);
    if (!keep.length) return null;
    return { grams: median(keep), sampleCount: keep.length };
}

/**
 * Get or create an ambiguous serving.
 */
export async function getOrCreateAmbiguousServing(
    foodId: string,
    foodName: string,
    unit: string,
    brandName?: string | null
): Promise<AmbiguousBackfillResult> {
    const normalizedUnit = unit.toLowerCase().trim();

    try {
        const { getSubPieceDefault } = await import('../servings/default-count-grams');
        const cleanFoodName = foodName.replace(/\b(chunks?|pieces?|slices?|bites?|wedges?|strips?|segments?)\b/gi, '').trim();
        const subPieceResult = getSubPieceDefault(cleanFoodName, normalizedUnit);
        if (subPieceResult) {
            logger.debug('ambiguous_backfill.sub_piece_deterministic', {
                foodId,
                unit: normalizedUnit,
                grams: subPieceResult.grams,
            });
            return {
                status: 'success',
                grams: subPieceResult.grams,
                confidence: subPieceResult.confidence,
            };
        }
    } catch (e) {
        // Ignore
    }

    try {
        const { getDefaultCountServing } = await import('../servings/default-count-grams');
        const sizeFromUnit = normalizedUnit as 'small' | 'medium' | 'large';
        const isSize = ['small', 'medium', 'large'].includes(sizeFromUnit);
        const countDefault = getDefaultCountServing(
            foodName,
            normalizedUnit,
            isSize ? sizeFromUnit : undefined
        );
        if (countDefault) {
            logger.debug('ambiguous_backfill.count_deterministic', {
                foodId,
                unit: normalizedUnit,
                grams: countDefault.grams,
            });
            return {
                status: 'success',
                grams: countDefault.grams,
                confidence: countDefault.confidence,
            };
        }
    } catch (e) {
        // Ignore
    }

    // Accept both the curated ambiguous set AND estimable unknown units (e.g.
    // "bar", "cookie") — discrete packaged items need a weight estimate too, and
    // sibling-borrow below can often resolve them deterministically from a
    // same-brand product's genuine label serving.
    if (!isAmbiguousUnit(normalizedUnit) && !isEstimableUnknownUnit(normalizedUnit)) {
        return { status: 'error', error: `"${unit}" is not an estimable unit` };
    }

    // Check existing
    const existing = await findExistingServing(foodId, normalizedUnit);
    if (existing?.grams) {
        logger.debug('ambiguous_backfill.cache_hit', {
            foodId,
            unit: normalizedUnit,
            grams: existing.grams,
        });
        return {
            status: 'cached',
            grams: existing.grams,
        };
    }

    // Sibling-serving borrow: before paying for an AI estimate, try to borrow a
    // genuine label serving of this unit from another same-brand product.
    const sibling = await borrowSiblingServing(foodId, brandName, normalizedUnit);
    if (sibling) {
        const confidence = siblingConfidence(sibling.sampleCount);
        try {
            await upsertServing(
                foodId, normalizedUnit, sibling.grams, confidence,
                `sibling-borrowed from ${sibling.sampleCount} ${brandName ?? 'brand'} product(s)`,
                'sibling_borrow', false,
            );
        } catch (error) {
            logger.warn('ambiguous_backfill.sibling_save_failed', {
                foodId, unit: normalizedUnit, error: (error as Error).message,
            });
        }
        logger.info('ambiguous_backfill.sibling_borrow', {
            foodId, foodName, unit: normalizedUnit,
            grams: sibling.grams, samples: sibling.sampleCount,
        });
        return { status: 'success', grams: sibling.grams, confidence };
    }

    // Call AI
    logger.info('ambiguous_backfill.estimating', { foodId, foodName, unit: normalizedUnit });

    const result = await estimateAmbiguousServing({
        foodName,
        brandName,
        unit: normalizedUnit,
    });

    if (result.status !== 'success' || !result.estimatedGrams) {
        logger.warn('ambiguous_backfill.ai_failed', {
            foodId,
            foodName,
            unit: normalizedUnit,
            error: result.error,
        });
        return { status: 'error', error: result.error ?? 'AI estimation failed' };
    }

    // Save
    try {
        await upsertServing(foodId, normalizedUnit, result.estimatedGrams, result.confidence ?? 1, result.reasoning?.slice(0, 200));

        logger.info('ambiguous_backfill.saved', {
            foodId,
            foodName,
            unit: normalizedUnit,
            grams: result.estimatedGrams,
            confidence: result.confidence,
        });
    } catch (error) {
        logger.warn('ambiguous_backfill.save_failed', {
            foodId,
            unit: normalizedUnit,
            error: (error as Error).message,
        });
    }

    return {
        status: 'success',
        grams: result.estimatedGrams,
        confidence: result.confidence,
    };
}

/**
 * Check for user-specific portion override first, then fall back to global.
 */
export async function getUserOrGlobalPortionOverride(
    userId: string | null | undefined,
    foodId: string,
    unit: string
): Promise<{ grams: number; source: 'user' | 'global' } | null> {
    const normalizedUnit = unit.toLowerCase().trim();

    if (userId) {
        const userOverride = await prisma.userPortionOverride.findUnique({
            where: {
                userId_foodId_unit: { userId, foodId, unit: normalizedUnit },
            },
        });

        if (userOverride) {
            return { grams: userOverride.grams, source: 'user' };
        }
    }

    // 2. Check global / cached estimates
    const existing = await findExistingServing(foodId, normalizedUnit);
    if (existing?.grams) {
        return { grams: existing.grams, source: 'global' };
    }

    return null;
}

import { estimateProduceSizes } from '../ai/ambiguous-serving-estimator';

export interface BatchedProduceBackfillResult {
    status: 'success' | 'partial' | 'error';
    created: { size: string; grams: number }[];
    skipped: string[];
    error?: string;
}

/**
 * Backfill small/medium/large servings for a produce item in a SINGLE AI call.
 */
export async function batchBackfillProduceSizes(
    foodId: string,
    foodName: string,
    brandName?: string | null
): Promise<BatchedProduceBackfillResult> {
    const SIZE_UNITS = ['small', 'medium', 'large'] as const;
    const created: { size: string; grams: number }[] = [];
    const skipped: string[] = [];

    // Check existing
    const existingDescriptions = await getExistingServingDescriptions(foodId);
    const existingSizes = new Set(existingDescriptions.map(d => d.toLowerCase()));

    const missingSizes = SIZE_UNITS.filter(size => !existingSizes.has(size));

    if (missingSizes.length === 0) {
        return {
            status: 'success',
            created: [],
            skipped: [...SIZE_UNITS],
        };
    }

    logger.info('batch_produce_backfill.estimating', {
        foodId,
        foodName,
        missingSizes,
    });

    const result = await estimateProduceSizes(foodName, brandName);

    if (result.status !== 'success' || !result.estimates) {
        return {
            status: 'error',
            created: [],
            skipped: [],
            error: result.error ?? 'AI estimation failed',
        };
    }

    const { estimates } = result;

    for (const size of missingSizes) {
        const grams = estimates[size];

        try {
            await upsertServing(foodId, size, grams, estimates.confidence ?? 1, estimates.reasoning?.slice(0, 200));
            created.push({ size, grams });

            logger.info('batch_produce_backfill.saved', {
                foodId,
                foodName,
                size,
                grams,
            });
        } catch (error) {
            logger.warn('batch_produce_backfill.save_failed', {
                foodId,
                size,
                error: (error as Error).message,
            });
        }
    }

    for (const size of SIZE_UNITS) {
        if (existingSizes.has(size)) {
            skipped.push(size);
        }
    }

    return {
        status: created.length > 0 ? 'success' : 'error',
        created,
        skipped,
    };
}

