import { prisma } from '../src/lib/db';
import { aiNormalizeIngredient } from '../src/lib/fatsecret/ai-normalize';

async function main() {
    console.log('=== Checking AI Normalization for "2 cup stberry halves" ===\n');

    // Test AI normalization
    const result = await aiNormalizeIngredient('2 cup stberry halves');
    console.log('AI Normalization Result:');
    console.log('  normalizedName:', result.normalizedName);
    console.log('  synonyms:', result.synonyms);
    console.log('  prepPhrases:', result.prepPhrases);
    console.log('  aiConfidence:', result.aiConfidence);

    // Check what's in AI cache now
    console.log('\n=== AI Cache for stberry ===');
    const aiCache = await prisma.aiNormalizeCache.findMany({
        where: { rawLine: { contains: 'stberry', mode: 'insensitive' } },
        take: 3
    });
    aiCache.forEach(c => {
        console.log('  rawLine:', c.rawLine);
        console.log('  normalizedName:', c.normalizedName);
    });

    // Check ValidatedMapping for any strawberry entry
    console.log('\n=== ValidatedMapping for strawberry ===');
    const validated = await prisma.validatedMapping.findMany({
        where: {
            OR: [
                { normalizedForm: { contains: 'strawberr', mode: 'insensitive' } },
                { foodName: { contains: 'strawberr', mode: 'insensitive' } }
            ]
        },
        take: 5,
        orderBy: { createdAt: 'desc' }
    });

    if (validated.length === 0) {
        console.log('  No entries found');
    } else {
        validated.forEach(v => {
            console.log('  Entry:');
            console.log('    normalizedForm:', v.normalizedForm);
            console.log('    tokenSet:', v.tokenSet);
            console.log('    foodName:', v.foodName);
        });
    }

    await prisma.$disconnect();
}

main().catch(console.error);
