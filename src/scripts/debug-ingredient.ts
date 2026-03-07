/**
 * Debug a single ingredient through the full mapping pipeline.
 *
 * Usage:
 *   npx tsx src/scripts/debug-ingredient.ts "1 cup chopped onion"
 *   npx tsx src/scripts/debug-ingredient.ts "1 tbsp soy sauce" --skip-fdc
 *   npx tsx src/scripts/debug-ingredient.ts "2 oz chicken breast" --skip-cache
 */
import 'dotenv/config';
process.env.LOG_LEVEL = 'warn';
process.env.ENABLE_MAPPING_ANALYSIS = 'true';

async function main() {
    const args = process.argv.slice(2);
    const rawLine = args.find(a => !a.startsWith('--'));
    if (!rawLine) {
        console.error('Usage: npx tsx src/scripts/debug-ingredient.ts "<ingredient line>" [--skip-fdc] [--skip-cache]');
        process.exit(1);
    }

    const skipFdc = args.includes('--skip-fdc');
    const skipCache = args.includes('--skip-cache');
    const verbose = args.includes('--verbose');

    if (verbose) process.env.LOG_LEVEL = 'debug';

    const { mapIngredientWithFallback } = await import('../lib/fatsecret/map-ingredient-with-fallback');
    const { parseIngredientLine } = await import('../lib/parse/ingredient-line');
    const { normalizeIngredientName } = await import('../lib/fatsecret/normalization-rules');

    console.log('\n' + '='.repeat(70));
    console.log(`INGREDIENT: "${rawLine}"`);
    console.log('='.repeat(70));

    // Step 1: Parse
    const parsed = parseIngredientLine(rawLine);
    console.log('\n📝 PARSE:');
    console.log(`   qty=${parsed?.qty ?? '?'}  multiplier=${parsed?.multiplier ?? 1}  unit="${parsed?.unit ?? '?'}"  name="${parsed?.name ?? '?'}"`);

    // Step 2: Normalize
    const baseName = parsed?.name?.trim() || rawLine;
    const normalized = normalizeIngredientName(baseName);
    console.log('\n🔤 NORMALIZE:');
    console.log(`   cleaned="${normalized.cleaned}"  nounOnly="${normalized.nounOnly}"`);

    // Step 3: Full pipeline
    console.log('\n🔍 MAPPING...\n');
    const result = await mapIngredientWithFallback(rawLine, {
        minConfidence: 0,
        skipFdc,
        skipCache,
        debug: true,
    });

    console.log('\n' + '='.repeat(70));
    console.log('✅ RESULT:');
    console.log('='.repeat(70));

    if (!result) {
        console.log('  ❌ No result — mapping failed completely');
    } else if ('status' in result && result.status === 'pending') {
        console.log('  ⏳ PENDING (lock held)');
    } else {
        const r = result as Awaited<ReturnType<typeof mapIngredientWithFallback>> & {
            foodId: string; foodName: string; source: string; grams: number;
            kcal: number; protein: number; carbs: number; fat: number;
            confidence: number; quality: string; servingDescription?: string | null;
            brandName?: string | null;
        };
        console.log(`  Food:       ${r.foodName}${r.brandName ? ` (${r.brandName})` : ''}`);
        console.log(`  Source:     ${r.source}  |  Quality: ${r.quality}  |  Confidence: ${r.confidence.toFixed(3)}`);
        console.log(`  Grams:      ${r.grams.toFixed(1)}g`);
        console.log(`  Serving:    ${r.servingDescription ?? 'n/a'}`);
        console.log(`  Nutrition:  ${r.kcal.toFixed(0)} kcal | P:${r.protein.toFixed(1)}g C:${r.carbs.toFixed(1)}g F:${r.fat.toFixed(1)}g`);
    }

    const { prisma } = await import('../lib/db');
    await prisma.$disconnect();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
