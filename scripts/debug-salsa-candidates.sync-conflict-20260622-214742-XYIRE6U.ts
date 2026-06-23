#!/usr/bin/env npx tsx

import 'dotenv/config';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

async function main() {
    const rawLine = '2 tbsp tomato salsa';
    const parsed = parseIngredientLine(rawLine);
    const normalizedName = parsed?.name || 'tomato salsa';

    console.log('=== STEP 1: GATHER CANDIDATES ===');
    const candidates = await gatherCandidates(rawLine, parsed, normalizedName, {});

    console.log('\nAll gathered candidates (sorted by score):');
    const sorted = [...candidates].sort((a, b) => b.score - a.score);
    sorted.slice(0, 10).forEach((c, i) => {
        console.log(`${i + 1}. [${c.source}] [score=${c.score.toFixed(3)}] ${c.name}`);
    });

    console.log('\n=== STEP 2: FILTER CANDIDATES ===');
    const filterResult = filterCandidatesByTokens(candidates, normalizedName, { debug: true, rawLine });

    console.log('\nFiltered candidates:');
    filterResult.filtered.slice(0, 10).forEach((c, i) => {
        console.log(`${i + 1}. [${c.source}] [score=${c.score.toFixed(3)}] ${c.name}`);
    });
    console.log(`Removed: ${filterResult.removedCount}`);

    // Check if "salsa" candidates exist
    const salsaCandidates = candidates.filter(c => c.name.toLowerCase().includes('salsa'));
    console.log('\n=== SALSA CANDIDATES ===');
    salsaCandidates.forEach((c, i) => {
        console.log(`${i + 1}. [${c.source}] [score=${c.score.toFixed(3)}] ${c.name}`);
    });

    // Check if "roma tomato" exists
    const romaCandidates = candidates.filter(c => c.name.toLowerCase().includes('roma'));
    console.log('\n=== ROMA CANDIDATES ===');
    romaCandidates.forEach((c, i) => {
        console.log(`${i + 1}. [${c.source}] [score=${c.score.toFixed(3)}] ${c.name}`);
    });
}

main().catch(console.error);
