import 'dotenv/config';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';

async function debugCandidates() {
    const rawLine = 'fat free cheddar cheese';
    console.log(`\n=== Debugging candidates for: "${rawLine}" ===\n`);

    const parsed = parseIngredientLine(rawLine);
    const normResult = normalizeIngredientName(parsed?.name || rawLine);
    const normalized = typeof normResult === 'string' ? normResult : normResult.cleaned;

    console.log('Parsed name:', parsed?.name);
    console.log('Normalized:', normalized);

    const candidates = await gatherCandidates(rawLine, parsed, normalized);

    // Group by source
    const fdcCandidates = candidates.filter(c => c.source === 'fdc');
    const cacheCandidates = candidates.filter(c => c.source === 'cache');
    const liveCandidates = candidates.filter(c => c.source === 'fatsecret');

    console.log(`\nTotal: ${candidates.length} (FDC: ${fdcCandidates.length}, Cache: ${cacheCandidates.length}, Live: ${liveCandidates.length})`);

    // Show FDC candidates with "nonfat" or "fat free"
    console.log('\n--- FDC candidates with nonfat/fat-free ---');
    const fatFreeFdc = fdcCandidates.filter(c =>
        c.name.toLowerCase().includes('nonfat') ||
        c.name.toLowerCase().includes('fat free')
    );
    if (fatFreeFdc.length === 0) {
        console.log('  NONE FOUND! ❌');
    } else {
        fatFreeFdc.forEach((c, i) => {
            console.log(`  ✅ ${i + 1}. [${c.score.toFixed(3)}] ${c.name} (${c.foodType})`);
        });
    }

    // Show top 10 overall
    console.log('\n--- Top 10 overall (sorted by score) ---');
    const sorted = [...candidates].sort((a, b) => b.score - a.score);
    sorted.slice(0, 10).forEach((c, i) => {
        const source = c.source === 'fdc' ? '[FDC]' : c.source === 'cache' ? '[CACHE]' : '[LIVE]';
        const marker = c.name.toLowerCase().includes('nonfat') || c.name.toLowerCase().includes('fat free') ? '✅' : '  ';
        console.log(`  ${marker} ${i + 1}. [${c.score.toFixed(3)}] ${c.name} ${source}`);
    });
}

debugCandidates()
    .catch(console.error)
    .finally(() => process.exit(0));
