// Load environment variables first
import 'dotenv/config';

// Simple test with API credentials loaded
process.env.LOG_LEVEL = 'error';

async function main() {
    const { mapIngredientWithFallback } = await import('../lib/fatsecret/map-ingredient-with-fallback');

    const tests = [
        { line: '0.5 cup cornmeal', expected: 'Cornmeal', notExpected: 'Mush' },
        { line: '1.5 cup milk lowfat', expected: 'Lowfat', notExpected: 'Nonfat' },
        { line: 'green bell pepper', expected: 'Green', notExpected: 'Red' },
        { line: '3 tbsp 100% liquid', expected: 'Water', notExpected: 'Juice' },
    ];

    const results: string[] = [];

    for (const { line, expected, notExpected } of tests) {
        const result = await mapIngredientWithFallback(line, { minConfidence: 0, skipFdc: true });
        const name = result?.foodName || '(none)';
        const hasExp = name.toLowerCase().includes(expected.toLowerCase());
        const hasNot = name.toLowerCase().includes(notExpected.toLowerCase());
        const status = hasExp && !hasNot ? 'PASS' : 'FAIL';
        results.push(`${status}: "${line}" => ${name}`);
    }

    console.log('\n\n========== RESULTS ==========');
    results.forEach(r => console.log(r));
}

main().catch(console.error);
