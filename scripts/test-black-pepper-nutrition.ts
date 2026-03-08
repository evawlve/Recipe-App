#!/usr/bin/env ts-node

import 'dotenv/config';
import fs from 'fs';
import { prisma } from '../src/lib/db';
import { cacheFoodToDetails } from '../src/lib/fatsecret/cache-search';

const LOG_FILE = 'logs/test-black-pepper-nutrition.log';

// Override console.log to write to file
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'w' });
const originalLog = console.log;
console.log = (...args: any[]) => {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' ');
    logStream.write(message + '\n');
    originalLog(...args);
};

// Copy of gramsForServing from map-ingredient.ts
function gramsForServing(serving: any): number | null {
    if (serving.servingWeightGrams != null && serving.servingWeightGrams > 0) {
        return serving.servingWeightGrams;
    }
    if (serving.metricServingAmount != null && serving.metricServingUnit) {
        const unitLower = serving.metricServingUnit.toLowerCase();
        if (unitLower === 'g' || unitLower === 'gram' || unitLower === 'grams') {
            return serving.metricServingAmount;
        }
        if (unitLower === 'ml' || unitLower === 'milliliter' || unitLower === 'milliliters') {
            return serving.metricServingAmount;
        }
    }
    return null;
}

// This is the pickRepresentativeServing function from map-ingredient.ts
function pickRepresentativeServing(details: any): { nutrition: any | null; serving: any } | null {
    if (!details.servings || details.servings.length === 0) {
        console.log('❌ No servings found!');
        return null;
    }

    console.log(`\n📋 Checking ${details.servings.length} servings...`);

    const servingWithWeight = details.servings.find(
        (s: any) => {
            const grams = gramsForServing(s);
            const hasNutrition = s.calories != null && s.protein != null && s.carbohydrate != null && s.fat != null;

            console.log(`\n  Serving: "${s.description || s.measurementDescription}"`);
            console.log(`    Grams: ${grams}`);
            console.log(`    Calories: ${s.calories}`);
            console.log(`    Protein: ${s.protein}`);
            console.log(`    Carbs: ${s.carbohydrate}`);
            console.log(`    Fat: ${s.fat}`);
            console.log(`    Has all data: ${grams && hasNutrition ? '✅' : '❌'}`);

            return grams && hasNutrition;
        }
    );

    if (!servingWithWeight) {
        console.log('\n❌ No serving with complete weight + nutrition found!');
        return { nutrition: null, serving: {} };
    }

    console.log('\n✅ Found valid serving!');

    const grams = gramsForServing(servingWithWeight);
    if (!grams || grams <= 0) {
        console.log(`❌ Invalid grams: ${grams}`);
        return { nutrition: null, serving: {} };
    }

    const factor = 100 / grams;
    const nutrition = {
        kcal: servingWithWeight.calories * factor,
        protein: servingWithWeight.protein * factor,
        carbs: servingWithWeight.carbohydrate * factor,
        fat: servingWithWeight.fat * factor,
    };

    console.log(`\n🧮 Calculating per-100g (factor: ${factor.toFixed(2)}):`);
    console.log(`  Kcal: ${servingWithWeight.calories} * ${factor.toFixed(2)} = ${nutrition.kcal.toFixed(1)}`);
    console.log(`  Protein: ${servingWithWeight.protein} * ${factor.toFixed(2)} = ${nutrition.protein.toFixed(1)}`);
    console.log(`  Carbs: ${servingWithWeight.carbohydrate} * ${factor.toFixed(2)} = ${nutrition.carbs.toFixed(1)}`);
    console.log(`  Fat: ${servingWithWeight.fat} * ${factor.toFixed(2)} = ${nutrition.fat.toFixed(1)}`);

    return {
        nutrition,
        serving: {
            description: servingWithWeight.description ?? servingWithWeight.measurementDescription ?? null,
            grams,
            metricAmount: servingWithWeight.metricServingAmount ?? null,
            metricUnit: servingWithWeight.metricServingUnit ?? null,
        },
    };
}

async function testBlackPepperNutrition() {
    console.log('🔍 Testing Black Pepper Nutrition Calculation\n');
    console.log('='.repeat(60));

    // Black Pepper food ID from the log
    const foodId = '33892';

    console.log(`\n📦 Fetching Black Pepper (ID: ${foodId}) from cache...`);

    const cached = await prisma.fatSecretFoodCache.findUnique({
        where: { id: foodId },
        include: {
            servings: true,
            aliases: true,
            densityEstimates: true,
        }
    });

    if (!cached) {
        console.log('❌ Black Pepper not found in cache!');
        logStream.end();
        return;
    }

    console.log(`✅ Found: ${cached.name}`);
    console.log(`   Brand: ${cached.brandName || 'generic'}`);
    console.log(`   Food Type: ${cached.foodType}`);
    console.log(`   Servings: ${cached.servings.length}`);

    // Convert to details format
    const details = cacheFoodToDetails(cached as any);

    console.log('\n' + '='.repeat(60));
    console.log('🔬 Running pickRepresentativeServing...');
    console.log('='.repeat(60));

    const result = pickRepresentativeServing(details);

    console.log('\n' + '='.repeat(60));
    console.log('📊 RESULT:');
    console.log('='.repeat(60));

    if (!result || !result.nutrition) {
        console.log('❌ No nutrition calculated!');
    } else {
        console.log(`✅ Nutrition per 100g:`);
        console.log(`   Calories: ${result.nutrition.kcal.toFixed(1)} kcal`);
        console.log(`   Protein: ${result.nutrition.protein.toFixed(1)}g`);
        console.log(`   Carbs: ${result.nutrition.carbs.toFixed(1)}g`);
        console.log(`   Fat: ${result.nutrition.fat.toFixed(1)}g`);

        console.log(`\n📏 Representative Serving:`);
        console.log(`   Description: ${result.serving.description}`);
        console.log(`   Grams: ${result.serving.grams}g`);

        // Check if this looks like spice nutrition
        const kcalPer100 = result.nutrition.kcal;
        if (kcalPer100 > 200) {
            console.log(`\n✅ Nutrition profile matches a SPICE (${kcalPer100.toFixed(0)} kcal/100g)`);
        } else {
            console.log(`\n⚠️  WARNING: Low calories (${kcalPer100.toFixed(0)} kcal/100g) - doesn't look like a spice!`);
        }
    }

    console.log('\n');
    console.log(`📝 Full log written to: ${LOG_FILE}`);
    logStream.end();
    await prisma.$disconnect();
}

testBlackPepperNutrition().catch(console.error);
