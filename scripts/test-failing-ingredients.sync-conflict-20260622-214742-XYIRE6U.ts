#!/usr/bin/env ts-node
/**
 * Targeted pilot: re-test all unique ingredients that failed with 0.00 confidence
 * in the 2026-02-10 batch run. Each ingredient is tested with its raw line form
 * (with quantity) to exercise the full pipeline path.
 */
import 'dotenv/config';
import fs from 'node:fs';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { initMappingAnalysisSession, finalizeMappingAnalysisSession } from '../src/lib/fatsecret/mapping-logger';

// All unique failing raw ingredient lines from the 2026-02-10T16-37-32 batch run.
// Deduplicated to one representative line per base ingredient.
const FAILING_INGREDIENTS = [
    // Salt variants
    '0.5 tsp salt',
    '1.5 tsp coarse kosher salt',
    '0.12 tsp coarse salt',
    '2 oz salted butter',
    // Seasonings / Spices
    '1 tbsp italian seasoning',
    '1 tsp cayenne pepper',
    '1 tbsp rosemary',
    '2 tbsp parsley flakes',
    '1 tsp dijon mustard',
    // Oils
    '0.5 cup vegetable oil',
    '2 tbsp canola oil',
    '1 tbsp dark sesame oil',
    '1 tbsp oil',
    '2 tbsp organic extra virgin coconut oil',
    '6 tbsp extra virgin coconut oil melted',
    // Sweeteners
    '0.5 cup no calorie sweetener',
    '1 packet sweetener',
    '1 serving 1 packet splenda',
    '3 packet sweetener',
    '6 tbsp sweetener',
    // Baking
    '0.25 tsp baking soda',
    // Butter / Cooking spray
    '0.5 oz light butter 1 tbsp',
    '4  sprays butter cooking spray',
    // Produce / Canned
    '1 cup petite tomatoes',
    '1.75 cup tomatoes with green chilies',
    '14.5 oz tomatoes with green chilies',
    '2 cup water - 1 to 2 cups',
];

interface Result {
    rawLine: string;
    foodName: string;
    confidence: number;
    source: string;
    kcal: number;
    status: 'SUCCESS' | 'FAIL';
    reason?: string;
}

async function main() {
    console.log('='.repeat(70));
    console.log('  TARGETED PILOT: Re-testing previously failing ingredients');
    console.log('='.repeat(70));
    console.log(`  Testing ${FAILING_INGREDIENTS.length} unique ingredients\n`);

    const session = initMappingAnalysisSession();
    const results: Result[] = [];
    let passCount = 0;
    let failCount = 0;

    for (const rawLine of FAILING_INGREDIENTS) {
        process.stdout.write(`  Mapping: "${rawLine}" ... `);
        try {
            const result = await mapIngredientWithFallback(rawLine, {
                skipCache: true,
                allowLiveFallback: true,
            });

            if (result && 'confidence' in result && result.confidence > 0) {
                const r: Result = {
                    rawLine,
                    foodName: result.foodName || '?',
                    confidence: result.confidence,
                    source: result.source || '?',
                    kcal: result.kcal || 0,
                    status: 'SUCCESS',
                };
                results.push(r);
                passCount++;
                console.log(`✓ ${r.foodName} (${r.confidence.toFixed(2)}, ${r.source})`);
            } else {
                const r: Result = {
                    rawLine,
                    foodName: '',
                    confidence: 0,
                    source: '',
                    kcal: 0,
                    status: 'FAIL',
                    reason: (result as any)?.reason || 'no_match',
                };
                results.push(r);
                failCount++;
                console.log(`✗ FAIL (${r.reason})`);
            }
        } catch (err) {
            results.push({
                rawLine,
                foodName: '',
                confidence: 0,
                source: '',
                kcal: 0,
                status: 'FAIL',
                reason: (err as Error).message,
            });
            failCount++;
            console.log(`✗ ERROR: ${(err as Error).message}`);
        }
    }

    finalizeMappingAnalysisSession(session);

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('  RESULTS SUMMARY');
    console.log('='.repeat(70));
    console.log(`  Total:  ${results.length}`);
    console.log(`  Pass:   ${passCount} ✓`);
    console.log(`  Fail:   ${failCount} ✗`);
    console.log(`  Rate:   ${((passCount / results.length) * 100).toFixed(1)}%`);

    if (failCount > 0) {
        console.log('\n  Still failing:');
        for (const r of results.filter(r => r.status === 'FAIL')) {
            console.log(`    ✗ "${r.rawLine}" — ${r.reason}`);
        }
    }

    // Write detailed results to file
    const outPath = `logs/targeted-pilot-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(`\n  Detailed results: ${outPath}`);

    process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
