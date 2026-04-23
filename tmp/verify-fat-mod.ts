import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function test() {
    console.log("Testing Low Fat Modifier Bypass Fix...");
    
    // 1. Regular Milk
    const m1 = await mapIngredientWithFallback('1 cup milk', { skipCache: true });
    console.log(`\n[Regular] 1 cup milk -> ${m1?.foodName}`);
    if (m1) console.log(`  Fat per 100g: ${(m1.fat / m1.grams * 100).toFixed(1)}g (Calories: ${(m1.kcal / m1.grams * 100).toFixed(0)})`);

    // 2. Low Fat Milk
    const m2 = await mapIngredientWithFallback('1 cup low fat milk', { skipCache: true });
    console.log(`\n[Low Fat] 1 cup low fat milk -> ${m2?.foodName}`);
    if (m2) console.log(`  Fat per 100g: ${(m2.fat / m2.grams * 100).toFixed(1)}g (Calories: ${(m2.kcal / m2.grams * 100).toFixed(0)})`);

    // 3. Regular American Cheese
    const c1 = await mapIngredientWithFallback('1 slice american cheese', { skipCache: true });
    console.log(`\n[Regular] 1 slice american cheese -> ${c1?.foodName}`);
    if (c1) console.log(`  Fat per 100g: ${(c1.fat / c1.grams * 100).toFixed(1)}g`);

    // 4. Low Fat American Cheese
    const c2 = await mapIngredientWithFallback('1 slice low fat american cheese', { skipCache: true });
    console.log(`\n[Low Fat] 1 slice low fat american cheese -> ${c2?.foodName}`);
    if (c2) console.log(`  Fat per 100g: ${(c2.fat / c2.grams * 100).toFixed(1)}g`);
}

test().catch(console.error).finally(() => process.exit(0));
