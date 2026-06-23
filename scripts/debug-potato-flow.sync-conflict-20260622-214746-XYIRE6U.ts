#!/usr/bin/env ts-node
/**
 * Debug the exact flow of potato mapping to find where FDC fails
 */

import 'dotenv/config';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { prisma } from '../src/lib/db';

// Import the scoring function to test it
import { gatherCandidates, confidenceGate, type UnifiedCandidate } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';

const client = new FatSecretClient();

async function main() {
    console.log('\n🔍 Debugging Full Potato Flow\n');

    const rawLine = '4 medium potatoes';
    const parsed = parseIngredientLine(rawLine);
    const normalizedName = normalizeIngredientName(parsed?.name || rawLine).cleaned || rawLine;

    console.log(`Raw: "${rawLine}"`);
    console.log(`Parsed: qty=${parsed?.qty}, unit=${parsed?.unit}, name="${parsed?.name}"`);
    console.log(`Normalized: "${normalizedName}"`);

    // Step 1: Gather candidates
    const allCandidates = await gatherCandidates(rawLine, parsed, normalizedName, { client });
    console.log(`\n📊 Gathered ${allCandidates.length} candidates`);

    // Step 2: Filter
    const filterResult = filterCandidatesByTokens(allCandidates, normalizedName, { debug: false, rawLine });
    console.log(`📊 After filtering: ${filterResult.filtered.length} remain`);

    // Step 3: Sort with FDC tiebreaker (same logic as map-ingredient-with-fallback.ts)
    const BASIC_PRODUCE = ['potato', 'potatoes', 'lentil', 'lentils', 'beans', 'chickpea', 'chickpeas', 'spinach', 'broccoli', 'carrot', 'carrots'];
    const isBasicProduce = BASIC_PRODUCE.some(p => normalizedName.toLowerCase().includes(p));
    console.log(`\n🥔 Is basic produce: ${isBasicProduce}`);

    const sortedFiltered = [...filterResult.filtered].sort((a, b) => {
        const scoreDiff = b.score - a.score;
        if (Math.abs(scoreDiff) > 0.001) return scoreDiff;

        if (isBasicProduce) {
            const aNameLower = a.name.toLowerCase();
            const bNameLower = b.name.toLowerCase();
            const ingredientLower = normalizedName.toLowerCase();
            const ingredientSingular = ingredientLower.replace(/s$/, '');

            const aIsExactMatch = aNameLower === ingredientLower || aNameLower === ingredientSingular;
            const bIsExactMatch = bNameLower === ingredientLower || bNameLower === ingredientSingular;

            console.log(`  Comparing: "${a.name}" (exact=${aIsExactMatch}, src=${a.source}) vs "${b.name}" (exact=${bIsExactMatch}, src=${b.source})`);

            if (aIsExactMatch && a.source === 'fdc' && (!bIsExactMatch || b.source !== 'fdc')) return -1;
            if (bIsExactMatch && b.source === 'fdc' && (!aIsExactMatch || a.source !== 'fdc')) return 1;
        }
        return 0;
    });

    console.log('\n📊 Sorted candidates (top 10):');
    for (const c of sortedFiltered.slice(0, 10)) {
        const nutrition = c.nutrition ? `${c.nutrition.kcal}kcal F:${c.nutrition.fat}g` : 'NO NUTRITION';
        console.log(`   [${c.score.toFixed(3)}] "${c.name}" (${c.source}) - ${nutrition}`);
    }

    // Step 4: Confidence gate
    const searchQuery = parsed?.name || normalizedName;
    const gateResult = confidenceGate(searchQuery, sortedFiltered);
    console.log('\n🚦 Confidence gate result:');
    console.log(`   skipAiRerank: ${gateResult.skipAiRerank}`);
    console.log(`   reason: ${gateResult.reason}`);
    console.log(`   confidence: ${gateResult.confidence}`);
    if (gateResult.selected) {
        console.log(`   selected: "${gateResult.selected.name}" (${gateResult.selected.source})`);
        console.log(`   selected.nutrition: ${JSON.stringify(gateResult.selected.nutrition)}`);
    }

    // Step 5: Check what buildFdcResult would do
    if (gateResult.selected) {
        const winner = gateResult.selected;
        console.log('\n🔧 Checking buildFdcResult conditions:');
        console.log(`   source: ${winner.source}`);
        console.log(`   id starts with fdc_: ${winner.id.startsWith('fdc_')}`);
        console.log(`   has nutrition: ${!!winner.nutrition}`);

        const isFdcFood = winner.source === 'fdc' || winner.id.startsWith('fdc_');
        console.log(`   isFdcFood: ${isFdcFood}`);

        if (isFdcFood && !winner.nutrition) {
            console.log('\n❌ PROBLEM: FDC candidate has no nutrition - buildFdcResult would return null!');
        } else if (isFdcFood && winner.nutrition) {
            console.log('\n✅ FDC candidate has nutrition - buildFdcResult should succeed');
            console.log(`   Would compute for "${parsed?.unit || 'unknown unit'}": qty=${parsed?.qty}`);
        }
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
