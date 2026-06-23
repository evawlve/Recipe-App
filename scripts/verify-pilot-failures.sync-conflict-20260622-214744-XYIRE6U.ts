#!/usr/bin/env tsx
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

const items = [
    "2 cup nonfat milk",
    "1 oz fat free pudding",
    "1 cup reduced fat Mexican cheese",
    "1 cup reduced fat colby and monterey jack cheese",
    "2 tbsp mayonnaise extra light",
    "2 tbsp cream cheese",
    "1 9\" pie shell",
    "0.5 tsp pepper sauce"
];

async function test() {
    console.log('=== Verifying Pilot Failures ===\n');

    // Clear AI normalize cache for these items to ensure fresh run with new prompt
    for (const item of items) {
        await prisma.aiNormalizeCache.deleteMany({
            where: { rawLine: { contains: item.split(' ').slice(2).join(' ') } } // approximate match
        });
    }

    for (const item of items) {
        console.log(`Testing: "${item}"`);
        const result = await mapIngredientWithFallback(item);

        if (result) {
            console.log(`  ✓ Mapped to: "${result.foodName}"`);
            if (result.brandName) console.log(`    Brand: ${result.brandName}`);
            console.log(`    Confidence: ${result.confidence}`);
        } else {
            console.log(`  ✗ Failed to map`);
        }
        console.log('');
    }
}

test().catch(console.error).finally(() => prisma.$disconnect());
