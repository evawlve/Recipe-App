#!/usr/bin/env tsx
import 'dotenv/config';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';

async function test() {
    console.log('=== Checking candidates for "onion" ===\n');

    const result = await gatherCandidates('onion', { rawLine: '1 onion' });

    console.log(`Found candidates:`, result ? 'yes' : 'no');
    console.log('  All candidates:', result.all?.length || 0);
    console.log('  Filtered candidates:', result.filtered?.length || 0);

    const candidates = result.filtered || result.all || [];

    console.log(`\nTop 10 candidates:\n`);

    for (const c of candidates.slice(0, 10)) {
        console.log(`Name: "${c.name}"`);
        console.log(`  Brand: ${c.brandName || 'null'}`);
        console.log(`  Source: ${c.source}`);
        console.log(`  Score: ${c.score}`);
        console.log('');
    }
}

test().catch(console.error);
