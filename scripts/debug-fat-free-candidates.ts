/**
 * Debug fat-free candidate gathering
 */

import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';
import { FatSecretClient } from '../src/lib/fatsecret/client';

const TEST_CASES = [
    '4 oz fat free cheddar cheese',
    '1 lb cottage cheese low fat',
];

async function main() {
    const client = new FatSecretClient();

    for (const testCase of TEST_CASES) {
        console.log('='.repeat(70));
        console.log(`\n🔍 Query: "${testCase}"\n`);

        const parsed = parseIngredientLine(testCase);
        const baseName = parsed?.name || testCase;
        const normalized = normalizeIngredientName(baseName).cleaned || baseName;

        console.log(`Parsed name: "${baseName}"`);
        console.log(`Normalized: "${normalized}"\n`);

        // Get candidates from all sources
        const candidates = await gatherCandidates(testCase, parsed, normalized, {
            client,
            skipCache: true, // Skip cache to see fresh API results
        });

        console.log(`\n📦 Raw Candidates (${candidates.length} total):`);
        for (let i = 0; i < Math.min(10, candidates.length); i++) {
            const c = candidates[i];
            const nutrition = c.nutrition ? `${c.nutrition.fat}g fat` : 'no nutrition';
            console.log(`  ${i + 1}. [${c.source}] ${c.name} (score: ${c.score.toFixed(2)}) - ${nutrition}`);
        }

        // Filter candidates
        const filterResult = filterCandidatesByTokens(candidates, normalized, {
            debug: true,
            rawLine: testCase
        });

        console.log(`\n🔧 After Filtering (${filterResult.filtered.length} remain, ${filterResult.removedCount} removed):`);
        for (let i = 0; i < Math.min(10, filterResult.filtered.length); i++) {
            const c = filterResult.filtered[i];
            const nutrition = c.nutrition ? `${c.nutrition.fat}g fat` : 'no nutrition';
            console.log(`  ${i + 1}. [${c.source}] ${c.name} (score: ${c.score.toFixed(2)}) - ${nutrition}`);
        }

        console.log();
    }
}

main()
    .catch(console.error)
    .finally(() => process.exit(0));
