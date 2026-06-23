#!/usr/bin/env tsx
import 'dotenv/config';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';
import { aiNormalizeIngredient } from '../src/lib/fatsecret/ai-normalize';
import fs from 'fs';

const items = [
    { raw: "1 oz fat free pudding", query: "fat free pudding" },
    { raw: "1 container low fat yogurt", query: "low fat yogurt" },
    { raw: "2 lbs extra lean ground beef", query: "extra lean ground beef" }
];

async function debug() {
    let output = '=== Debugging Remaining Failures ===\n\n';

    for (const item of items) {
        output += `${'-'.repeat(40)}\n`;
        output += `Testing: "${item.raw}"\n`;

        // 1. Check AI Normalization
        output += '1. AI Normalization:\n';
        const aiRes = await aiNormalizeIngredient(item.raw);
        let searchName = item.query;
        if (aiRes.status === 'success') {
            output += `   Normalized: "${aiRes.normalizedName}"\n`;
            output += `   Synonyms: ${JSON.stringify(aiRes.synonyms)}\n`;
            searchName = aiRes.normalizedName;
        } else {
            output += `   AI Error: ${aiRes.reason}\n`;
        }

        // 2. Gather Candidates
        output += `\n2. Gather Candidates for "${searchName}":\n`;
        const candidates = await gatherCandidates(searchName, { rawLine: item.raw });
        output += `   Found ${candidates.length} candidates.\n`;
        for (const c of candidates.slice(0, 5)) {
            output += `   - [${c.score.toFixed(2)}] ${c.name} (${c.brandName || '-'}) [${c.source}]\n`;
        }

        // 3. Filter Candidates
        output += '\n3. Filter Candidates:\n';
        const { filtered, reason } = filterCandidatesByTokens(candidates, searchName, { debug: true, rawLine: item.raw });

        output += `   Kept: ${filtered.length}, Reason: ${reason}\n`;
        for (const c of filtered) {
            output += `   ✓ ${c.name}\n`;
        }
        output += '\n';
    }

    fs.writeFileSync('debug_output.txt', output);
    console.log('Done, wrote to debug_output.txt');
}

debug().catch(console.error);
