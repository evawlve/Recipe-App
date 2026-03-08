/**
 * Debug script to investigate parsing issues:
 * 1. "1 serving 1 packet splenda" - Splenda parsing failure
 * 2. "0.25 cup & 1 tbsp ground golden flaxseed meal" - False positive to "Golden Cadillac"
 */
import 'dotenv/config';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function debugCases() {
    const testCases = [
        '1 serving 1 packet splenda',
        '0.25 cup & 1 tbsp ground golden flaxseed meal',
        // Simpler variants to isolate the issue
        '1 packet splenda',
        '1 tbsp ground flaxseed meal',
        '1 tbsp ground golden flaxseed',
        'splenda',
        'flaxseed meal',
    ];

    console.log('='.repeat(80));
    console.log('PARSING DEBUG');
    console.log('='.repeat(80));

    for (const line of testCases) {
        console.log(`\n--- "${line}" ---`);
        const parsed = parseIngredientLine(line);
        console.log('Parsed:', JSON.stringify(parsed, null, 2));
    }

    console.log('\n' + '='.repeat(80));
    console.log('MAPPING DEBUG (main failures)');
    console.log('='.repeat(80));

    const mainCases = [
        '1 serving 1 packet splenda',
        '0.25 cup & 1 tbsp ground golden flaxseed meal',
    ];

    for (const line of mainCases) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`MAPPING: "${line}"`);
        console.log('='.repeat(60));

        try {
            const result = await mapIngredientWithFallback(line, {
                debug: true,
                allowLiveFallback: false  // Don't hit API
            });

            if (result) {
                console.log('\n✓ MAPPED:');
                console.log(`  Food: ${result.foodName}`);
                console.log(`  Brand: ${result.brandName || 'N/A'}`);
                console.log(`  Source: ${result.source}`);
                console.log(`  Grams: ${result.grams}g`);
                console.log(`  Kcal: ${result.kcal}`);
                console.log(`  Serving: ${result.servingDescription}`);
            } else {
                console.log('\n✗ FAILED TO MAP');
            }
        } catch (error) {
            console.error('\n✗ ERROR:', error);
        }
    }
}

debugCases().catch(console.error);
