#!/usr/bin/env ts-node
/**
 * Diagnose "light"/"low fat" ingredient failures from the April 2026 pilot import.
 * Uses compare-api-candidates pattern to show what BOTH APIs return.
 * 
 * Goal: Determine if the failure is a DATA GAP (APIs don't have these products)
 * or a PIPELINE ERROR (APIs have them but we filter/reject them).
 */

import 'dotenv/config';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { prisma } from '../src/lib/db';

const client = new FatSecretClient();

// All the failing "light"/"low fat" queries from the audit
const QUERIES = [
    // ===== LOW_CONF failures (returned 0 results) =====
    'light sour cream',
    'low fat cheddar cheese',
    'light cream',
    'low fat monterey jack cheese',
    'light butter',
    'low fat cream of chicken soup',
    'low fat milk',
    'velveeta light',

    // ===== Resolved but modifier was IGNORED =====
    'nonfat mozzarella cheese',
    'skim yogurt',
    'evaporated skim milk',

    // ===== Control queries (should work fine) =====
    'sour cream',          // full-fat version
    'cheddar cheese',      // full-fat version
    'monterey jack cheese', // full-fat version
];

async function searchFatSecret(query: string) {
    console.log(`\n   📦 FatSecret Results for "${query}":`);
    try {
        const results = await client.searchFoodsV4(query, { maxResults: 8 });

        if (results.length === 0) {
            console.log(`      ❌ ZERO RESULTS — API data gap!`);
            return;
        }

        for (let i = 0; i < results.length; i++) {
            const food = results[i];
            console.log(`      #${i + 1}: ${food.name}${food.brandName ? ` (${food.brandName})` : ''} [id=${food.id}]`);

            try {
                const details = await client.getFoodDetails(food.id);
                if (details?.nutrientsPer100g) {
                    const n = details.nutrientsPer100g;
                    console.log(`          📊 Per 100g: ${n.calories}kcal | P:${n.protein}g C:${n.carbs}g F:${n.fat}g`);
                } else if (details?.servings?.[0]) {
                    const s = details.servings[0];
                    console.log(`          📊 Serving (${s.description}): ${s.calories}kcal | P:${s.protein}g C:${s.carbs}g F:${s.fat}g`);
                }
            } catch {
                console.log(`          (no nutrition data)`);
            }
        }
    } catch (err) {
        console.log(`      Error: ${(err as Error).message}`);
    }
}

async function searchFDC(query: string) {
    console.log(`\n   🔬 FDC Results for "${query}":`);
    try {
        const response = await fetch(
            `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&pageSize=5&dataType=Foundation,SR Legacy`,
            { headers: { 'X-Api-Key': process.env.FDC_API_KEY || 'DEMO_KEY' } }
        );
        const data = await response.json();

        if (!data.foods || data.foods.length === 0) {
            console.log(`      ❌ ZERO RESULTS — API data gap!`);
            return;
        }

        for (let i = 0; i < Math.min(5, data.foods.length); i++) {
            const food = data.foods[i];
            const getNutrient = (id: number) => food.foodNutrients?.find((n: any) => n.nutrientId === id)?.value || 0;

            const calories = getNutrient(1008);
            const protein = getNutrient(1003);
            const carbs = getNutrient(1005);
            const fat = getNutrient(1004);

            console.log(`      #${i + 1}: ${food.description} [fdcId=${food.fdcId}]`);
            console.log(`          📊 Per 100g: ${calories}kcal | P:${protein}g C:${carbs}g F:${fat}g`);
            console.log(`          Type: ${food.dataType}`);
        }
    } catch (err) {
        console.log(`      Error: ${(err as Error).message}`);
    }
}

async function main() {
    console.log('\n🔍 Light/LowFat Ingredient Candidate Analysis\n');
    console.log('='.repeat(70));
    console.log('Goal: Is the failure a DATA GAP or a PIPELINE ERROR?\n');

    for (const query of QUERIES) {
        console.log(`\n${'='.repeat(70)}`);
        console.log(`\n🎯 Query: "${query}"`);

        await searchFatSecret(query);
        await searchFDC(query);
    }

    console.log('\n' + '='.repeat(70));
    console.log('\n✅ Analysis complete!\n');
}

main()
    .catch((error) => {
        console.error('Error:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
