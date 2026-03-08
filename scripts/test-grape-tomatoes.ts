/**
 * Test script: verify grape tomatoes count-based serving fix
 *
 * Bug (pre-fix): "20 grape tomatoes" → 2460g (20 × 123g, where 123g was for 5 tomatoes)
 * Expected:      "20 grape tomatoes" → ~480g  (20 × 24g, each tomato ~24g)
 *
 * Run:
 *   npx tsx scripts/test-grape-tomatoes.ts
 */
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { prisma } from '../src/lib/db';

async function main() {
    const client = new FatSecretClient();

    console.log('Testing: "20 grape tomatoes" (with skip-cache to force fresh serving selection)\n');

    const result = await mapIngredientWithFallback('20 grape tomatoes', {
        client,
        skipCache: true,
    });

    if (!result) {
        console.log('❌ FAILED: No result returned');
        return;
    }

    console.log(`Food:    ${result.foodName}`);
    console.log(`Grams:   ${result.grams.toFixed(1)}g`);
    console.log(`Kcal:    ${result.kcal.toFixed(1)}`);
    console.log(`Serving: ${result.servingDescription}`);
    console.log(`Conf:    ${result.confidence.toFixed(3)}`);
    console.log();

    const gramsPerTomato = result.grams / 20;
    console.log(`Per tomato: ${gramsPerTomato.toFixed(1)}g`);

    // A grape tomato is typically 15–25g. 2460g / 20 = 123g → clearly bugged.
    if (result.grams > 1500) {
        console.log('❌ DOUBLE MULTIPLIER BUG STILL PRESENT (grams too high)');
        console.log(`   ${result.grams.toFixed(0)}g for 20 grape tomatoes is unrealistic.`);
        console.log(`   Expected: ~300–600g total (15–30g each)`);
    } else if (result.grams > 50 && result.grams < 1200) {
        console.log('✅ PASS: Grams look reasonable for 20 grape tomatoes');
    } else {
        console.log(`⚠️  UNEXPECTED: ${result.grams.toFixed(0)}g – please inspect serving selection`);
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
