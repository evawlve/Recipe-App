#!/usr/bin/env ts-node
/**
 * Debug why potato candidates are being filtered out
 */

import 'dotenv/config';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { prisma } from '../src/lib/db';

import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';

const client = new FatSecretClient();

async function main() {
    console.log('\n🔍 Debugging Full Potato Mapping Flow\n');

    const rawLine = '4 medium potatoes';
    const parsed = parseIngredientLine(rawLine);
    const normalized = normalizeIngredientName(parsed?.name || rawLine).cleaned || rawLine;

    console.log(`Raw: "${rawLine}"`);
    console.log(`Parsed: "${parsed?.name}"`);
    console.log(`Normalized: "${normalized}"`);

    console.log('\n--- Testing mapIngredientWithFallback ---');
    const result = await mapIngredientWithFallback(rawLine, { debug: false, skipFdc: false });

    if (result) {
        console.log('📝 Parsed:', parsed?.qty, parsed?.unit, parsed?.name);
        console.log('📏 Serving:', result.servingDescription, `(${result.grams}g)`);
        console.log('  Confidence:', result.confidence.toFixed(3));
        console.log(`✅ Result: SUCCESS`);
        console.log(`  Source: ${result.source}`);
        console.log(`  Food: ${result.foodName} (id: ${result.foodId})`);
        console.log(`  Nutrients (per ${result.grams}g): ${result.kcal.toFixed(2)}kcal | P:${result.protein}g C:${result.carbs}g F:${result.fat}g`);
    } else {
        console.log('❌ Result: FAILED (null)');
    }

    console.log('\n✅ Done');
}

main()
    .catch((error) => {
        console.error('Error:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
