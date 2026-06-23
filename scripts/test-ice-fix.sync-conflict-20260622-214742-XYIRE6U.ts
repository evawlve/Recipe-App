import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';

async function test() {
    console.log('Testing crushed ice mapping fix...\n');

    const result = await mapIngredientWithFallback('1 cup crushed ice', { debug: true });

    if (result) {
        console.log('\n=== RESULT ===');
        console.log('Food:', result.foodName);
        console.log('Source:', result.source);
        console.log('Confidence:', result.confidence.toFixed(2));
        console.log('Kcal:', result.kcal);

        // Check if it's still the mints
        if (result.foodName.toLowerCase().includes('breakers')) {
            console.log('\n❌ STILL MAPPING TO ICE BREAKERS MINTS - FIX FAILED!');
        } else if (result.kcal > 50) {
            console.log('\n⚠️ WARNING: High calories for ice - may be wrong food');
        } else {
            console.log('\n✅ SUCCESS - Not mapping to mints!');
        }
    } else {
        console.log('\n❌ No result - mapping failed completely');
    }
}

test().finally(() => prisma.$disconnect());
