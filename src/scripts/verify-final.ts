// Final verification of remaining issues
import 'dotenv/config';
process.env.LOG_LEVEL = 'error';

async function main() {
    // Clear relevant caches first
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient({ log: [] });

    await prisma.validatedMapping.deleteMany({
        where: {
            OR: [
                { rawIngredient: { contains: 'liquid', mode: 'insensitive' } },
                { rawIngredient: { contains: 'carrot', mode: 'insensitive' } },
            ]
        }
    });
    console.log('Cleared relevant caches\n');
    await prisma.$disconnect();

    const { mapIngredientWithFallback } = await import('../lib/fatsecret/map-ingredient-with-fallback');

    const tests = [
        { line: '2 carrots', expected: 'Carrot', notExpected: 'Juice' },
        { line: '3 tbsp 100% liquid', expected: 'Water', notExpected: 'Spinach' },
        { line: '2 medium carrots', expected: 'Carrot', notExpected: 'Juice' },
    ];

    console.log('=== FINAL VERIFICATION ===\n');

    let passed = 0;
    for (const { line, expected, notExpected } of tests) {
        const result = await mapIngredientWithFallback(line, { minConfidence: 0 });
        const name = result?.foodName || '(none)';
        const hasExp = name.toLowerCase().includes(expected.toLowerCase());
        const hasNot = name.toLowerCase().includes(notExpected.toLowerCase());
        const status = hasExp && !hasNot ? 'PASS' : 'FAIL';

        console.log(`${status}: "${line}" => ${name}`);
        console.log(`  Expected: contains "${expected}", NOT "${notExpected}"`);
        console.log(`  Grams: ${result?.grams?.toFixed(1)}, Kcal: ${result?.kcal?.toFixed(0)}`);
        console.log('');

        if (status === 'PASS') passed++;
    }

    console.log(`\n=== RESULTS: ${passed}/${tests.length} passed ===`);
}

main().catch(console.error);
