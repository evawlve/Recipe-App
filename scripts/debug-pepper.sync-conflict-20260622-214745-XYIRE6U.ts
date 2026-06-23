#!/usr/bin/env tsx
import 'dotenv/config';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';

async function debug() {
    const raw = '0.5 tsp pepper sauce';
    const query = 'pepper sauce';

    console.log(`Debug "${raw}"...`);

    const candidates = await gatherCandidates(query, { rawLine: raw });
    console.log(`Gathered ${candidates.length} candidates:\n`);

    for (const c of candidates) {
        console.log(`  [${c.score.toFixed(2)}] ${c.name} (${c.brandName || '-'})`);
    }

    const { filtered, reason } = filterCandidatesByTokens(candidates, query, { debug: true, rawLine: raw });
    console.log(`\nFiltered: ${filtered.length}, Reason: ${reason}`);

    // If all removed, print candidates again to see if we can guess why
    if (filtered.length === 0) {
        console.log("All filtered. Checking manual modifier detection:");
        // Call internal functions if exported, or just guess
    }
}

debug().catch(console.error);
