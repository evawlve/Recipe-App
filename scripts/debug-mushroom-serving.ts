import 'dotenv/config';

async function debugMushroomServing() {
    const { mapIngredientWithFallback } = await import('../src/lib/fatsecret/map-ingredient-with-fallback');
    const { gatherCandidates } = await import('../src/lib/fatsecret/gather-candidates');
    const { filterCandidatesByTokens } = await import('../src/lib/fatsecret/filter-candidates');
    const { aiRerankCandidates } = await import('../src/lib/fatsecret/ai-rerank');
    const { parseIngredientLine } = await import('../src/lib/parse/ingredient-line');
    const { normalizeIngredientName } = await import('../src/lib/fatsecret/normalization-rules');
    const { prisma } = await import('../src/lib/db');
    const { FatSecretClient } = await import('../src/lib/fatsecret/client');

    const rawLine = '1 oz sauteed mushrooms';
    console.log('='.repeat(70));
    console.log('Debugging: "' + rawLine + '"');
    console.log('='.repeat(70));

    // Step 1: Parse
    const parsed = parseIngredientLine(rawLine);
    const baseName = parsed?.name?.trim() || rawLine;
    const normalizedName = normalizeIngredientName(baseName).cleaned || baseName;
    console.log('\n📝 Parsed:');
    console.log('  Name:', parsed?.name);
    console.log('  Qty:', parsed?.qty);
    console.log('  Unit:', parsed?.unit);
    console.log('  Normalized:', normalizedName);

    // Step 2: Gather candidates
    const candidates = await gatherCandidates(rawLine, parsed, normalizedName, {});
    console.log('\n📦 Gathered:', candidates.length, 'candidates');

    // Step 3: Filter
    const filtered = filterCandidatesByTokens(candidates, normalizedName, { rawLine });
    console.log('✂️  After filter:', filtered.filtered.length, 'candidates');

    if (filtered.filtered.length === 0) {
        console.log('❌ All candidates filtered out!');
        process.exit(1);
    }

    // Step 4: Show top candidates after filter
    console.log('\nTop 5 candidates after filter:');
    filtered.filtered.slice(0, 5).forEach((c, i) => {
        console.log(`  ${i + 1}. [${c.source}] ${c.name} (score: ${c.score.toFixed(3)}, id: ${c.id})`);
    });

    // Step 5: Check if first candidate has servings in cache
    const top = filtered.filtered[0];
    console.log('\n🔍 Checking servings for top candidate:', top.name, '(id:', top.id + ')');

    const servings = await prisma.fatSecretServingCache.findMany({
        where: { foodId: top.id },
    });

    console.log('Found', servings.length, 'serving(s) in cache:');
    servings.forEach((s, i) => {
        console.log(`  ${i + 1}. "${s.measurementDescription}" - ${s.servingWeightGrams}g (volume: ${s.volumeMl}ml)`);
    });

    // Step 6: Try AI rerank
    console.log('\n🤖 Trying AI rerank...');
    const client = new FatSecretClient();
    const rerankResult = await aiRerankCandidates(filtered.filtered.slice(0, 10), rawLine, normalizedName, client);
    console.log('AI Rerank result:');
    console.log('  Winner ID:', rerankResult.winnerId);
    console.log('  Confidence:', rerankResult.confidence);
    console.log('  Rationale:', rerankResult.rationale);

    // Step 7: Check serving for winner
    if (rerankResult.winnerId) {
        const winnerServings = await prisma.fatSecretServingCache.findMany({
            where: { foodId: rerankResult.winnerId },
        });
        console.log('\n🔍 Servings for AI winner (id:', rerankResult.winnerId + '):');
        console.log('Found', winnerServings.length, 'serving(s)');
        winnerServings.forEach((s, i) => {
            console.log(`  ${i + 1}. "${s.measurementDescription}" - ${s.servingWeightGrams}g (default: ${s.isDefault})`);
        });
    }

    // Step 8: Try full mapping
    console.log('\n📍 Attempting full mapping...');
    try {
        const result = await mapIngredientWithFallback(rawLine, { client, debug: true });
        if (result) {
            console.log('\n✅ SUCCESS!');
            console.log('  Food:', result.foodName);
            console.log('  Serving:', result.servingDescription);
            console.log('  Grams:', result.servingGrams);
        } else {
            console.log('\n❌ FAILED - returned null');
        }
    } catch (err) {
        console.log('\n❌ ERROR:', (err as Error).message);
    }

    process.exit(0);
}

debugMushroomServing().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
