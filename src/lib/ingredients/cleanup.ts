import { prisma } from '../db';
import { logger } from '../logger';

export interface CleanupResult {
    cleaned: string;
    appliedPatterns: Array<{
        id: string;
        pattern: string;
        type: string;
    }>;
    originalLength: number;
    cleanedLength: number;
}

/**
 * Apply learned cleanup patterns to an ingredient name
 */
export async function applyCleanupPatterns(
    rawName: string,
    minConfidence = 0.7
): Promise<CleanupResult> {
    // Fetch active patterns sorted by priority
    const patterns = await prisma.ingredientCleanupPattern.findMany({
        where: {
            confidence: { gte: minConfidence },
            // Optionally filter by successRate if we have enough data
            OR: [
                { successRate: null }, // New patterns
                { successRate: { gte: 0.6 } } // Proven patterns
            ]
        },
        orderBy: [
            { confidence: 'desc' },
            { usageCount: 'desc' }
        ]
    });

    let cleaned = rawName.trim();
    const appliedPatterns: Array<{ id: string; pattern: string; type: string }> = [];

    // Apply patterns in order of confidence
    for (const p of patterns) {
        try {
            const regex = new RegExp(p.pattern, 'gi');
            const before = cleaned;
            cleaned = cleaned.replace(regex, p.replacement).trim();

            // If pattern made a change, track it
            if (before !== cleaned) {
                appliedPatterns.push({
                    id: p.id,
                    pattern: p.pattern,
                    type: p.patternType
                });

                // Update usage stats (fire and forget)
                prisma.ingredientCleanupPattern.update({
                    where: { id: p.id },
                    data: {
                        usageCount: { increment: 1 },
                        lastUsed: new Date()
                    }
                }).catch(err => logger.error('Failed to update pattern usage', { err }));
            }
        } catch (err) {
            // Bad regex - log but don't crash
            logger.error('Invalid cleanup pattern', {
                patternId: p.id,
                pattern: p.pattern,
                error: (err as Error).message
            });
        }
    }

    // Clean up extra whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    logger.info('cleanup:applied', {
        original: rawName,
        cleaned,
        patternCount: appliedPatterns.length
    });

    return {
        cleaned,
        appliedPatterns,
        originalLength: rawName.length,
        cleanedLength: cleaned.length
    };
}

/**
 * Record the outcome of using cleaned ingredient in mapping
 */
export async function recordCleanupOutcome(
    rawInput: string,
    cleanedOutput: string,
    patternIds: string[],
    mappingSucceeded: boolean,
    confidenceScore?: number,
    context?: {
        recipeId?: string;
        ingredientId?: string;
    }
): Promise<void> {
    // Record application for each pattern
    for (const patternId of patternIds) {
        await prisma.ingredientCleanupApplication.create({
            data: {
                rawInput,
                cleanedOutput,
                patternId,
                mappingSucceeded,
                confidenceScore,
                recipeId: context?.recipeId,
                ingredientId: context?.ingredientId
            }
        });

        // Update pattern stats
        await prisma.ingredientCleanupPattern.update({
            where: { id: patternId },
            data: {
                [mappingSucceeded ? 'successCount' : 'failureCount']: { increment: 1 }
            }
        });
    }

    // Recompute success rates for affected patterns
    for (const patternId of patternIds) {
        const pattern = await prisma.ingredientCleanupPattern.findUnique({
            where: { id: patternId }
        });

        if (pattern && (pattern.successCount + pattern.failureCount) > 0) {
            const successRate = pattern.successCount / (pattern.successCount + pattern.failureCount);

            await prisma.ingredientCleanupPattern.update({
                where: { id: patternId },
                data: { successRate }
            });
        }
    }
}
