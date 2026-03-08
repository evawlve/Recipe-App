#!/usr/bin/env ts-node

import 'dotenv/config';
import fs from 'fs';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { FatSecretClient } from '../src/lib/fatsecret/client';

const LOG_FILE = 'logs/test-parser-issues.log';

const logStream = fs.createWriteStream(LOG_FILE, { flags: 'w' });
const originalLog = console.log;
console.log = (...args: any[]) => {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' ');
    logStream.write(message + '\n');
    originalLog(...args);
};

async function testParserIssues() {
    console.log('🔍 Testing Parser & Mapping Issues\n');
    console.log('='.repeat(60));

    const testCases = [
        '1  packet sweetener',
        '0.25 cup & 1 tbsp ground golden flaxseed meal',
        '2  tbsps flaxseed meal',
        '1 cup and 2 tbsp almond flour',  // Test "and" variant
        '0.5 cup & 1 tsp vanilla extract', // Another complex measurement
    ];

    const client = new FatSecretClient();

    for (const testCase of testCases) {
        console.log('\n' + '='.repeat(60));
        console.log(`📋 Test: "${testCase}"`);
        console.log('='.repeat(60));

        // Test parsing
        console.log('\n🔍 Parsing:');
        const parsed = parseIngredientLine(testCase);
        if (parsed) {
            console.log(`  ✅ Parsed successfully:`);
            console.log(`     Amount: ${parsed.qty}`);
            console.log(`     Unit: ${parsed.unit || 'none'}`);
            console.log(`     Ingredient: ${parsed.name}`);
            console.log(`     Multiplier: ${parsed.multiplier}`);
            console.log(`     Unit Hint: ${parsed.unitHint || 'none'}`);
        } else {
            console.log(`  ❌ Failed to parse`);
        }

        // Test mapping
        console.log('\n🗺️  Mapping:');
        try {
            await new Promise(resolve => setTimeout(resolve, 200)); // Rate limit

            const result = await mapIngredientWithFallback(testCase, {
                client,
                minConfidence: 0.5,
                skipAiValidation: true,
                debug: false,
            });

            if (result) {
                console.log(`  ✅ Mapped to: ${result.foodName}`);
                console.log(`     Brand: ${result.brandName || 'generic'}`);
                console.log(`     Confidence: ${result.confidence.toFixed(3)}`);
                console.log(`     Serving: ${result.servingDescription} (${result.grams}g)`);

                // Calculate per-100g for context
                if (result.grams > 0) {
                    const per100 = {
                        kcal: (result.kcal / result.grams) * 100,
                        protein: (result.protein / result.grams) * 100,
                    };
                    console.log(`     Per 100g: ${per100.kcal.toFixed(0)} kcal, ${per100.protein.toFixed(1)}g protein`);
                }

                // Check if mapping seems reasonable
                if (testCase.includes('sweetener') && !result.foodName.toLowerCase().includes('sweet')) {
                    console.log(`     ⚠️  WARNING: Sweetener query mapped to non-sweetener!`);
                }
                if (testCase.includes('flaxseed') && !result.foodName.toLowerCase().includes('flax')) {
                    console.log(`     ⚠️  WARNING: Flaxseed query mapped to non-flaxseed!`);
                }
            } else {
                console.log(`  ❌ No mapping found`);
            }
        } catch (error) {
            console.log(`  ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📝 Full log written to: ' + LOG_FILE);
    logStream.end();
}

testParserIssues().catch(console.error);
