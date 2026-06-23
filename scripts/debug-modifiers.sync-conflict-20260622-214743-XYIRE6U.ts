#!/usr/bin/env tsx
import 'dotenv/config';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';

async function debug(query: string, rawLine: string) {
    console.log(`\n=== Debugging: "${rawLine}" ===\n`);

    const candidates = await gatherCandidates(query, { rawLine });
    console.log(`Gathered ${candidates.length} candidates:\n`);

    for (const c of candidates.slice(0, 6)) {
        console.log(`  [${c.score.toFixed(2)}] ${c.name} (${c.brandName || 'no brand'}) [${c.source}]`);
    }

    console.log('\n--- After Filtering ---\n');
    const { filtered, removedCount } = filterCandidatesByTokens(candidates, query, { debug: true, rawLine });
    console.log(`Kept: ${filtered.length}, Removed: ${removedCount}`);

    for (const c of filtered.slice(0, 3)) {
        console.log(`  ✓ ${c.name} (${c.brandName || 'no brand'})`);
    }

    if (filtered.length === 0) {
        console.log('  ⚠️ ALL CANDIDATES FILTERED!');
    }
}

async function main() {
    await debug('nonfat milk', '2 cup nonfat milk');
    await debug('fat free pudding', '1 oz fat free pudding');
    await debug('reduced fat Mexican cheese', '1 cup reduced fat Mexican cheese');
}

main().catch(console.error);
