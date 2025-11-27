#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFdc } from '../src/lib/usda/map-ingredient-fdc';

async function main() {
    console.log('\n🧪 Testing FDC Caching & AI Backfill\n');

    // 1. Pick a test ingredient that likely exists in FDC
    // "raw broccoli" is a good candidate for Foundation food
    const testIngredient = "raw broccoli florets";

    console.log(`Mapping "${testIngredient}" (1st Pass - API)...`);
    const start1 = Date.now();
    const result1 = await mapIngredientWithFdc(testIngredient);
    const time1 = Date.now() - start1;

    if (!result1) {
        console.error('❌ Failed to map with FDC');
        return;
    }

    console.log(`✅ Mapped to FDC ID: ${result1.fdcId}`);
    console.log(`   Description: ${result1.description}`);
    console.log(`   Time: ${time1}ms`);

    // 2. Verify Cache
    const cachedFood = await (prisma as any).fdcFoodCache.findUnique({
        where: { id: result1.fdcId },
        include: { servings: true }
    });

    if (cachedFood) {
        console.log('✅ Food saved to FDC Cache');
        console.log(`   Servings count: ${cachedFood.servings.length}`);

        const aiServing = cachedFood.servings.find((s: any) => s.source === 'ai');
        if (aiServing) {
            console.log('✅ AI Backfill successful!');
            console.log(`   AI Serving: ${aiServing.description} (${aiServing.grams}g)`);
        } else {
            console.log('⚠️ No AI serving found (might not have needed it or failed)');
        }
    } else {
        console.error('❌ Food NOT saved to FDC Cache');
    }

    // 3. Run 2nd Pass (Should be cached)
    console.log(`\nMapping "${testIngredient}" (2nd Pass - Cache)...`);
    const start2 = Date.now();
    const result2 = await mapIngredientWithFdc(testIngredient);
    const time2 = Date.now() - start2;

    console.log(`   Time: ${time2}ms`);

    if (time2 < time1 && time2 < 100) {
        console.log(`✅ 2nd pass was significantly faster (Cache Hit)`);
    } else {
        console.log(`⚠️ 2nd pass time: ${time2}ms (Check if cache was actually used)`);
    }

    console.log('\n' + '='.repeat(50));
}

main()
    .catch((error) => {
        console.error('Error:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
