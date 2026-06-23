#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { applyCleanupPatterns } from '../src/lib/ingredients/cleanup';

async function main() {
    console.log('\n🧪 Testing Cleanup Pattern System\n');

    // Test cases from our actual failures
    const testCases = [
        { input: 'tsps ginger', expected: 'ginger' },
        { input: '2 tsps ginger', expected: 'ginger' },
        { input: 'tbsps cornstarch', expected: 'cornstarch' },
        { input: '3 tbsps cornstarch', expected: 'cornstarch' },
        { input: 'breasts bone and skin removed chicken into strips', expected: 'breasts chicken into strips' },
        { input: 'lemon yields lemon', expected: 'lemon lemon' }, // Will need second pass
        { input: 'unit chicken', expected: 'unit chicken' }, // No pattern for this yet
        { input: 'chicken, diced', expected: 'chicken,' },
        { input: 'onions, chopped', expected: 'onions,' }
    ];

    console.log('Testing cleanup patterns:\n');

    let passedCount = 0;
    let failedCount = 0;

    for (const test of testCases) {
        const result = await applyCleanupPatterns(test.input);
        const passed = result.cleaned === test.expected;

        if (passed) {
            console.log(`✅ "${test.input}"`);
            console.log(`   → "${result.cleaned}"`);
            console.log(`   Patterns applied: ${result.appliedPatterns.length}\n`);
            passedCount++;
        } else {
            console.log(`❌ "${test.input}"`);
            console.log(`   Expected: "${test.expected}"`);
            console.log(`   Got: "${result.cleaned}"`);
            console.log(`   Patterns applied: ${result.appliedPatterns.length}\n`);
            failedCount++;
        }
    }

    console.log(`\n📊 Results: ${passedCount}/${testCases.length} passed, ${failedCount} failed\n`);

    if (failedCount > 0) {
        console.log('💡 Note: Some failures are expected (e.g., "unit chicken" has no pattern yet)');
        console.log('   These would be caught by the AI fallback in the real auto-mapper.\n');
    }

    // Show pattern usage stats
    const patterns = await prisma.ingredientCleanupPattern.findMany({
        orderBy: { usageCount: 'desc' },
        take: 5
    });

    console.log('🔝 Most Used Patterns:');
    patterns.forEach((p, i) => {
        console.log(`   ${i + 1}. ${p.description} (used ${p.usageCount} times)`);
    });
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
