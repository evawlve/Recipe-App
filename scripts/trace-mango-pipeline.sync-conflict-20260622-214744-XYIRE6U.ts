/**
 * Trace full mango mapping pipeline
 */
import 'dotenv/config';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';
import { simpleRerank, toRerankCandidate } from '../src/lib/fatsecret/simple-rerank';

async function main() {
    const rawLine = '1 mango';

    console.log('\n=== TRACING MANGO PIPELINE ===\n');

    // Step 1: Parse
    const parsed = parseIngredientLine(rawLine);
    console.log('1. Parsed:', { qty: parsed?.qty, unit: parsed?.unit, name: parsed?.name });

    // Step 2: Normalize
    const baseName = parsed?.name?.trim() || rawLine;
    const normalizedName = normalizeIngredientName(baseName).cleaned || baseName;
    console.log('2. Normalized:', normalizedName);

    // Step 3: Gather candidates
    const candidates = await gatherCandidates(rawLine, parsed, normalizedName, {});
    console.log(`\n3. Gathered ${candidates.length} candidates:`);
    for (const c of candidates.slice(0, 6)) {
        console.log(`   [${c.score.toFixed(3)}] ${c.name}${c.brandName ? ` (${c.brandName})` : ''} [${c.source}]`);
    }

    // Step 4: Filter
    const filterResult = filterCandidatesByTokens(candidates, normalizedName, { debug: true, rawLine });
    console.log(`\n4. After filtering: ${filterResult.filtered.length}/${candidates.length}`);
    for (const c of filterResult.filtered.slice(0, 6)) {
        console.log(`   [${c.score.toFixed(3)}] ${c.name}${c.brandName ? ` (${c.brandName})` : ''} [${c.source}]`);
    }

    // Step 5: Rerank
    const searchQuery = parsed?.name || normalizedName;
    const sortedFiltered = [...filterResult.filtered].sort((a, b) => b.score - a.score);
    const rerankCandidates = sortedFiltered.slice(0, 10).map(c => toRerankCandidate({
        id: c.id,
        name: c.name,
        brandName: c.brandName,
        foodType: c.foodType,
        score: c.score,
        source: c.source,
    }));

    const rerankResult = simpleRerank(searchQuery, rerankCandidates);
    console.log(`\n5. Rerank winner:`);
    console.log(`   ${rerankResult?.winner.name} (conf: ${rerankResult?.confidence.toFixed(3)}, reason: ${rerankResult?.reason})`);
}

main().finally(() => process.exit(0));
