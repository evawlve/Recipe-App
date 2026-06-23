#!/usr/bin/env tsx
import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';

async function verify() {
    console.log('--- Verifying Semantic Fallback & Normalized Cache ---');

    // 1. Semantic Fallback Test
    const complex1 = "4 cup dry mix light & fluffy buttermilk complete pancake mix";
    console.log(`\nTesting Fallback 1: "${complex1}"`);
    const res1 = await mapIngredientWithFallback(complex1);
    console.log(`Result: ${res1?.foodName} (Source: ${res1?.source})`);
    if (res1?.rawLine === complex1 && (res1?.foodName.toLowerCase().includes('pancake match') || res1?.foodName.toLowerCase().includes('pancake mix'))) {
        console.log('✅ Fallback Success');
    } else {
        console.log('⚠️ Fallback Check (Verify manually)');
    }

    const complex2 = "1 tsp psyllium fiber powder unsweetened unflavored";
    console.log(`\nTesting Fallback 2: "${complex2}"`);
    const res2 = await mapIngredientWithFallback(complex2);
    console.log(`Result: ${res2?.foodName} (Source: ${res2?.source})`);

    // 2. Normalized Cache Test
    // Ensure "onion" is in cache
    const existingOnion = await prisma.validatedMapping.findFirst({
        where: { normalizedForm: 'onion' } // Approximate
    });

    if (existingOnion) {
        console.log(`\nFound in Cache: ${existingOnion.rawIngredient} -> ${existingOnion.foodName}`);

        const rawWithPrep = "1 cup chopped onion"; // normalized -> "onion"
        // Ensure "1 cup chopped onion" is NOT in cache exact
        // Wait, if I map it, it might save it.
        // I will rely on logs to see "normalized_cache_hit".

        console.log(`Testing Normalized Cache: "${rawWithPrep}"`);
        const res3 = await mapIngredientWithFallback(rawWithPrep);
        console.log(`Result: ${res3?.foodName} (Source: ${res3?.source})`);
    } else {
        console.log('\nSkipping Cache Test (Seed data missing)');
    }
}

verify().finally(async () => {
    await prisma.$disconnect();
});
