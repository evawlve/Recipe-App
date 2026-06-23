import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { getCachedFoodWithRelations, cacheFoodToDetails } from '../src/lib/fatsecret/cache-search';

async function traceHydration() {
    const foodId = 'fdc_173590';
    const input = "0.25 cup nonfat Italian dressing";

    console.log('=== TRACING HYDRATION ===\n');

    // Step 1: Parse input
    const parsed = parseIngredientLine(input);
    console.log('1. Parsed input:');
    console.log(`   qty: ${parsed?.qty}, unit: ${parsed?.unit}`);

    // Step 2: Get cached food
    console.log('\n2. Getting cached food...');
    const cached = await getCachedFoodWithRelations(foodId);
    console.log(`   Found: ${cached ? cached.name : 'NOT FOUND'}`);

    if (!cached) {
        console.log('   ❌ Food not in cache!');
        return;
    }

    // Step 3: Convert to details
    console.log('\n3. Converting to details...');
    const details = cacheFoodToDetails(cached);
    console.log(`   Servings: ${details.servings.length}`);
    console.log(`   nutrientsPer100g: ${JSON.stringify(details.nutrientsPer100g)}`);

    for (const s of details.servings) {
        console.log(`\n   Serving: "${s.measurementDescription}"`);
        console.log(`     servingWeightGrams: ${s.servingWeightGrams}`);
        console.log(`     metricServingAmount: ${s.metricServingAmount} ${s.metricServingUnit}`);
        console.log(`     calories: ${s.calories}`);
    }

    // Step 4: Check hasUsableServing
    console.log('\n4. Checking hasUsableServing...');
    const gramsForServing = (s: any) => {
        if (s.servingWeightGrams && s.servingWeightGrams > 0) return s.servingWeightGrams;
        if (s.metricServingUnit?.toLowerCase() === 'g' && s.metricServingAmount) return s.metricServingAmount;
        if (s.metricServingUnit?.toLowerCase() === 'ml' && s.metricServingAmount) return s.metricServingAmount;
        return null;
    };

    const hasUsable = details.servings.some(s => {
        const grams = gramsForServing(s);
        const result = grams != null && grams > 0;
        console.log(`   "${s.measurementDescription}": grams=${grams}, usable=${result}`);
        return result;
    });
    console.log(`   hasUsableServing: ${hasUsable}`);

    // Step 5: Volume conversion check
    console.log('\n5. Volume conversion check...');
    const volumeToMl: Record<string, number> = { 'ml': 1, 'tsp': 5, 'tbsp': 15, 'cup': 240 };
    const pattern = /(\d+(?:\.\d+)?)\s*(cup|cups|c|tbsp|tablespoon|tablespoons|tbs|tsp|teaspoon|teaspoons|ml)/i;

    for (const s of details.servings) {
        const desc = (s.measurementDescription || '').toLowerCase();
        const match = desc.match(pattern);
        console.log(`\n   "${desc}":`);
        if (match) {
            const amount = parseFloat(match[1]);
            const unit = match[2] === 'tablespoon' || match[2] === 'tablespoons' ? 'tbsp' : match[2];
            console.log(`     Pattern match: ${amount} ${unit}`);
            const servingMl = amount * (volumeToMl[unit] || 0);
            const requestedMl = 240; // cup
            const factor = requestedMl / servingMl;
            console.log(`     servingMl: ${servingMl}, factor: ${factor}`);
            const baseGrams = gramsForServing(s);
            const convertedGrams = baseGrams ? baseGrams * factor : null;
            console.log(`     baseGrams: ${baseGrams}, convertedGrams: ${convertedGrams}`);
        } else {
            console.log(`     No pattern match`);
        }
    }

    // Step 6: Test macro computation
    console.log('\n6. Testing macro computation...');
    if (details.nutrientsPer100g) {
        const qty = parsed?.qty ?? 1;
        const baseGrams = 240; // 1 cup from volume conversion
        const finalGrams = baseGrams * qty;
        const factor = finalGrams / 100;
        console.log(`   qty: ${qty}, baseGrams: ${baseGrams}, finalGrams: ${finalGrams}`);
        console.log(`   factor: ${factor}`);

        const nutrients = details.nutrientsPer100g;
        console.log(`   kcal: ${nutrients.calories! * factor}`);
        console.log(`   protein: ${nutrients.protein! * factor}`);
        console.log(`   carbs: ${nutrients.carbs! * factor}`);
    }
}

traceHydration().finally(() => prisma.$disconnect());
