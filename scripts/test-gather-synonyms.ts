#!/usr/bin/env tsx
import 'dotenv/config';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';

async function test() {
    const rawLine = '1 cup reduced fat colby and monterey jack cheese';
    const query = 'reduced fat colby and monterey jack cheese';

    // Synonyms returned by AI in previous test
    const aiSynonyms = ['reduced fat colby-jack cheese', 'reduced fat colby jack cheese'];

    console.log(`Testing gatherCandidates for: "${query}"`);
    console.log(`With synonyms:`, aiSynonyms);

    const candidates = await gatherCandidates(query, {
        rawLine,
        aiSynonyms
    });

    console.log(`\nFound ${candidates.length} candidates:\n`);

    for (const c of candidates) {
        console.log(`  [${c.score.toFixed(2)}] ${c.name} (${c.brandName || 'no brand'}) [${c.source}]`);
    }
}

test().catch(console.error);
