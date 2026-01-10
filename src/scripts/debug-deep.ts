// Deep debug of carrots and 100% liquid failure
import 'dotenv/config';
process.env.LOG_LEVEL = 'debug';

async function main() {
    const { mapIngredientWithFallback } = await import('../lib/fatsecret/map-ingredient-with-fallback');
    const { applySynonyms, normalizeIngredientName } = await import('../lib/fatsecret/normalization-rules');
    const { parseIngredientLine } = await import('../lib/parse/ingredient-line');

    // Clear any cached mappings for these
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient({ log: [] });

    await prisma.validatedMapping.deleteMany({
        where: {
            OR: [
                { rawIngredient: { contains: 'carrot', mode: 'insensitive' } },
                { rawIngredient: { contains: 'liquid', mode: 'insensitive' } },
            ]
        }
    });
    await prisma.aiNormalizeCache.deleteMany({
        where: {
            OR: [
                { rawLine: { contains: 'carrot', mode: 'insensitive' } },
                { rawLine: { contains: 'liquid', mode: 'insensitive' } },
            ]
        }
    });
    console.log('Cleared caches for carrot and liquid\n');
    await prisma.$disconnect();

    const tests = [
        '2 carrots',
        '3 tbsp 100% liquid',
    ];

    for (const line of tests) {
        console.log('\n' + '='.repeat(70));
        console.log(`INPUT: "${line}"`);
        console.log('='.repeat(70));

        // Step 1: Parse
        const parsed = parseIngredientLine(line);
        console.log(`\n1. PARSING:`);
        console.log(`   Name: "${parsed?.name}"`);
        console.log(`   Qty: ${parsed?.quantity}, Unit: ${parsed?.unit}`);

        // Step 2: Synonym application
        if (parsed?.name) {
            console.log(`\n2. SYNONYMS:`);
            const synonymed = applySynonyms(parsed.name);
            console.log(`   After applySynonyms: "${synonymed}"`);

            // Step 3: Normalization
            console.log(`\n3. NORMALIZATION:`);
            const normalized = normalizeIngredientName(parsed.name);
            console.log(`   cleaned: "${normalized.cleaned}"`);
            console.log(`   nounOnly: "${normalized.nounOnly}"`);
        }

        // Step 4: Full mapping
        console.log(`\n4. FULL MAPPING (with debug):`);
        const result = await mapIngredientWithFallback(line, {
            minConfidence: 0,
            skipFdc: false,  // Include FDC
            debug: true
        });

        console.log(`\n5. RESULT:`);
        if (result) {
            console.log(`   Food: ${result.foodName}`);
            console.log(`   Source: ${result.source}`);
            console.log(`   Grams: ${result.grams?.toFixed(1)}`);
            console.log(`   Kcal: ${result.kcal?.toFixed(0)}`);
            console.log(`   Confidence: ${result.confidence}`);
            console.log(`   Reason: ${result.reason}`);
        } else {
            console.log(`   NO RESULT - mapping failed completely`);
        }
    }
}

main().catch(console.error);
