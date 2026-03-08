#!/usr/bin/env tsx
/**
 * Clean verification script for AI Semantic Fallback & Normalized Cache
 * Suppresses noisy logs to show only results
 */
import 'dotenv/config';

// Suppress Prisma query logs
process.env.DEBUG = '';

import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';

const testCases = [
    // Complex branded strings that should trigger fallback
    "4 cup dry mix light & fluffy buttermilk complete pancake mix",
    "1 tsp psyllium fiber powder unsweetened unflavored",
    // Simple ingredients that should hit cache (if seeded)
    "1 cup chopped onion",
    "2 tablespoons olive oil",
    // Previously problematic
    "1 oz fat free pudding",
];

async function verify() {
    console.log('='.repeat(60));
    console.log('VERIFICATION: AI Semantic Fallback & Normalized Cache');
    console.log('='.repeat(60));
    console.log();

    for (const testCase of testCases) {
        console.log(`INPUT: "${testCase}"`);

        try {
            const result = await mapIngredientWithFallback(testCase, {
                skipCache: false,
                allowLiveFallback: true,
            });

            if (result) {
                console.log(`  ✅ MAPPED TO: ${result.foodName}`);
                console.log(`     Source: ${result.source}, Confidence: ${result.confidence.toFixed(2)}`);
            } else {
                console.log(`  ❌ FAILED: No mapping found`);
            }
        } catch (err) {
            console.log(`  ❌ ERROR: ${(err as Error).message}`);
        }
        console.log();
    }

    console.log('='.repeat(60));
    console.log('VERIFICATION COMPLETE');
    console.log('='.repeat(60));
}

verify().finally(async () => {
    await prisma.$disconnect();
});
