/**
 * Test AI Call Metrics Tracking
 * Verifies that the AI call metrics are properly tracked
 */

import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import {
    initMappingAnalysisSession,
    finalizeMappingAnalysisSession
} from '../src/lib/fatsecret/mapping-logger';
import { getAiCallMetrics, resetAiCallMetrics } from '../src/lib/ai/structured-client';

// Enable mapping analysis
process.env.ENABLE_MAPPING_ANALYSIS = 'true';

async function main() {
    console.log('='.repeat(60));
    console.log('AI Call Metrics Tracking Test');
    console.log('='.repeat(60));

    // Reset metrics for clean test
    resetAiCallMetrics();

    // Initialize session
    initMappingAnalysisSession();

    // Test ingredients - mix of common (should skip LLM) and complex
    const testIngredients = [
        '1 banana',
        '1 cup milk',
        '2 eggs',
        '1 cup fat free milk',
        '1 tsp salt',
        'salt and pepper',  // Multi-ingredient - should call LLM
        '1 tbsp olive oil',
    ];

    console.log(`\nProcessing ${testIngredients.length} test ingredients...\n`);

    for (const ingredient of testIngredients) {
        console.log(`  Processing: "${ingredient}"...`);
        const result = await mapIngredientWithFallback(ingredient);
        if (result && 'foodName' in result) {
            console.log(`    → ${result.foodName} (${result.confidence.toFixed(2)})`);
        } else {
            console.log(`    → (no result)`);
        }
    }

    // Print metrics before finalization
    console.log('\n' + '-'.repeat(60));
    const metrics = getAiCallMetrics();
    console.log('\nMetrics before finalization:');
    console.log(JSON.stringify(metrics, null, 2));

    // Finalize session (will print AI summary)
    finalizeMappingAnalysisSession();
}

main().catch(console.error);
