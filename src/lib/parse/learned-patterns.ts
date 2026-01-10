/**
 * Learned Patterns Cache
 * 
 * Provides a sync getter for learned prep phrases from the IngredientCleanupPattern table.
 * Call refreshLearnedPatterns() at entry points (recipe creation, batch import) to load patterns.
 */

// Module-level cache for learned prep phrases
let learnedPrepPhrases: Set<string> = new Set();

/**
 * Refresh learned prep phrases from DB.
 * Call this at entry points before parsing ingredients.
 * Uses dynamic imports to avoid breaking tests that don't have DB access.
 */
export async function refreshLearnedPatterns(): Promise<void> {
    try {
        // Dynamic imports to avoid breaking tests without DB
        const { prisma } = await import('../db');
        const { logger } = await import('../logger');

        const patterns = await prisma.ingredientCleanupPattern.findMany({
            where: {
                patternType: 'PREP_PHRASE',
                confidence: { gte: 0.7 },
                // Only use patterns that have been proven or are new
                OR: [
                    { successRate: null },
                    { successRate: { gte: 0.6 } }
                ]
            },
            select: {
                pattern: true
            }
        });

        learnedPrepPhrases = new Set(patterns.map(p => p.pattern.toLowerCase()));

        logger.info('learned-patterns:refreshed', {
            count: learnedPrepPhrases.size
        });
    } catch (error) {
        // Non-critical - log and continue with empty/stale cache
        // This gracefully handles test environments without DB
        console.warn('learned-patterns:refresh-failed', (error as Error).message);
    }
}

/**
 * Get cached learned prep phrases (sync).
 * Returns empty set if refresh hasn't been called.
 */
export function getLearnedPrepPhrases(): Set<string> {
    return learnedPrepPhrases;
}

/**
 * Check if patterns have been loaded.
 */
export function hasLoadedPatterns(): boolean {
    return learnedPrepPhrases.size > 0;
}
