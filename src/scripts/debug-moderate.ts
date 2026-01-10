// Detailed test to identify the remaining failing issue
process.env.LOG_LEVEL = 'error';

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ log: [] });

async function main() {
    const { mapIngredientWithFallback } = await import('../lib/fatsecret/map-ingredient-with-fallback');

    const tests = [
        {
            line: '0.5 cup cornmeal',
            expected: 'Cornmeal',
            notExpected: 'Mush',
            issue: 'Cornmeal → Cornmeal Mush'
        },
        {
            line: '1.5 cup milk lowfat',
            expected: 'Lowfat',
            notExpected: 'Nonfat',
            issue: 'Lowfat → Nonfat milk'
        },
        {
            line: 'green bell pepper',
            expected: 'Green',
            notExpected: 'Red',
            issue: 'Green → Red bell pepper'
        },
        {
            line: '3 tbsp 100% liquid',
            expected: 'Water',
            notExpected: 'Juice',
            issue: 'Liquid → Apple Juice'
        },
    ];

    console.log('=== DETAILED MODERATE ISSUE ANALYSIS ===\n');

    for (const { line, expected, notExpected, issue } of tests) {
        console.log(`\n--- ${issue} ---`);
        console.log(`Input: "${line}"`);

        const result = await mapIngredientWithFallback(line, {
            minConfidence: 0,
            skipFdc: true,
            debug: false,
        });

        const foodName = result?.foodName || '(no result)';
        const brandName = result?.brandName || '';
        const fullName = brandName ? `${foodName} (${brandName})` : foodName;

        const hasExpected = fullName.toLowerCase().includes(expected.toLowerCase());
        const hasNotExpected = fullName.toLowerCase().includes(notExpected.toLowerCase());
        const isFixed = hasExpected && !hasNotExpected;

        console.log(`Mapped to: ${fullName}`);
        console.log(`Expected to contain: "${expected}"`);
        console.log(`Should NOT contain: "${notExpected}"`);
        console.log(`Has expected: ${hasExpected}, Has unwanted: ${hasNotExpected}`);
        console.log(`Status: ${isFixed ? '✅ FIXED' : '❌ STILL FAILING'}`);

        if (!isFixed) {
            console.log(`\n>>> FAILURE DETAILS <<<`);
            console.log(`Food ID: ${result?.foodId}`);
            console.log(`Confidence: ${result?.confidence}`);
            console.log(`Reason: ${result?.reason}`);
        }
    }

    await prisma.$disconnect();
}

main().catch(console.error);
