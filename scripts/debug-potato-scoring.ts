#!/usr/bin/env ts-node
/**
 * Debug the scoring for potato candidates
 */

import 'dotenv/config';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { prisma } from '../src/lib/db';

// Import the scoring function to test it
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';

const client = new FatSecretClient();

async function main() {
    console.log('\n🔍 Debugging Potato Candidate Scoring\n');

    const rawLine = '4 medium potatoes';
    const parsed = parseIngredientLine(rawLine);
    const normalized = normalizeIngredientName(parsed?.name || rawLine).cleaned || rawLine;

    console.log(`Raw: "${rawLine}"`);
    console.log(`Parsed: "${parsed?.name}"`);
    console.log(`Normalized: "${normalized}"`);

    const candidates = await gatherCandidates(rawLine, parsed, normalized, { client });

    console.log('\n📊 All Candidates BEFORE filtering (sorted by score):');
    const sorted = [...candidates].sort((a, b) => b.score - a.score);

    for (const c of sorted.slice(0, 15)) {
        const nutrition = c.nutrition ? `${c.nutrition.kcal}kcal F:${c.nutrition.fat}g` : 'no nutrition';
        console.log(`   [${c.score.toFixed(3)}] "${c.name}" (${c.source}) - ${nutrition}`);
    }

    // Apply filtering
    const filterResult = filterCandidatesByTokens(candidates, normalized, { debug: false, rawLine });
    console.log(`\n📊 After filtering: ${filterResult.filtered.length}/${candidates.length} remain`);
    console.log(`   Removed: ${filterResult.removedCount}`);

    const sortedFiltered = [...filterResult.filtered].sort((a, b) => b.score - a.score);
    console.log('\n📊 Top 10 Candidates AFTER filtering:');
    for (const c of sortedFiltered.slice(0, 10)) {
        const nutrition = c.nutrition ? `${c.nutrition.kcal}kcal F:${c.nutrition.fat}g` : 'no nutrition';
        console.log(`   [${c.score.toFixed(3)}] "${c.name}" (${c.source}) - ${nutrition}`);
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
