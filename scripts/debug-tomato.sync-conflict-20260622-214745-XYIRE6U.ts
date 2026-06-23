import 'dotenv/config';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';

async function traceTomato() {
    const rawLine = '1 tomato';
    console.log('=== TRACING TOMATO MAPPING ===\n');
    console.log('Input:', rawLine);

    // Parse
    const parsed = parseIngredientLine(rawLine);
    console.log('Parsed:', parsed?.name);

    // Normalize
    const normalized = normalizeIngredientName(parsed?.name || 'tomato');
    console.log('Normalized:', normalized.cleaned);

    // Gather candidates
    console.log('\nGathering candidates...');
    const candidates = await gatherCandidates(rawLine, parsed, normalized.cleaned || 'tomato', {});

    console.log(`\nFound ${candidates.length} candidates:`);
    for (const c of candidates.slice(0, 10)) {
        console.log(`  [${c.id}] ${c.name} (${c.source})`);
    }

    // Filter
    console.log('\nFiltering...');
    const filtered = filterCandidatesByTokens(candidates, normalized.cleaned || 'tomato', { rawLine });

    console.log(`\nAfter filtering: ${filtered.filtered.length} candidates`);
    for (const c of filtered.filtered.slice(0, 5)) {
        console.log(`  [${c.id}] ${c.name} (${c.source})`);
    }

    // Check if winner is FDC
    if (filtered.filtered.length > 0) {
        const winner = filtered.filtered[0];
        console.log(`\nWinner: [${winner.id}] ${winner.name}`);
        console.log(`Source: ${winner.source}`);

        if (winner.id.startsWith('fdc_') || winner.source === 'fdc') {
            console.log('\n⚠️ Winner is from FDC - attempting to use FDC ID with FatSecret API would fail!');
        }
    }
}

traceTomato().catch(console.error);
