// Test all moderate issue fixes - clean output
process.env.LOG_LEVEL = 'error';

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ log: [] });

async function main() {
    const { mapIngredientWithFallback } = await import('../lib/fatsecret/map-ingredient-with-fallback');

    const tests = [
        { line: '0.5 cup cornmeal', expected: 'Cornmeal', notExpected: 'Mush' },
        { line: '1.5 cup milk lowfat', expected: 'Lowfat', notExpected: 'Nonfat' },
        { line: 'green bell pepper', expected: 'Green', notExpected: 'Red' },
        { line: '3 tbsp 100% liquid', expected: 'Water', notExpected: 'Juice' },
    ];

    console.log('=== MODERATE ISSUE FIX VERIFICATION ===\n');

    let passed = 0;
    for (const { line, expected, notExpected } of tests) {
        const result = await mapIngredientWithFallback(line, { minConfidence: 0, skipFdc: true });
        const foodName = result?.foodName || '(no result)';
        const hasExpected = foodName.toLowerCase().includes(expected.toLowerCase());
        const hasNotExpected = foodName.toLowerCase().includes(notExpected.toLowerCase());
        const isFixed = hasExpected && !hasNotExpected;

        console.log(`"${line}"`);
        console.log(`  Mapped to: ${foodName}`);
        console.log(`  Expected: contains "${expected}", NOT "${notExpected}"`);
        console.log(`  Status: ${isFixed ? '✅ FIXED' : '⚠️ still needs work'}`);
        console.log('');

        if (isFixed) passed++;
    }

    console.log(`\n=== RESULTS: ${passed}/${tests.length} passed ===`);

    await prisma.$disconnect();
}

main().catch(console.error);
