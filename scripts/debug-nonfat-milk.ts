#!/usr/bin/env tsx
import 'dotenv/config';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';

async function debug(query: string, rawLine: string) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`QUERY: "${query}"`);
    console.log(`RAW LINE: "${rawLine}"`);
    console.log('='.repeat(60));

    const candidates = await gatherCandidates(query, { rawLine });
    console.log(`\nGathered ${candidates.length} candidates:`);

    for (const c of candidates.slice(0, 6)) {
        console.log(`  [${c.score.toFixed(2)}] ${c.name} (${c.brandName || '-'}) [${c.source}]`);
    }

    console.log('\nAfter Filtering:');
    const { filtered, removedCount } = filterCandidatesByTokens(candidates, query, { debug: false, rawLine });
    console.log(`  Kept: ${filtered.length}, Removed: ${removedCount}`);

    if (filtered.length > 0) {
        console.log('\n  Top matches:');
        for (const c of filtered.slice(0, 3)) {
            console.log(`    ✓ ${c.name}`);
        }
    } else {
        console.log('\n  ⚠️ ALL CANDIDATES FILTERED OUT!');
        console.log('    Candidates that were removed:');
        for (const c of candidates.slice(0, 3)) {
            console.log(`    ✗ ${c.name}`);
        }
    }
}

async function main() {
    await debug('nonfat milk', '2 cup nonfat milk');
}

main().catch(console.error);
