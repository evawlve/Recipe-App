#!/usr/bin/env ts-node
/**
 * Trace exactly where "light sour cream" gets rejected in the pipeline.
 * Run ONLY the gathering + filtering stages with verbose output.
 */

import 'dotenv/config';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { isCategoryMismatch, isWrongCookingStateForGrain, isFoodTypeMismatch } from '../src/lib/fatsecret/filter-candidates';
import { prisma } from '../src/lib/db';

const TEST_QUERIES = [
    'light sour cream',
    'low fat cheddar cheese',
    'low fat monterey jack cheese',
    'light butter',
    'light cream',
];

async function traceQuery(rawQuery: string) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🎯 RAW QUERY: "${rawQuery}"`);

    // Step 1: Normalization
    const norm = normalizeIngredientName(rawQuery);
    console.log(`\n  📝 Normalized:`);
    console.log(`     cleaned:  "${norm.cleaned}"`);
    console.log(`     nounOnly: "${norm.nounOnly}"`);
    console.log(`     stripped: [${norm.stripped.join(', ')}]`);

    // Step 2: Gather candidates
    console.log(`\n  📦 Gathering candidates...`);
    try {
        const candidates = await gatherCandidates(norm.cleaned, { debug: true, rawLine: rawQuery });
        console.log(`     Total candidates: ${candidates.length}`);

        if (candidates.length === 0) {
            console.log(`     ❌ ZERO CANDIDATES from gatherCandidates! — this is the failure point`);
            
            // Try with nounOnly as fallback
            console.log(`\n  📦 Retrying with nounOnly: "${norm.nounOnly}"...`);
            const fallbackCandidates = await gatherCandidates(norm.nounOnly, { debug: true, rawLine: rawQuery });
            console.log(`     Fallback candidates: ${fallbackCandidates.length}`);
            
            if (fallbackCandidates.length > 0) {
                console.log(`     First 5 fallback candidates:`);
                for (const c of fallbackCandidates.slice(0, 5)) {
                    console.log(`       - ${c.name}${c.brandName ? ` (${c.brandName})` : ''} [${c.source}]`);
                }
            }
            return;
        }

        // Show first 5 candidates
        console.log(`     First 5 candidates:`);
        for (const c of candidates.slice(0, 5)) {
            console.log(`       - ${c.name}${c.brandName ? ` (${c.brandName})` : ''} [${c.source}]`);
        }

        // Step 3: Check category exclusions on each candidate
        console.log(`\n  🔍 Category mismatch checks:`);
        for (const c of candidates.slice(0, 8)) {
            const catMismatch = isCategoryMismatch(norm.cleaned, c.name, c.brandName);
            const cookMismatch = isWrongCookingStateForGrain(rawQuery, norm.cleaned, c.name);
            const typeMismatch = isFoodTypeMismatch(norm.cleaned, c.name, c.brandName);
            const flag = catMismatch ? '❌ CAT' : cookMismatch ? '❌ COOK' : typeMismatch ? '❌ TYPE' : '✅ OK';
            console.log(`       ${flag} | ${c.name}${c.brandName ? ` (${c.brandName})` : ''}`);
        }
    } catch (err) {
        console.log(`     Error: ${(err as Error).message}`);
    }
}

async function main() {
    console.log('\n🔍 Pipeline Rejection Point Trace\n');

    for (const query of TEST_QUERIES) {
        await traceQuery(query);
    }

    console.log('\n✅ Trace complete!\n');
}

main()
    .catch((error) => {
        console.error('Error:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
