#!/usr/bin/env tsx
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function verify() {
    console.log('=== Verifying Fixes ===\n');

    // 1. Clear Cache for relevant items
    const itemsToClear = ['fat free pudding', 'low fat yogurt', 'extra lean ground beef'];
    console.log('Clearing cache...');
    for (const item of itemsToClear) {
        await prisma.aiNormalizeCache.deleteMany({
            where: { rawLine: { contains: item } }
        });
        await prisma.validatedMapping.deleteMany({
            where: { rawIngredient: { contains: item } }
        });
    }

    // 2. Test Mapping
    const items = [
        "2 lbs extra lean ground beef",
        "1 oz fat free pudding",
        "1 container low fat yogurt"
    ];

    for (const item of items) {
        console.log(`\nTesting: "${item}"`);
        const result = await mapIngredientWithFallback(item);

        if (result) {
            console.log(`  ✓ Mapped to: "${result.foodName}"`);
            if (result.brandName) console.log(`    Brand: ${result.brandName}`);
        } else {
            console.log(`  ✗ Failed to map`);
        }
    }
}

verify().catch(console.error).finally(() => prisma.$disconnect());
