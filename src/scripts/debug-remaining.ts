// Debug the 3 remaining mapping issues
import 'dotenv/config';
process.env.LOG_LEVEL = 'debug';

async function main() {
    const { mapIngredientWithFallback } = await import('../lib/fatsecret/map-ingredient-with-fallback');
    const { normalizeIngredientName, applySynonyms } = await import('../lib/fatsecret/normalization-rules');
    const { parseIngredientLine } = await import('../lib/parse/ingredient-line');

    const tests = [
        '2 carrots',
        '3 tbsp 100% liquid',
        '2 medium carrots',
    ];

    console.log('=== DEBUGGING REMAINING MAPPING ISSUES ===\n');

    for (const line of tests) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Input: "${line}"`);
        console.log('='.repeat(60));

        // Check parsing
        const parsed = parseIngredientLine(line);
        console.log(`Parsed name: "${parsed?.name}"`);

        // Check normalization
        if (parsed?.name) {
            const synonymed = applySynonyms(parsed.name);
            console.log(`After synonyms: "${synonymed}"`);

            const normalized = normalizeIngredientName(parsed.name);
            console.log(`Normalized: "${normalized.cleaned}"`);
        }

        // Try mapping
        const result = await mapIngredientWithFallback(line, { minConfidence: 0, skipFdc: true });
        console.log(`\nMapping result:`);
        console.log(`  Food: ${result?.foodName || '(none)'}`);
        console.log(`  Confidence: ${result?.confidence}`);
        console.log(`  Reason: ${result?.reason}`);
    }
}

main().catch(console.error);
