// Test moderate mapping issues
process.env.LOG_LEVEL = 'error';

import { parseIngredientLine } from '../lib/parse/ingredient-line';

async function main() {
    const { mapIngredientWithFallback } = await import('../lib/fatsecret/map-ingredient-with-fallback');

    const testCases = [
        { line: '0.5 cup cornmeal', issue: 'Cornmeal → Cornmeal Mush (prepared dish)' },
        { line: '1.5 cup milk lowfat', issue: 'Lowfat → Nonfat (fat modifier)' },
        { line: 'green bell pepper', issue: 'Green → Red (color mismatch)' },
        { line: '3 tbsp 100% liquid', issue: 'Ambiguous query' },
    ];

    for (const { line, issue } of testCases) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Issue: ${issue}`);
        console.log(`Input: "${line}"`);
        console.log('='.repeat(60));

        const parsed = parseIngredientLine(line);
        console.log(`Parsed: qty=${parsed?.qty}, unit=${parsed?.unit}, name="${parsed?.name}"`);

        const result = await mapIngredientWithFallback(line, {
            minConfidence: 0,
            skipFdc: true,
        });

        if (result) {
            console.log(`\nMapped to: ${result.foodName} (${result.brandName || 'Generic'})`);
            console.log(`Grams: ${result.grams.toFixed(1)}g, Kcal: ${result.kcal.toFixed(0)}`);
            console.log(`Confidence: ${result.confidence.toFixed(2)}`);
            console.log(`Reason: ${result.reason}`);
        } else {
            console.log('\nNo result!');
        }
    }
}

main().catch(console.error);
