#!/usr/bin/env ts-node

import 'dotenv/config';
import fs from 'fs';
import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';
import { FatSecretClient } from '../src/lib/fatsecret/client';

const LOG_FILE = 'logs/test-pepper-query.log';

// Override console.log to write to file
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'w' });
const originalLog = console.log;
console.log = (...args: any[]) => {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' ');
    logStream.write(message + '\n');
    originalLog(...args); // Also write to console
};

async function testPepperQuery() {
    console.log('🔍 Testing "1 dash pepper" query\n');
    console.log('='.repeat(60));

    const client = new FatSecretClient();

    const result = await mapIngredientWithFatsecret('1 dash pepper', {
        client,
        minConfidence: 0.5,
        skipAiValidation: true,
        debug: false,
    });

    console.log('\n' + '='.repeat(60));
    console.log('📊 FINAL RESULT:');
    console.log('='.repeat(60));

    if (result) {
        console.log(`✅ Mapped to: ${result.foodName}`);
        console.log(`   Brand: ${result.brandName || 'generic'}`);
        console.log(`   Food ID: ${result.foodId}`);
        console.log(`   Confidence: ${result.confidence.toFixed(3)}`);
        console.log(`   Serving: ${result.servingDescription} (${result.grams}g)`);
        console.log(`   Nutrition: ${result.kcal} kcal, ${result.protein}g protein`);

        // Calculate per-100g
        if (result.grams > 0) {
            const per100 = {
                kcal: (result.kcal / result.grams) * 100,
                protein: (result.protein / result.grams) * 100,
                carbs: (result.carbs / result.grams) * 100,
                fat: (result.fat / result.grams) * 100,
            };
            console.log(`   Per 100g: ${per100.kcal.toFixed(0)} kcal, ${per100.protein.toFixed(1)}g protein`);

            // Check if it's the right type
            if (per100.kcal < 100) {
                console.log(`\n⚠️  WARNING: Low calories per 100g (${per100.kcal.toFixed(0)} kcal)`);
                console.log(`   This looks like a VEGETABLE, not a SPICE!`);
                console.log(`   Expected: Black pepper ~250-350 kcal/100g`);
            } else if (per100.kcal > 200) {
                console.log(`\n✅ Nutrition profile matches a SPICE (${per100.kcal.toFixed(0)} kcal/100g)`);
            }
        }

        if (result.aiValidation) {
            console.log(`\n🤖 AI Validation:`);
            console.log(`   Approved: ${result.aiValidation.approved}`);
            console.log(`   Confidence: ${result.aiValidation.confidence}`);
            console.log(`   Reason: ${result.aiValidation.reason}`);
        }
    } else {
        console.log('❌ No mapping found');
    }

    console.log('\n');
    console.log(`📝 Full log written to: ${LOG_FILE}`);
    logStream.end();
}

testPepperQuery().catch(console.error);
