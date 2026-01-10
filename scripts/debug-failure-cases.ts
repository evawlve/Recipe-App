import 'dotenv/config';

async function debugFailures() {
    const { mapIngredientWithFallback } = await import('../src/lib/fatsecret/map-ingredient-with-fallback');
    const { FatSecretClient } = await import('../src/lib/fatsecret/client');

    const client = new FatSecretClient();

    const failedCases = [
        {
            input: '4 oz mange tout snap peas',
            expectedIssue: 'British term - should AI generate synonyms?'
        },
        {
            input: '1 oz sauteed mushrooms',
            expectedIssue: 'Serving selection failed despite 0.85 confidence'
        },
        {
            input: '1 oz vegetable fat spread reduced calorie',
            expectedIssue: 'Complex modifier query'
        },
    ];

    for (const testCase of failedCases) {
        console.log('\n' + '='.repeat(70));
        console.log(`Testing: "${testCase.input}"`);
        console.log(`Expected issue: ${testCase.expectedIssue}`);
        console.log('='.repeat(70));

        try {
            const result = await mapIngredientWithFallback(testCase.input, {
                client,
                debug: true,
            });

            if (result) {
                console.log('\n✅ SUCCESS!');
                console.log(`  Food: ${result.foodName}`);
                console.log(`  Confidence: ${result.confidence}`);
                console.log(`  Serving: ${result.servingDescription} (${result.servingGrams}g)`);
            } else {
                console.log('\n❌ FAILED - No mapping returned');
            }
        } catch (err) {
            console.log(`\n❌ ERROR: ${(err as Error).message}`);
        }

        // Small delay between tests
        await new Promise(r => setTimeout(r, 500));
    }

    process.exit(0);
}

debugFailures().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
