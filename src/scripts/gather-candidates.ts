/**
 * Gather and score mapping candidates for an ingredient.
 * Shows exactly what the pipeline sees before filtering/ranking.
 *
 * Usage:
 *   npx tsx src/scripts/gather-candidates.ts "crushed ice"
 *   npx tsx src/scripts/gather-candidates.ts "rice vinegar" --skip-fdc --limit 20
 *   npx tsx src/scripts/gather-candidates.ts "fat free cream cheese" --show-filtered
 */
import 'dotenv/config';
process.env.LOG_LEVEL = 'error';

async function main() {
    const args = process.argv.slice(2);
    const query = args.find(a => !a.startsWith('--'));
    if (!query) {
        console.error('Usage: npx tsx src/scripts/gather-candidates.ts "<ingredient>" [--skip-fdc] [--limit N] [--show-filtered]');
        process.exit(1);
    }

    const skipFdc = args.includes('--skip-fdc');
    const showFiltered = args.includes('--show-filtered');
    const limitArg = args.indexOf('--limit');
    const limit = limitArg !== -1 ? parseInt(args[limitArg + 1] ?? '15') : 15;

    const { gatherCandidates } = await import('../lib/fatsecret/gather-candidates');
    const { filterCandidatesByTokens } = await import('../lib/fatsecret/filter-candidates');
    const { simpleRerank } = await import('../lib/fatsecret/simple-rerank');
    const { parseIngredientLine } = await import('../lib/parse/ingredient-line');
    const { normalizeIngredientName } = await import('../lib/fatsecret/normalization-rules');

    const parsed = parseIngredientLine(query);
    const baseName = parsed?.name?.trim() || query;
    const normalizedName = normalizeIngredientName(baseName).cleaned || baseName;

    console.log(`\n${'='.repeat(70)}`);
    console.log(`CANDIDATES FOR: "${query}"`);
    console.log(`  parsed name: "${baseName}"  normalized: "${normalizedName}"`);
    console.log('='.repeat(70));

    const candidates = await gatherCandidates(query, parsed, normalizedName, {
        skipFdc,
        skipCache: false,
        skipLiveApi: false,
    });

    console.log(`\n📋 RAW CANDIDATES (${candidates.length} total):\n`);
    candidates.slice(0, limit).forEach((c, i) => {
        const nutr = c.nutrition ? ` [${c.nutrition.kcal.toFixed(0)}kcal/100g]` : '';
        console.log(`  ${(i + 1).toString().padStart(2)}. [${c.source.padEnd(10)}] score=${c.score.toFixed(3)}  "${c.name}"${c.brandName ? ` (${c.brandName})` : ''}${nutr}`);
    });

    // Apply token filter
    const filterResult = filterCandidatesByTokens(candidates, normalizedName, {});
    const filtered = filterResult.filtered;
    const removedCount = filterResult.removedCount;

    console.log(`\n🔎 AFTER TOKEN FILTER: ${filtered.length} remain (${removedCount} removed)\n`);
    filtered.slice(0, limit).forEach((c, i) => {
        const nutr = c.nutrition ? ` [${c.nutrition.kcal.toFixed(0)}kcal/100g]` : '';
        console.log(`  ${(i + 1).toString().padStart(2)}. [${c.source.padEnd(10)}] score=${c.score.toFixed(3)}  "${c.name}"${c.brandName ? ` (${c.brandName})` : ''}${nutr}`);
    });

    // Run reranker on filtered candidates
    if (filtered.length > 0) {
        const rerankResult = simpleRerank(normalizedName, filtered as any);

        if (rerankResult) {
            console.log(`\n🏆 RERANK WINNER:\n`);
            const w = rerankResult.winner;
            const nutr = w.nutrition ? ` [${w.nutrition.kcal.toFixed(0)}kcal/100g]` : '';
            console.log(`  "${w.name}"${w.brandName ? ` (${w.brandName})` : ''}  [${w.source}]  score=${w.score.toFixed(3)}${nutr}`);
            console.log(`  Confidence: ${rerankResult.confidence.toFixed(3)}  |  Reason: ${rerankResult.reason}`);
        }
    }

    if (showFiltered && removedCount > 0) {
        const removed = candidates.filter(c => !filtered.includes(c));
        console.log(`\n🗑️  FILTERED OUT (${removed.length}):\n`);
        removed.slice(0, limit).forEach((c, i) => {
            console.log(`  ${(i + 1).toString().padStart(2)}. [${c.source}] score=${c.score.toFixed(3)}  "${c.name}"${c.brandName ? ` (${c.brandName})` : ''}`);
        });
    }

    const { prisma } = await import('../lib/db');
    await prisma.$disconnect();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
