/**
 * Diagnostic script to investigate mapping issues:
 * 1. What candidates come back for "crushed ice"?
 * 2. What's the serving data for honey/mayonnaise/sugar?
 */

// Suppress logger output
process.env.LOG_LEVEL = 'error';

import { prisma } from '../lib/db';
import { gatherCandidates } from '../lib/fatsecret/gather-candidates';
import { parseIngredientLine } from '../lib/parse/ingredient-line';
import { normalizeIngredientName } from '../lib/fatsecret/normalization-rules';

async function investigateIceCandidates() {
    console.log('\n========================================');
    console.log('INVESTIGATING: "crushed ice" candidates');
    console.log('========================================\n');

    const rawLine = '1 cup crushed ice';
    const parsed = parseIngredientLine(rawLine);
    const normalizedName = normalizeIngredientName(parsed?.name || 'crushed ice').cleaned;

    console.log('Parsed:', JSON.stringify(parsed, null, 2));
    console.log('Normalized name:', normalizedName);

    // Gather candidates
    const candidates = await gatherCandidates(rawLine, parsed, normalizedName, {
        skipFdc: false,
        maxPerSource: 10,
    });

    console.log('\n--- ALL CANDIDATES (top 15) ---');
    for (const c of candidates.slice(0, 15)) {
        console.log(`[${c.source}] ${c.name} (${c.brandName || 'no brand'}) - score: ${c.score.toFixed(2)}`);
        if (c.nutrition) {
            console.log(`    Nutrition (per 100g): ${c.nutrition.kcal}kcal`);
        }
    }

    // Check if there are any actual "ice" candidates
    const iceCandidates = candidates.filter(c =>
        c.name.toLowerCase().includes('ice') &&
        !c.name.toLowerCase().includes('rice')
    );
    console.log('\n--- ICE CANDIDATES (not rice) ---');
    console.log(`Found ${iceCandidates.length} ice candidates:`);
    for (const c of iceCandidates) {
        console.log(`[${c.source}] ${c.name} (${c.brandName || 'no brand'}) - score: ${c.score.toFixed(2)}`);
    }

    // Check if any rice candidates are present
    const riceCandidates = candidates.filter(c =>
        c.name.toLowerCase().includes('rice')
    );
    console.log('\n--- RICE CANDIDATES (should NOT be here for ice query) ---');
    console.log(`Found ${riceCandidates.length} rice candidates:`);
    for (const c of riceCandidates) {
        console.log(`[${c.source}] ${c.name} (${c.brandName || 'no brand'}) - score: ${c.score.toFixed(2)}`);
    }
}

async function investigateServingData(foodName: string) {
    console.log(`\n========================================`);
    console.log(`INVESTIGATING SERVINGS: "${foodName}"`);
    console.log(`========================================\n`);

    // Find the food in cache using FatSecretServingCache
    const servings = await prisma.fatSecretServingCache.findMany({
        where: {
            food: {
                name: { contains: foodName, mode: 'insensitive' },
            },
        },
        include: {
            food: {
                select: { id: true, name: true, brandName: true },
            },
        },
        take: 20,
    });

    if (servings.length === 0) {
        console.log(`No cached servings found for "${foodName}"`);
        return;
    }

    // Group by food
    const byFood = new Map<string, typeof servings>();
    for (const s of servings) {
        const key = s.food.id;
        if (!byFood.has(key)) byFood.set(key, []);
        byFood.get(key)!.push(s);
    }

    for (const [foodId, foodServings] of byFood) {
        const food = foodServings[0].food;
        console.log(`\n--- ${food.name} (ID: ${foodId}) ---`);
        console.log(`Brand: ${food.brandName || 'Generic'}`);

        for (const s of foodServings) {
            console.log(`  [${s.id}] "${s.measurementDescription}"`);
            console.log(`      metricAmount=${s.metricServingAmount} ${s.metricServingUnit}`);
            console.log(`      servingWeightGrams=${s.servingWeightGrams}`);
            console.log(`      numberOfUnits=${s.numberOfUnits}`);
            console.log(`      kcal=${s.kcal}, P=${s.protein}, C=${s.carbs}, F=${s.fat}`);

            // Flag suspicious data
            const grams = s.servingWeightGrams ?? s.metricServingAmount ?? 0;
            const desc = (s.measurementDescription || '').toLowerCase();
            if (desc.includes('cup') && grams < 50) {
                console.log(`      ⚠️ SUSPICIOUS: "cup" with only ${grams}g`);
            }
            if (desc.includes('tbsp') && grams < 3) {
                console.log(`      ⚠️ SUSPICIOUS: "tbsp" with only ${grams}g`);
            }
        }
    }
}

async function main() {
    try {
        await investigateIceCandidates();

        await investigateServingData('honey');
        await investigateServingData('mayonnaise');
        await investigateServingData('granulated sugar');

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await prisma.$disconnect();
    }
}

main();
