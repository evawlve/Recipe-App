import 'dotenv/config';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

async function debugIcingSugarFilter() {
    const rawLine = '2 tbsp icing sugar';
    const parsed = parseIngredientLine(rawLine);
    const normalizedName = 'icing sugar';

    console.log('\n🔍 Testing full pipeline for:', rawLine);
    console.log('Normalized:', normalizedName);

    // Step 1: Gather candidates
    const candidates = await gatherCandidates(rawLine, parsed, normalizedName, {});
    console.log('\n📦 Gathered', candidates.length, 'candidates');

    // Show top candidates before filter
    console.log('\nTop 10 before filtering:');
    candidates.slice(0, 10).forEach((c, i) => {
        console.log(`  ${i + 1}. [${c.source}] ${c.name} (score: ${c.score.toFixed(3)})`);
    });

    // Step 2: Filter candidates
    const filtered = filterCandidatesByTokens(candidates, normalizedName, { debug: true, rawLine });

    console.log('\n📦 After filtering:', filtered.length, 'candidates');
    console.log('\nTop 10 after filtering:');
    filtered.slice(0, 10).forEach((c, i) => {
        console.log(`  ${i + 1}. [${c.source}] ${c.name} (score: ${c.score.toFixed(3)})`);
    });

    // Check if any powdered sugar made it through
    const hasPowderedSugar = filtered.some(c =>
        c.name.toLowerCase().includes('powdered') && c.name.toLowerCase().includes('sugar')
    );
    console.log('\n✓ Has powdered sugar after filter:', hasPowderedSugar);

    process.exit(0);
}

debugIcingSugarFilter().catch(e => { console.error(e); process.exit(1); });
