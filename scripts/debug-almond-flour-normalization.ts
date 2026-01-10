#!/usr/bin/env ts-node

import 'dotenv/config';
import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { prisma } from '../src/lib/db';

async function debugAlmondFlourNormalization() {
    console.log('='.repeat(80));
    console.log('DEBUG: Per-100g Normalization for "0.5 cup almond flour"');
    console.log('='.repeat(80));
    console.log();

    const rawLine = '0.5 cup almond flour';
    const client = new FatSecretClient();

    // Step 1: Check what's in the cache
    console.log('STEP 1: Checking FatSecret Cache');
    console.log('-'.repeat(80));
    
    // Search for almond flour in cache
    const cacheResults = await prisma.fatSecretFoodCache.findMany({
        where: {
            name: {
                contains: 'almond',
                mode: 'insensitive',
            },
        },
        include: {
            servings: {
                take: 5,
            },
        },
        take: 3,
    });

    console.log(`Found ${cacheResults.length} cached foods matching "almond"`);
    for (const food of cacheResults) {
        console.log(`\n  Food: ${food.name}`);
        console.log(`  Brand: ${food.brandName || 'N/A'}`);
        console.log(`  NutrientsPer100g (from cache):`, food.nutrientsPer100g);
        
        if (food.servings && food.servings.length > 0) {
            console.log(`  Servings (first 3):`);
            for (const serving of food.servings.slice(0, 3)) {
                console.log(`    - ${serving.description || 'N/A'}`);
                console.log(`      Weight: ${serving.servingWeightGrams}g`);
                console.log(`      Calories: ${serving.calories}`);
                console.log(`      Protein: ${serving.protein}g`);
                console.log(`      Carbs: ${serving.carbohydrate}g`);
                console.log(`      Fat: ${serving.fat}g`);
                console.log(`      NumberOfUnits: ${serving.numberOfUnits}`);
            }
        }
    }
    console.log();

    // Step 2: Call mapIngredientWithFatsecret with detailed logging
    console.log('STEP 2: Mapping Ingredient with Detailed Logging');
    console.log('-'.repeat(80));
    console.log(`Raw ingredient: "${rawLine}"`);
    console.log();
    console.log('NOTE: Enable detailed logging by setting DEBUG_NORMALIZATION=true');
    console.log('      This will show computeMacros and normalization calculations');
    console.log();

    // Monkey-patch validateMappingWithAI to see what it receives
    const aiValidationModule = await import('../src/lib/fatsecret/ai-validation');
    const originalValidate = aiValidationModule.validateMappingWithAI;

    (aiValidationModule as any).validateMappingWithAI = async (rawLine: string, mapping: any) => {
        console.log('STEP 3: AI Validation Input');
        console.log('-'.repeat(80));
        console.log(`Raw ingredient: ${rawLine}`);
        console.log(`Mapped to: ${mapping.foodName}`);
        console.log(`Brand: ${mapping.brandName || 'N/A'}`);
        console.log(`Search query: ${mapping.searchQuery || 'N/A'}`);
        console.log(`Our confidence: ${mapping.ourConfidence}`);
        console.log();
        console.log('Nutrition passed to AI (per 100g):');
        console.log(`  Protein: ${mapping.nutrition.protein}g per 100g`);
        console.log(`  Carbs: ${mapping.nutrition.carbs}g per 100g`);
        console.log(`  Fat: ${mapping.nutrition.fat}g per 100g`);
        console.log(`  Calories: ${mapping.nutrition.kcal}kcal per 100g`);
        console.log();
        console.log('⚠️  FAT CONTENT CHECK:');
        console.log(`  Expected for almond flour: ~45-55g fat per 100g`);
        console.log(`  Actual passed to AI: ${mapping.nutrition.fat}g fat per 100g`);
        if (mapping.nutrition.fat > 100) {
            console.log(`  ❌ ERROR: Fat content is >100g per 100g (impossible!)`);
        } else if (mapping.nutrition.fat > 60) {
            console.log(`  ❌ ERROR: Fat content is too high (expected ~50g)`);
        }
        console.log();

        return originalValidate(rawLine, mapping);
    };

    // Enable debug logging
    process.env.DEBUG_NORMALIZATION = 'true';

    // Now call the mapping function
    console.log('Calling mapIngredientWithFatsecret...');
    console.log('(Check logs above for computeMacros and normalization details)');
    console.log();

    const result = await mapIngredientWithFatsecret(rawLine, {
        client,
        minConfidence: 0.5,
        debug: true,
    });

    console.log();
    console.log('STEP 4: Final Mapping Result');
    console.log('-'.repeat(80));

    if (!result) {
        console.log('❌ No mapping found');
        return;
    }

    console.log(`Mapped to: ${result.foodName}`);
    console.log(`Brand: ${result.brandName || 'N/A'}`);
    console.log(`Grams (recipe amount): ${result.grams}g`);
    console.log();
    console.log('Nutrition (for recipe amount - ' + result.grams + 'g):');
    console.log(`  Protein: ${result.protein}g`);
    console.log(`  Carbs: ${result.carbs}g`);
    console.log(`  Fat: ${result.fat}g`);
    console.log(`  Calories: ${result.kcal}kcal`);
    console.log();
    console.log('Manual per-100g calculation (for verification):');
    const manualProtein100 = (result.protein / result.grams) * 100;
    const manualCarbs100 = (result.carbs / result.grams) * 100;
    const manualFat100 = (result.fat / result.grams) * 100;
    const manualKcal100 = (result.kcal / result.grams) * 100;
    console.log(`  Protein: ${manualProtein100.toFixed(2)}g per 100g`);
    console.log(`  Carbs: ${manualCarbs100.toFixed(2)}g per 100g`);
    console.log(`  Fat: ${manualFat100.toFixed(2)}g per 100g`);
    console.log(`  Calories: ${manualKcal100.toFixed(2)}kcal per 100g`);
    console.log();

    if (result.aiValidation) {
        console.log('STEP 5: AI Validation Result');
        console.log('-'.repeat(80));
        console.log(`Approved: ${result.aiValidation.approved}`);
        console.log(`Confidence: ${result.aiValidation.confidence}`);
        console.log(`Reason: ${result.aiValidation.reason}`);
        console.log(`Category: ${result.aiValidation.category}`);
        console.log();
    }

    console.log('='.repeat(80));
    console.log('DEBUG COMPLETE');
    console.log('='.repeat(80));
    console.log();
    console.log('SUMMARY:');
    console.log('1. FatSecret cache stores nutrientsPer100g (already normalized)');
    console.log('2. Serving cache stores per-serving nutrition values');
    console.log('3. computeMacros() scales serving nutrition to recipe quantity');
    console.log('4. AI validation normalizes scaled values back to per-100g');
    console.log();
    console.log('KEY CHECKPOINTS:');
    console.log('- Serving nutrition values (from cache)');
    console.log('- Grams calculated for recipe amount');
    console.log('- Macros calculated by computeMacros()');
    console.log('- Per-100g normalization: (result.fat / result.grams) * 100');
    console.log('- Final values passed to AI');
    console.log();
    console.log('If fat > 100g per 100g, check:');
    console.log('  - Is result.grams correct?');
    console.log('  - Did computeMacros scale correctly?');
    console.log('  - Are serving nutrition values per-serving (not per-100g)?');
}

debugAlmondFlourNormalization()
    .catch((err) => {
        console.error('Error:', err);
        process.exit(1);
    })
    .finally(() => {
        prisma.$disconnect();
    });

