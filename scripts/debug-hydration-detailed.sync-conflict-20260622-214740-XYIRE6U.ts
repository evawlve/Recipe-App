import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { getCachedFoodWithRelations, cacheFoodToDetails } from '../src/lib/fatsecret/cache-search';

async function debugHydration() {
    const input = "0.25 cup nonfat Italian dressing";
    const foodId = "fdc_173590";

    console.log('=== DETAILED HYDRATION DEBUG ===\n');
    console.log(`Input: "${input}"`);
    console.log(`Food ID: ${foodId}\n`);

    // Step 1: Parse the input
    const parsed = parseIngredientLine(input);
    console.log('1. PARSED INPUT:');
    console.log(`   qty: ${parsed?.qty}`);
    console.log(`   unit: ${parsed?.unit}`);
    console.log(`   name: ${parsed?.name}`);
    console.log(`   multiplier: ${parsed?.multiplier}`);

    // Step 2: Get food with relations from cache
    console.log('\n2. GETTING FOOD FROM CACHE:');
    const cachedFood = await getCachedFoodWithRelations(foodId);

    if (!cachedFood) {
        console.log('   ❌ NOT IN CACHE');
        return;
    }

    console.log(`   ✅ Found: ${cachedFood.name}`);
    console.log(`   Servings count: ${cachedFood.servings?.length || 0}`);

    // Step 3: Convert to details
    console.log('\n3. CONVERTING TO DETAILS:');
    const details = cacheFoodToDetails(cachedFood);
    console.log(`   Servings count in details: ${details?.servings?.length || 0}`);

    if (details?.servings) {
        for (const serving of details.servings) {
            console.log(`\n   Serving: "${serving.measurementDescription || serving.description}"`);
            console.log(`     servingWeightGrams: ${serving.servingWeightGrams}`);
            console.log(`     metricServingAmount: ${serving.metricServingAmount}`);
            console.log(`     metricServingUnit: ${serving.metricServingUnit}`);

            // Test gramsForServing logic
            let grams: number | null = null;
            if (serving.servingWeightGrams && serving.servingWeightGrams > 0) {
                grams = serving.servingWeightGrams;
            } else if (serving.metricServingUnit?.toLowerCase() === 'g' && serving.metricServingAmount) {
                grams = serving.metricServingAmount;
            } else if (serving.metricServingUnit?.toLowerCase() === 'ml' && serving.metricServingAmount) {
                grams = serving.metricServingAmount;
            }
            console.log(`     → gramsForServing result: ${grams}`);
        }
    }

    // Step 4: Test hasUsableServing
    console.log('\n4. TESTING hasUsableServing:');
    const hasUsable = details?.servings?.some(s => {
        const grams = s.servingWeightGrams ??
            (s.metricServingUnit?.toLowerCase() === 'g' ? s.metricServingAmount :
                s.metricServingUnit?.toLowerCase() === 'ml' ? s.metricServingAmount : null);
        const result = grams != null && grams > 0;
        console.log(`   "${s.measurementDescription}": grams=${grams}, usable=${result}`);
        return result;
    });
    console.log(`   hasUsableServing: ${hasUsable}`);

    // Step 5: Test selectServing with volume conversion
    console.log('\n5. TESTING selectServing:');
    const unit = parsed?.unit?.toLowerCase() ?? null;
    console.log(`   Requested unit: "${unit}"`);

    const volumeToMl: Record<string, number> = {
        'ml': 1, 'tsp': 5, 'tbsp': 15, 'cup': 240, 'c': 240, 'floz': 30,
    };

    const unitMappings: Record<string, string[]> = {
        'cup': ['cup', 'c', 'cups'],
        'tbsp': ['tbsp', 'tablespoon', 'tablespoons', 'tbs'],
        'tsp': ['tsp', 'teaspoon', 'teaspoons'],
    };

    const getCanonicalVolumeUnit = (u: string | null): string | null => {
        if (!u) return null;
        const lower = u.toLowerCase();
        for (const [key, aliases] of Object.entries(unitMappings)) {
            if ((key === lower || aliases.includes(lower)) && volumeToMl[key]) {
                return key;
            }
        }
        return volumeToMl[lower] ? lower : null;
    };

    const requestedVolumeUnit = getCanonicalVolumeUnit(unit);
    console.log(`   Canonical volume unit: "${requestedVolumeUnit}"`);
    console.log(`   requestedMl: ${requestedVolumeUnit ? volumeToMl[requestedVolumeUnit] : 'N/A'}`);

    const pattern = /(\d+(?:\.\d+)?)\s*(cup|cups|c|tbsp|tablespoon|tablespoons|tbs|tsp|teaspoon|teaspoons|ml|floz)/i;

    if (details?.servings) {
        for (const serving of details.servings) {
            const desc = (serving.measurementDescription || serving.description || '').toLowerCase();
            console.log(`\n   Testing serving: "${desc}"`);

            const match = desc.match(pattern);
            if (match) {
                const amount = parseFloat(match[1]);
                const rawUnit = match[2].toLowerCase();
                const canonical = getCanonicalVolumeUnit(rawUnit);
                console.log(`     Pattern match: ${amount} ${rawUnit} → canonical: ${canonical}`);

                if (canonical && volumeToMl[canonical] && requestedVolumeUnit) {
                    const servingMl = amount * volumeToMl[canonical];
                    const requestedMl = volumeToMl[requestedVolumeUnit];
                    const conversionFactor = requestedMl / servingMl;
                    const grams = serving.servingWeightGrams ||
                        (serving.metricServingUnit?.toLowerCase() === 'g' ? serving.metricServingAmount :
                            serving.metricServingUnit?.toLowerCase() === 'ml' ? serving.metricServingAmount : null);
                    const convertedGrams = grams ? grams * conversionFactor : null;

                    console.log(`     servingMl: ${servingMl}`);
                    console.log(`     requestedMl: ${requestedMl}`);
                    console.log(`     conversionFactor: ${conversionFactor}`);
                    console.log(`     base grams: ${grams}`);
                    console.log(`     → CONVERTED GRAMS: ${convertedGrams}g for 1 ${requestedVolumeUnit}`);
                }
            } else {
                console.log(`     No pattern match`);
            }
        }
    }
}

debugHydration().finally(() => prisma.$disconnect());
