#!/usr/bin/env tsx
import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';

async function test() {
    const testCases = [
        '0.25 cup raspberries',
        '1 tbsp oil',
        '0.5 cup liquid',
    ];

    for (const testCase of testCases) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Testing: "${testCase}"`);
        console.log('='.repeat(60));

        try {
            const result = await mapIngredientWithFallback(testCase, { debug: true });
            if (result) {
                console.log(`✅ Success: ${result.foodName}`);
                console.log(`   Confidence: ${result.confidence}`);
                console.log(`   Source: ${result.source}`);
            } else {
                console.log('❌ Failed: No mapping found');
            }
        } catch (error) {
            console.log(`❌ Error: ${(error as Error).message}`);
        }
    }
}

test().catch(console.error).finally(() => prisma.$disconnect());
