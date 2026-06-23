#!/usr/bin/env tsx
import 'dotenv/config';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';

async function test() {
    const query = 'lowfat milk';
    console.log(`=== Candidates for "${query}" ===\n`);

    const candidates = await gatherCandidates(query, { rawLine: '1 cup lowfat milk' });
    console.log(`Found ${candidates.length} candidates:\n`);

    for (const c of candidates) {
        console.log(`  ${c.name} (${c.brandName || 'no brand'}) [${c.source}]`);
    }

    console.log('\n=== After Filtering ===\n');
    const { filtered, removedCount } = filterCandidatesByTokens(candidates, query, { debug: true, rawLine: '1 cup lowfat milk' });
    console.log(`Filtered: ${filtered.length}, Removed: ${removedCount}`);

    for (const c of filtered) {
        console.log(`  ✓ ${c.name} (${c.brandName || 'no brand'})`);
    }
}

test().catch(console.error);
