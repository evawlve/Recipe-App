import 'dotenv/config';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';

async function debugFilterIssue() {
    // Test cases
    const testCases = [
        '1 oz vegetable fat spread reduced calorie',
        '4 oz mange tout snap peas',
        '1 oz sauteed mushrooms',
    ];

    for (const rawLine of testCases) {
        console.log('\n' + '='.repeat(70));
        console.log('RAW:', rawLine);
        console.log('='.repeat(70));

        const parsed = parseIngredientLine(rawLine);
        const baseName = parsed?.name?.trim() || rawLine;
        const normalizedName = normalizeIngredientName(baseName).cleaned || baseName;

        console.log('Parsed name:', parsed?.name);
        console.log('Normalized:', normalizedName);

        const candidates = await gatherCandidates(rawLine, parsed, normalizedName, {});
        console.log('\n📦 Gathered:', candidates.length, 'candidates');
        console.log('Top 5 before filter:');
        candidates.slice(0, 5).forEach((c, i) => {
            console.log(`  ${i + 1}. [${c.source}] ${c.name} (score: ${c.score.toFixed(3)})`);
        });

        const result = filterCandidatesByTokens(candidates, normalizedName, { debug: true, rawLine });
        console.log('\n✂️  After filter:', result.filtered.length, 'candidates (removed:', result.removedCount + ')');

        if (result.filtered.length > 0) {
            console.log('Top 3 after filter:');
            result.filtered.slice(0, 3).forEach((c, i) => {
                console.log(`  ${i + 1}. [${c.source}] ${c.name} (score: ${c.score.toFixed(3)})`);
            });
        } else {
            console.log('❌ ALL CANDIDATES FILTERED OUT!');
            console.log('\nLikely reason: must-have tokens derived from normalized name');
            const tokens = normalizedName.toLowerCase().split(/[^a-z]+/).filter(t => t.length > 2);
            console.log('Derived tokens:', tokens);
        }

        await new Promise(r => setTimeout(r, 300));
    }

    process.exit(0);
}

debugFilterIssue().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
