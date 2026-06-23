import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

async function main() {
    const rawLine = '1 banana';

    console.log('\n=== ALL CANDIDATES FOR BANANA ===\n');

    const parsed = parseIngredientLine(rawLine);
    const searchQuery = parsed?.name || rawLine;
    console.log(`Search query: "${searchQuery}"\n`);

    const candidates = await gatherCandidates(rawLine, parsed, searchQuery, {
        skipLiveApi: true,
    });

    console.log(`Total candidates: ${candidates.length}\n`);
    console.log('All candidates:');

    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        console.log(`  ${i + 1}. [${c.source}] "${c.name}"${c.brandName ? ` (${c.brandName})` : ''} - score: ${c.score.toFixed(3)}`);
    }
}

main().finally(() => process.exit(0));
