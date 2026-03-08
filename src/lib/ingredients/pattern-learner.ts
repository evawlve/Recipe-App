import { prisma } from '../db';
import { logger } from '../logger';
import { aiNormalizeIngredient } from '../fatsecret/ai-normalize';

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function learnPatternsFromAI(
    rawName: string,
    aiResult: Awaited<ReturnType<typeof aiNormalizeIngredient>>
): Promise<string[]> {
    if (aiResult.status !== 'success') {
        return [];
    }

    const newPatternIds: string[] = [];

    // 1. Check for measurement prefix
    const measRegex = /^(\d+\s*)?(tbsps?|tsps?|cups?|oz|lb|grams?|kg)\s+/i;
    if (measRegex.test(rawName)) {
        const pattern = await prisma.ingredientCleanupPattern.upsert({
            where: { pattern: '^(\\d+\\s*)?(tbsps?|tsps?|cups?|oz|lb|grams?|kg)\\s+' },
            update: {
                confidence: { increment: 0.05 }, // Reinforce if seen again
                usageCount: { increment: 1 }
            },
            create: {
                pattern: '^(\\d+\\s*)?(tbsps?|tsps?|cups?|oz|lb|grams?|kg)\\s+',
                patternType: 'MEASUREMENT_PREFIX',
                replacement: '',
                description: 'Remove measurement unit prefix (AI learned)',
                source: 'AI_LEARNED',
                confidence: 0.8
            }
        });
        newPatternIds.push(pattern.id);
    }

    // 2. Learn from prep phrases
    for (const prep of aiResult.prepPhrases) {
        if (rawName.toLowerCase().includes(prep.toLowerCase())) {
            const cleanPrep = prep.trim();
            if (cleanPrep.length >= 3) { // Avoid too-short patterns
                const pattern = await prisma.ingredientCleanupPattern.upsert({
                    where: { pattern: `\\b${escapeRegex(cleanPrep)}\\b` },
                    update: {
                        confidence: { increment: 0.05 },
                        usageCount: { increment: 1 }
                    },
                    create: {
                        pattern: `\\b${escapeRegex(cleanPrep)}\\b`,
                        patternType: 'PREP_PHRASE',
                        replacement: '',
                        description: `Remove prep phrase: "${cleanPrep}" (AI learned)`,
                        source: 'AI_LEARNED',
                        confidence: 0.75
                    }
                });
                newPatternIds.push(pattern.id);
            }
        }
    }

    // 3. Learn from size phrases
    for (const size of aiResult.sizePhrases) {
        if (rawName.toLowerCase().includes(size.toLowerCase())) {
            const cleanSize = size.trim();
            if (cleanSize.length >= 3) {
                const pattern = await prisma.ingredientCleanupPattern.upsert({
                    where: { pattern: `\\b${escapeRegex(cleanSize)}\\b` },
                    update: {
                        confidence: { increment: 0.05 },
                        usageCount: { increment: 1 }
                    },
                    create: {
                        pattern: `\\b${escapeRegex(cleanSize)}\\b`,
                        patternType: 'SIZE_PHRASE',
                        replacement: '',
                        description: `Remove size phrase: "${cleanSize}" (AI learned)`,
                        source: 'AI_LEARNED',
                        confidence: 0.7 // Lower confidence for size - sometimes matters
                    }
                });
                newPatternIds.push(pattern.id);
            }
        }
    }

    logger.info('pattern_learner:learned', {
        rawName,
        learnedCount: newPatternIds.length,
        prepPhrases: aiResult.prepPhrases,
        sizePhrases: aiResult.sizePhrases
    });

    return newPatternIds;
}
