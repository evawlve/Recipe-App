#!/usr/bin/env npx tsx

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    console.log('Testing: 1 cup reduced fat colby and monterey jack cheese');
    console.log('='.repeat(60));

    const result = await mapIngredientWithFallback(
        '1 cup reduced fat colby and monterey jack cheese',
        { debug: true }
    );

    if (result) {
        console.log('\n✅ SUCCESS!');
        console.log('Food:', result.foodName);
        console.log('Food ID:', result.foodId);
        console.log('Confidence:', result.confidence);
        console.log('Grams:', result.grams);
        console.log('Calories:', result.kcal);
        console.log('Fat:', result.fat);
    } else {
        console.log('\n❌ FAILED - No mapping found');
    }
}

main().catch(console.error);
