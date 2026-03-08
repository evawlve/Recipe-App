/**
 * Debug script to trace garlic candidate scoring
 */
import { gatherCandidates, type UnifiedCandidate } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';
import { simpleRerank, toRerankCandidate } from '../src/lib/fatsecret/simple-rerank';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';

async function main() {
    console.log('\n=== Garlic Candidate Analysis ===\n');

    const rawLine = '5 garlic';
    const parsed = parseIngredientLine(rawLine);
    const baseName = parsed?.name || rawLine;
    const normalizedName = normalizeIngredientName(baseName).cleaned || baseName;

    console.log('Query:', normalizedName);

    // Gather candidates
    const allCandidates = await gatherCandidates(rawLine, parsed, normalizedName, {});
    console.log(`\nGathered ${allCandidates.length} candidates`);

    // Show top 5 candidates before filtering
    console.log('\nTop 5 candidates (before filtering):');
    for (const c of allCandidates.slice(0, 5)) {
        console.log(`  - [${c.source}] ${c.name} | brand: "${c.brandName || '(none)'}" | score: ${c.score.toFixed(3)}`);
    }

    // Filter
    const { filtered } = filterCandidatesByTokens(allCandidates, normalizedName, { debug: true });
    console.log(`\nFiltered to ${filtered.length} candidates`);

    // Rerank
    const rerankCandidates = filtered.map(toRerankCandidate);
    const result = simpleRerank(normalizedName, rerankCandidates);

    if (result) {
        console.log('\n=== WINNER ===');
        console.log(`  Food: ${result.winner.name}`);
        console.log(`  Brand: ${result.winner.brandName || '(none)'}`);
        console.log(`  Source: ${result.winner.source}`);
        console.log(`  Confidence: ${result.confidence.toFixed(3)}`);
        console.log(`  Reason: ${result.reason}`);
    }

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
