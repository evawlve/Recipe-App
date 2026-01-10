import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function test() {
    console.log('\n=== Testing 3 Mapping Fixes ===\n');

    // Test 1: Ice/water zero-calorie fix
    console.log('1. Testing ice/water zero-calorie fix...');
    const ice = await mapIngredientWithFallback('1 cup crushed ice');
    if (ice && ice.kcal === 0 && ice.foodName === 'Water') {
        console.log('   ✅ PASS: crushed ice → 0 kcal');
    } else {
        console.log('   ❌ FAIL: crushed ice result:', ice ? { food: ice.foodName, kcal: ice.kcal } : 'null');
    }

    // Test 2: Test water
    const water = await mapIngredientWithFallback('2 cups water');
    if (water && water.kcal === 0 && water.foodName === 'Water') {
        console.log('   ✅ PASS: water → 0 kcal');
    } else {
        console.log('   ❌ FAIL: water result:', water ? { food: water.foodName, kcal: water.kcal } : 'null');
    }

    // Test 3: Container yogurt  
    console.log('\n2. Testing container yogurt ambiguous unit...');
    const yogurt = await mapIngredientWithFallback('1 container low fat yogurt');
    if (yogurt && yogurt.kcal > 0) {
        console.log(`   ✅ PASS: container yogurt mapped → ${yogurt.foodName} (${Math.round(yogurt.kcal)} kcal, ${Math.round(yogurt.grams)}g)`);
    } else {
        console.log('   ❌ FAIL: container yogurt result:', yogurt);
    }

    // Test 4: Strawberry typo should NOT map to cheesecake
    console.log('\n3. Testing typo handling (strawberry)...');
    const stberry = await mapIngredientWithFallback('1 cup stberry');
    if (stberry && !stberry.foodName.toLowerCase().includes('cheesecake')) {
        console.log(`   ✅ PASS: stberry mapped → ${stberry.foodName} (no cheesecake!)`);
    } else if (stberry) {
        console.log(`   ❌ FAIL: stberry mapped to: ${stberry.foodName}`);
    } else {
        console.log('   ⚠️ WARN: stberry returned null');
    }

    console.log('\n=== Test Complete ===\n');
}

test().catch(console.error);
