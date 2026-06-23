/**
 * Investigate Wrong Mappings
 * 
 * Tests problematic ingredients from the mapping summary and reports:
 * - What they map to currently
 * - At what pipeline stage the mapping was determined (cache, full_pipeline, etc.)
 * - Whether the mapping is correct or wrong
 * 
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/investigate-wrong-mappings.ts
 */

import { mapIngredientWithFallback, type FatsecretMappedIngredient } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';
import { FatSecretClient } from '../src/lib/fatsecret/client';

// Items that mapped to WRONG foods in the pre-fix mapping summary
const WRONG_MAPPINGS = [
    { raw: "1 tsp pepper", expectedContains: "black pepper", notExpected: "banana" },
    { raw: "1 dash pepper", expectedContains: "black pepper", notExpected: "banana" },
    { raw: "0.5 tbsp pepper", expectedContains: "black pepper", notExpected: "banana" },
    { raw: "1 dash ground pepper", expectedContains: "black pepper", notExpected: "banana" },
    { raw: "Tomato Sauce", expectedContains: "tomato sauce", notExpected: "steak" },
    { raw: "10 oz wheat penne", expectedContains: "penne", notExpected: "bagel" },
    { raw: "0.75 cup almond meal", expectedContains: "almond", notExpected: "malt-o-meal" },
    { raw: "1 tsp fennel", expectedContains: "fennel", notExpected: "sausage" },
    { raw: "2 tbsp mint", expectedContains: "mint", notExpected: "ball" },
    { raw: "20 mint", expectedContains: "mint", notExpected: "ball" },
    { raw: "Himalayan Salt", expectedContains: "salt", notExpected: "hazelnut" },
    { raw: "1 tsp dash salt", expectedContains: "salt", notExpected: "popcorn" },
    { raw: "Petite Tomatoes", expectedContains: "tomato", notExpected: "" },
    { raw: "Green Onion", expectedContains: "scallion|green onion", notExpected: "" },
    { raw: "1 jalapeno", expectedContains: "jalapeno|jalapeño", notExpected: "bagel" },
];

// Items that were 0.00 confidence (total failures)
const ZERO_CONF_SAMPLES = [
    { raw: "1 tsp cayenne pepper" },
    { raw: "Italian Seasoning" },
    { raw: "1 tbsp italian seasoning" },
    { raw: "Salt" },
    { raw: "1 dash salt" },
    { raw: "Vegetable Oil" },
    { raw: "0.5 cup vegetable oil" },
    { raw: "Coconut Oil" },
    { raw: "Sesame Oil" },
    { raw: "Canola Oil" },
    { raw: "Rosemary" },
    { raw: "Parsley Flakes" },
    { raw: "Baking Soda" },
    { raw: "Splenda" },
    { raw: "Sweetener" },
    { raw: "Dijon Mustard" },
    { raw: "Light Butter" },
    { raw: "Salted Butter" },
    { raw: "Butter Cooking Spray" },
    { raw: "Kosher Salt" },
    { raw: "Tomatoes with Green Chilies" },
    { raw: "Oil" },
    { raw: "No Calorie Sweetener" },
];

async function clearCacheForIngredient(rawLine: string) {
    await prisma.validatedMapping.deleteMany({
        where: {
            OR: [
                { rawIngredient: { contains: rawLine.toLowerCase(), mode: 'insensitive' } },
                { normalizedForm: { contains: rawLine.toLowerCase(), mode: 'insensitive' } },
            ]
        }
    });
}

async function testIngredient(rawLine: string, client: FatSecretClient): Promise<{
    raw: string;
    foodName: string | null;
    confidence: number;
    source: string | null;
    kcal: number;
    grams: number;
    quality: string | null;
}> {
    // Clear cache first
    await clearCacheForIngredient(rawLine);

    try {
        const result = await mapIngredientWithFallback(rawLine, client);
        if (result) {
            return {
                raw: rawLine,
                foodName: result.foodName,
                confidence: result.confidence,
                source: result.source,
                kcal: Math.round(result.kcal),
                grams: Math.round(result.grams * 10) / 10,
                quality: result.quality,
            };
        }
        return { raw: rawLine, foodName: null, confidence: 0, source: null, kcal: 0, grams: 0, quality: null };
    } catch (error) {
        return { raw: rawLine, foodName: `ERROR: ${(error as Error).message.slice(0, 50)}`, confidence: 0, source: null, kcal: 0, grams: 0, quality: null };
    }
}

async function main() {
    // Suppress prisma query logging
    const originalLog = console.log;
    const filteredLog = (...args: any[]) => {
        const msg = args.map(a => String(a)).join(' ');
        if (msg.includes('prisma:query') || msg.includes('SELECT "public"') || msg.includes('DELETE FROM') || msg.includes('INSERT INTO') || msg.includes('UPDATE "public"')) return;
        originalLog(...args);
    };
    console.log = filteredLog;

    const client = new FatSecretClient();

    // ==== Test Wrong Mappings ====
    originalLog('\n' + '='.repeat(100));
    originalLog('  WRONG MAPPING INVESTIGATION (items that mapped to incorrect foods)');
    originalLog('='.repeat(100));

    for (const item of WRONG_MAPPINGS) {
        const result = await testIngredient(item.raw, client);
        const foodLower = (result.foodName || '').toLowerCase();

        let status = '❓';
        if (!result.foodName) {
            status = '❌ FAIL';
        } else if (item.notExpected && foodLower.includes(item.notExpected.toLowerCase())) {
            status = '🔴 WRONG';
        } else if (item.expectedContains.split('|').some(e => foodLower.includes(e.toLowerCase()))) {
            status = '✅ FIXED';
        } else {
            status = '🟡 CHECK';
        }

        originalLog(`\n${status} "${item.raw}"`);
        originalLog(`   → ${result.foodName || '(none)'} [${result.confidence.toFixed(2)}] ${result.source || ''}`);
        originalLog(`   ${result.kcal}kcal / ${result.grams}g | Quality: ${result.quality || 'n/a'}`);
        if (item.notExpected && foodLower.includes(item.notExpected.toLowerCase())) {
            originalLog(`   ⚠️  Still contains "${item.notExpected}" — WRONG MAPPING`);
        }
    }

    // ==== Test Zero-Conf Failures ====
    originalLog('\n\n' + '='.repeat(100));
    originalLog('  ZERO-CONFIDENCE FAILURE INVESTIGATION (items that had 0.00 confidence)');
    originalLog('='.repeat(100));

    let fixed = 0;
    let stillFailing = 0;

    for (const item of ZERO_CONF_SAMPLES) {
        const result = await testIngredient(item.raw, client);

        const status = result.foodName && result.confidence > 0 ? '✅' : '❌';
        if (result.confidence > 0) fixed++;
        else stillFailing++;

        originalLog(`\n${status} "${item.raw}"`);
        originalLog(`   → ${result.foodName || '(none)'} [${result.confidence.toFixed(2)}] ${result.source || ''}`);
        if (result.foodName && result.confidence > 0) {
            originalLog(`   ${result.kcal}kcal / ${result.grams}g`);
        }
    }

    // ==== Summary ====
    originalLog('\n\n' + '='.repeat(100));
    originalLog('  SUMMARY');
    originalLog('='.repeat(100));
    originalLog(`  Zero-conf items: ${fixed}/${ZERO_CONF_SAMPLES.length} now fixed, ${stillFailing} still failing`);
    originalLog('='.repeat(100) + '\n');

    console.log = originalLog;
    await prisma.$disconnect();
}

main().catch(console.error);
