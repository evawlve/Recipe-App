import 'dotenv/config';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';

async function debugFdcScoring() {
    const query = 'fat free cheddar cheese';
    console.log(`\n=== Debugging FDC scoring for: "${query}" ===\n`);

    const parsed = parseIngredientLine(query);
    const normResult = normalizeIngredientName(parsed?.name || query);
    const normalized = typeof normResult === 'string' ? normResult : normResult.cleaned;
    console.log('Parsed name:', parsed?.name);
    console.log('Normalized:', normalized);

    const candidates = await gatherCandidates(query, parsed, normalized);

    // Separate by source
    const fdcCandidates = candidates.filter(c => c.source === 'fdc');
    const cacheCandidates = candidates.filter(c => c.source === 'cache');
    const liveCandidates = candidates.filter(c => c.source === 'fatsecret');

    console.log(`\nCandidate counts: FDC=${fdcCandidates.length}, Cache=${cacheCandidates.length}, Live=${liveCandidates.length}`);

    // Show FDC candidates sorted by score
    console.log('\n--- FDC Candidates (sorted by score) ---');
    fdcCandidates
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .forEach((c, i) => {
            console.log(`  ${i + 1}. [${c.score.toFixed(3)}] ${c.name} (${c.foodType})`);
        });

    // Show top 10 across ALL sources
    console.log('\n--- Top 10 Overall (what AI sees) ---');
    candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .forEach((c, i) => {
            const source = c.source === 'fdc' ? '[FDC]' : c.source === 'cache' ? '[CACHE]' : '[LIVE]';
            console.log(`  ${i + 1}. [${c.score.toFixed(3)}] ${c.name} ${source}`);
        });
}

debugFdcScoring()
    .catch(console.error)
    .finally(() => process.exit(0));
