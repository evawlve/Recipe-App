/**
 * Debug script to trace why "tomato sauce" finds no candidates
 */
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';
import { gatherCandidates, type GatherOptions } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens, deriveMustHaveTokens } from '../src/lib/fatsecret/filter-candidates';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { searchFatSecretCacheFoods } from '../src/lib/fatsecret/cache-search';

async function debugTomatoSauce() {
    const client = new FatSecretClient();

    const testCases = [
        'Tomato Sauce',
        '10 oz tomato sauce',
    ];

    for (const rawLine of testCases) {
        console.log('\n' + '='.repeat(60));
        console.log(`DEBUGGING: "${rawLine}"`);
        console.log('='.repeat(60));

        // Step 1: Parse
        const parsed = parseIngredientLine(rawLine);
        console.log('\n1. PARSED:', JSON.stringify(parsed, null, 2));

        // Step 2: Normalize
        const normalized = normalizeIngredientName(parsed?.name || rawLine);
        console.log('\n2. NORMALIZED:', normalized);

        // Step 3: Check must-have tokens
        const mustHaveTokens = deriveMustHaveTokens(normalized.cleaned);
        console.log('\n3. MUST-HAVE TOKENS:', mustHaveTokens);

        // Step 4: Search cache directly
        console.log('\n4. CACHE SEARCH for "tomato sauce":');
        const cacheResults = await searchFatSecretCacheFoods('tomato sauce', 10);
        console.log(`   Found ${cacheResults.length} results:`);
        cacheResults.slice(0, 5).forEach((r, i) => {
            console.log(`   ${i + 1}. ${r.name} (${r.brandName || 'generic'}) - ID: ${r.id}`);
        });

        // Step 5: Search live API
        console.log('\n5. LIVE API SEARCH for "tomato sauce":');
        try {
            const liveResults = await client.searchFoodsV4('tomato sauce', { maxResults: 10 });
            console.log(`   Found ${liveResults.length} results:`);
            liveResults.slice(0, 5).forEach((r, i) => {
                console.log(`   ${i + 1}. ${r.name} (${r.brandName || 'generic'}) - ID: ${r.id}`);
            });
        } catch (err) {
            console.log(`   ERROR: ${(err as Error).message}`);
        }

        // Step 6: Gather candidates
        console.log('\n6. GATHER CANDIDATES:');
        const gatherOptions: GatherOptions = {
            client,
            skipCache: false,
            skipLiveApi: false,
            skipFdc: false,
        };
        const candidates = await gatherCandidates(rawLine, parsed, normalized.cleaned, gatherOptions);
        console.log(`   Gathered ${candidates.length} candidates`);
        candidates.slice(0, 5).forEach((c, i) => {
            console.log(`   ${i + 1}. ${c.name} (${c.source}) - Score: ${c.score.toFixed(3)}`);
        });

        // Step 7: Filter candidates
        if (candidates.length > 0) {
            console.log('\n7. FILTER CANDIDATES:');
            const filterResult = filterCandidatesByTokens(candidates, normalized.cleaned, {
                debug: true,
                rawLine
            });
            console.log(`   Filtered from ${candidates.length} to ${filterResult.filtered.length}`);
            console.log(`   Removed: ${filterResult.removedCount}, Reason: ${filterResult.reason || 'none'}`);
        }
    }

    console.log('\n\nDEBUG COMPLETE');
}

debugTomatoSauce().catch(console.error);
