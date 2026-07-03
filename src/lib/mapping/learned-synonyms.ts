/**
 * Learned Synonyms Module
 * 
 * Tracks synonym pairs discovered by AI to reduce future AI calls.
 * When AI provides synonyms (e.g., "icing" → "powdered sugar"),
 * we save them here for instant lookup on future queries.
 */

import { prisma } from '../db';
import { logger } from '../logger';

// ============================================================
// Types
// ============================================================

export interface LearnedSynonymRecord {
    sourceTerm: string;
    targetTerm: string;
    locale?: string;
    category?: string;
    confidence: number;
}

// ============================================================
// Get Synonyms
// ============================================================

/**
 * Get learned synonyms for a term from the database
 * Returns array of target terms that have been associated with the source term
 */
export async function getLearnedSynonyms(term: string): Promise<string[]> {
    try {
        const normalizedTerm = term.toLowerCase().trim();

        const records = await prisma.learnedSynonym.findMany({
            where: {
                sourceTerm: normalizedTerm,
            },
            orderBy: [
                { successCount: 'desc' },
                { useCount: 'desc' },
            ],
            take: 10,
        });

        if (records.length > 0) {
            // Update usage stats
            await prisma.learnedSynonym.updateMany({
                where: {
                    sourceTerm: normalizedTerm,
                },
                data: {
                    useCount: { increment: 1 },
                    lastUsedAt: new Date(),
                },
            });

            logger.debug('learned_synonyms.cache_hit', {
                term: normalizedTerm,
                synonyms: records.map(r => r.targetTerm),
            });
        }

        return records.map(r => r.targetTerm);
    } catch (error) {
        logger.error('learned_synonyms.get_error', { term, error });
        return [];
    }
}

// ============================================================
// Save Synonyms
// ============================================================

/**
 * Save synonym pairs learned from AI
 * Called after AI normalize returns synonyms
 */
export async function saveLearnedSynonyms(
    sourceTerm: string,
    targetTerms: string[],
    options: {
        source?: 'ai' | 'manual' | 'fatsecret_alias';
        locale?: string;
        category?: string;
        confidence?: number;
    } = {}
): Promise<void> {
    const {
        source = 'ai',
        locale,
        category,
        confidence = 0.8,
    } = options;

    const normalizedSource = sourceTerm.toLowerCase().trim();

    // Filter out empty or redundant synonyms
    const validTargets = targetTerms
        .map(t => t.toLowerCase().trim())
        .filter(t => t && t !== normalizedSource && t.length > 2);

    if (validTargets.length === 0) return;

    try {
        // Upsert each synonym pair
        const operations = validTargets.map(targetTerm =>
            prisma.learnedSynonym.upsert({
                where: {
                    sourceTerm_targetTerm: {
                        sourceTerm: normalizedSource,
                        targetTerm,
                    },
                },
                create: {
                    sourceTerm: normalizedSource,
                    targetTerm,
                    locale,
                    category,
                    source,
                    confidence,
                    useCount: 0,
                    successCount: 0,
                    failureCount: 0,
                },
                update: {
                    // Don't update existing records, just confirm they exist
                    lastUsedAt: new Date(),
                },
            })
        );

        await Promise.all(operations);

        logger.info('learned_synonyms.saved', {
            sourceTerm: normalizedSource,
            count: validTargets.length,
            targets: validTargets,
        });
    } catch (error) {
        logger.error('learned_synonyms.save_error', {
            sourceTerm: normalizedSource,
            targets: validTargets,
            error,
        });
    }
}

// ============================================================
// Update Outcome
// ============================================================

/**
 * Track whether a synonym contributed to successful mapping
 * Called after mapping completes to update success/failure counts
 */
export async function updateSynonymOutcome(
    sourceTerm: string,
    targetTerm: string,
    success: boolean
): Promise<void> {
    const normalizedSource = sourceTerm.toLowerCase().trim();
    const normalizedTarget = targetTerm.toLowerCase().trim();

    try {
        await prisma.learnedSynonym.update({
            where: {
                sourceTerm_targetTerm: {
                    sourceTerm: normalizedSource,
                    targetTerm: normalizedTarget,
                },
            },
            data: success
                ? { successCount: { increment: 1 } }
                : { failureCount: { increment: 1 } },
        });
    } catch (error) {
        // Record may not exist, that's OK
        logger.debug('learned_synonyms.update_outcome_skip', {
            sourceTerm: normalizedSource,
            targetTerm: normalizedTarget,
            success,
        });
    }
}

// ============================================================
// Bulk Get Synonyms for Multiple Terms
// ============================================================

/**
 * Get synonyms for multiple terms at once (for batch processing)
 */
export async function getBulkLearnedSynonyms(
    terms: string[]
): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();

    if (terms.length === 0) return result;

    try {
        const normalizedTerms = terms.map(t => t.toLowerCase().trim());

        const records = await prisma.learnedSynonym.findMany({
            where: {
                sourceTerm: { in: normalizedTerms },
            },
            orderBy: { successCount: 'desc' },
        });

        // Group by source term
        for (const record of records) {
            const existing = result.get(record.sourceTerm) || [];
            existing.push(record.targetTerm);
            result.set(record.sourceTerm, existing);
        }

        // Update usage counts
        if (records.length > 0) {
            await prisma.learnedSynonym.updateMany({
                where: {
                    sourceTerm: { in: normalizedTerms },
                },
                data: {
                    useCount: { increment: 1 },
                    lastUsedAt: new Date(),
                },
            });
        }

        return result;
    } catch (error) {
        logger.error('learned_synonyms.bulk_get_error', { terms, error });
        return result;
    }
}

// ============================================================
// Extract Terms from Ingredient Name
// ============================================================

/**
 * Extract individual words from an ingredient name for synonym lookup
 */
export function extractTermsFromIngredient(ingredientName: string): string[] {
    const words = ingredientName
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter(w => w.length > 2);

    // Also include the full name and 2-word phrases
    const terms = [...words, ingredientName.toLowerCase().trim()];

    // Add 2-word combinations
    for (let i = 0; i < words.length - 1; i++) {
        terms.push(`${words[i]} ${words[i + 1]}`);
    }

    return [...new Set(terms)];
}
