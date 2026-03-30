import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

const cliArg = process.argv[2];
const testCases = cliArg ? [cliArg] : [
    '30 oz cannellini beans',
    '3 cup oats',
    '1 tbsp fried shallots',
    '1 packet splenda',
    'Palm Sugar',
    'Rice Vinegar',
    '4 tbsp fat free sun-dried tomato vinaigrette dressing',
];

async function main() {
    console.log('API Keys Status:');
    console.log('  OPENAI_API_KEY:', !!process.env.OPENAI_API_KEY ? '✅' : '❌');
    console.log('  FATSECRET_CLIENT_ID:', !!process.env.FATSECRET_CLIENT_ID ? '✅' : '❌');
    console.log('  FATSECRET_CLIENT_SECRET:', !!process.env.FATSECRET_CLIENT_SECRET ? '✅' : '❌');
    console.log('');

    const results: { input: string; status: string; details?: any }[] = [];

    for (const testCase of testCases) {
        try {
            const result = await mapIngredientWithFallback(testCase, { debug: false });
            if (result) {
                if ('status' in result && result.status === 'pending') {
                    results.push({
                        input: testCase,
                        status: '⏳ PENDING AI FALLBACK'
                    });
                } else if ('foodName' in result) {
                    results.push({
                        input: testCase,
                        status: '✅ SUCCESS',
                        details: {
                            food: result.foodName,
                            serving: result.servingDescription,
                            grams: result.grams.toFixed(1),
                            kcal: result.kcal.toFixed(1),
                        }
                    });
                }
            } else {
                results.push({ input: testCase, status: '❌ FAILED (null)' });
            }
        } catch (err) {
            results.push({ input: testCase, status: '❌ ERROR', details: (err as Error).message });
        }
    }

    // Print clean summary
    console.log('\n' + '='.repeat(70));
    console.log('MAPPING RESULTS SUMMARY');
    console.log('='.repeat(70));

    for (const r of results) {
        console.log(`\n${r.status} "${r.input}"`);
        if (r.details && typeof r.details === 'object' && r.details.food) {
            console.log(`   → ${r.details.food} | ${r.details.serving} | ${r.details.grams}g | ${r.details.kcal}kcal`);
        } else if (r.details) {
            console.log(`   → ${r.details}`);
        }
    }

    const successCount = results.filter(r => r.status.includes('SUCCESS')).length;
    console.log(`\n${'='.repeat(70)}`);
    console.log(`TOTAL: ${successCount}/${results.length} successful`);
    console.log('='.repeat(70));

    process.exit(0);
}

main();
