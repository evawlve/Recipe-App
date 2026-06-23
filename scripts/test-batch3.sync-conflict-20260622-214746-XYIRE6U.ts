import 'dotenv/config';
import { debugIngredient } from '../src/lib/fatsecret/debug-ingredient';

async function testBatch3() {
  const testCases = [
    "1 cup greek nonfat yogurt plain",
    "4 tbsp nutritional yeast",
    "1 cup corn kernels",
    "32 oz light red kidney beans",
    "4 medium baby marrows zucchini",
  ];

  for (const tc of testCases) {
    console.log(`\n\n=== TESTING: ${tc} ===`);
    const result = await debugIngredient(tc, { skipCacheCheck: true });
    
    if (result) {
        console.log(`✅ MATCH: ${result.foodName}`);
        console.log(`   Serving: ${result.servingDescription}`);
        console.log(`   Weight: ${result.grams.toFixed(1)}g`);
        console.log(`   Calories: ${result.kcal.toFixed(1)}kcal`);
    } else {
        console.log(`❌ FAILED: No match found`);
    }
  }
}

testBatch3().catch(console.error);
