#!/usr/bin/env tsx
import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function verifyPipeline() {
    const ingredients = [
        "1 medium onion",                // Expected: Onions (Generic)
        "1 oz fat free pudding",         // Expected: Fat Free Pudding (not regular)
        "1 tsp lemon zest",              // Expected: Lemon Peel (not Power Bar)
        "2 lbs extra lean ground beef",  // Expected: Extra Lean Beef (or 96%)
    ];

    console.log('=== Verifying Simplified Pipeline ===');

    for (const raw of ingredients) {
        console.log(`\n🧪 Testing: "${raw}"`);
        const start = Date.now();
        const result = await mapIngredientWithFallback(raw);
        const duration = Date.now() - start;

        if (result) {
            console.log(`\n✅ RESULT: "${result.foodName}"`);
            console.log(`   ID: ${result.fatSecretIdx}`);
            console.log(`   Brand: ${result.brandName || 'Generic'}`);
            console.log(`   Calories: ${result.calories}`);
        } else {
            console.log(`\n❌ FAILED`);
        }
    }
}

verifyPipeline().catch(console.error);
