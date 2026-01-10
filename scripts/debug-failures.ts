import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';

const failures = [
    "4 cup dry mix light & fluffy buttermilk complete pancake mix",
    "3  egg",
    "1 medium onion",
    "0.3333333333333333 cup onions",
    "1 cup unsweetened coconut milk",
];

async function debug() {
    console.log('='.repeat(60));
    console.log('DEBUGGING FAILED INGREDIENTS');
    console.log('='.repeat(60));

    for (const input of failures) {
        console.log(`\n--- Testing: "${input}" ---`);

        try {
            const result = await mapIngredientWithFallback(input, {
                debug: true,
            });

            if (result) {
                console.log(`  ✅ SUCCESS: ${result.foodName}`);
                console.log(`     Source: ${result.source}`);
                console.log(`     Confidence: ${result.confidence.toFixed(2)}`);
                console.log(`     Serving: ${result.servingDescription} (${result.servingGrams}g)`);
            } else {
                console.log(`  ❌ STILL FAILED: null result`);
            }
        } catch (err) {
            console.log(`  ❌ ERROR: ${(err as Error).message}`);
        }
    }
}

debug().finally(() => prisma.$disconnect());
