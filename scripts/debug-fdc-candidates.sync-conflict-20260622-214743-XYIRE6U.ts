import 'dotenv/config';
import { fdcApi } from '../src/lib/usda/fdc-api';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';

async function debugFdcCandidates() {
    const queries = [
        'cherry tomatoes',
        'fat free cheddar cheese',
    ];

    for (const query of queries) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Testing: "${query}"`);
        console.log('='.repeat(60));

        // Direct FDC search
        console.log('\n--- Direct FDC API Results ---');
        try {
            const fdcResults = await fdcApi.searchFoods({ query, pageSize: 5 });
            if (fdcResults?.foods?.length) {
                fdcResults.foods.forEach((f, i) => {
                    console.log(`  ${i + 1}. [${f.fdcId}] ${f.description} (${f.dataType})`);
                });
            } else {
                console.log('  No FDC results found');
            }
        } catch (e) {
            console.log('  FDC search error:', (e as Error).message);
        }

        // Full candidate gathering (cache + live + fdc)
        console.log('\n--- All Candidates (sorted by score) ---');
        const parsed = parseIngredientLine(query);
        const normalized = normalizeIngredientName(parsed?.name || query);
        const candidates = await gatherCandidates(query, parsed, normalized);

        // Sort by score and show top 10
        candidates.sort((a, b) => b.score - a.score);
        candidates.slice(0, 15).forEach((c, i) => {
            const source = c.source === 'fdc' ? ' [FDC]' : c.source === 'cache' ? ' [CACHE]' : ' [LIVE]';
            console.log(`  ${i + 1}. [${c.score.toFixed(3)}] ${c.name}${source}`);
        });

        // Count by source
        const fdcCount = candidates.filter(c => c.source === 'fdc').length;
        const cacheCount = candidates.filter(c => c.source === 'cache').length;
        const liveCount = candidates.filter(c => c.source === 'fatsecret').length;
        console.log(`\n  Sources: FDC=${fdcCount}, Cache=${cacheCount}, Live=${liveCount}`);
    }
}

debugFdcCandidates()
    .catch(console.error)
    .finally(() => process.exit(0));
