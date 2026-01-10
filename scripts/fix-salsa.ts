#!/usr/bin/env npx tsx

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    // First clear any cached mappings for salsa
    const deleted = await prisma.validatedMapping.deleteMany({
        where: { rawIngredient: { contains: 'salsa', mode: 'insensitive' } }
    });
    console.log('Cleared salsa mappings:', deleted.count);

    const deletedAi = await prisma.aiNormalizeCache.deleteMany({
        where: { rawLine: { contains: 'salsa', mode: 'insensitive' } }
    });
    console.log('Cleared AI cache:', deletedAi.count);

    // Now test the mapping fresh
    console.log('\nMapping "2 tbsp tomato salsa":');
    const result = await mapIngredientWithFallback('2 tbsp tomato salsa', { debug: true });

    if (result) {
        console.log('RESULT:');
        console.log('  Food:', result.foodName);
        console.log('  Grams:', result.grams);
        console.log('  Calories:', result.kcal);
    } else {
        console.log('NO MAPPING');
    }

    await prisma.$disconnect();
}

main().catch(console.error);
