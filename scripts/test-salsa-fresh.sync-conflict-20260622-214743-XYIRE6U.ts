#!/usr/bin/env npx tsx

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    // Clear ALL caches for fresh test
    await prisma.validatedMapping.deleteMany({
        where: {
            OR: [
                { rawIngredient: { contains: 'tomato', mode: 'insensitive' } },
                { rawIngredient: { contains: 'salsa', mode: 'insensitive' } },
            ]
        }
    });
    await prisma.aiNormalizeCache.deleteMany({
        where: {
            OR: [
                { rawLine: { contains: 'tomato', mode: 'insensitive' } },
                { rawLine: { contains: 'salsa', mode: 'insensitive' } },
            ]
        }
    });
    console.log('Cleared all tomato/salsa caches');

    // Now test fresh mapping
    console.log('\nMapping "2 tbsp tomato salsa" fresh:\n');
    const result = await mapIngredientWithFallback('2 tbsp tomato salsa', { debug: true });

    if (result) {
        console.log('\n=== FINAL RESULT ===');
        console.log('Food:', result.foodName);
        console.log('Food ID:', result.foodId);
        console.log('Grams:', result.grams);
        console.log('Calories:', result.kcal);

        const isCorrect = result.foodName.toLowerCase().includes('salsa');
        console.log(isCorrect ? '\n✓ CORRECT - mapped to salsa' : '\n❌ WRONG - should have mapped to salsa');
    } else {
        console.log('NO MAPPING');
    }

    await prisma.$disconnect();
}

main().catch(console.error);
