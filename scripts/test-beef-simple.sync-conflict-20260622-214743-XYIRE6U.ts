#!/usr/bin/env npx tsx

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    const result = await mapIngredientWithFallback('2 lbs extra lean ground beef', { debug: false });

    if (result) {
        console.log('✓ RESULT:');
        console.log('  Food:', result.foodName);
        console.log('  Grams:', result.grams);
        console.log('  Expected for 2 lbs: 907.2g');
        console.log('  Calories:', result.kcal.toFixed(1));
        console.log('  Macros: P:', result.protein.toFixed(1), 'C:', result.carbs.toFixed(1), 'F:', result.fat.toFixed(1));
        console.log('  kcal/100g:', ((result.kcal / result.grams) * 100).toFixed(1));

        if (Math.abs(result.grams - 907.2) < 50) {
            console.log('  ✓ Grams are correct!');
        } else {
            console.log('  ❌ Grams are WRONG! Expected ~907g, got', result.grams);
        }
    } else {
        console.log('✗ No mapping found');
    }
}

main().catch(console.error);
