/**
 * Debug script to trace what happens when mapping specific ingredients like:
 * - "16oz 90 lean ground beef" → should map to "90% lean ground beef" not just "beef"
 * - "rice vinegar" → should map to "rice vinegar" not "vinegar"
 */

import 'dotenv/config';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';
import { buildSearchExpressions } from '../src/lib/fatsecret/map-ingredient';
import { normalizeQuery } from '../src/lib/search/normalize';
import { aiNormalizeIngredient } from '../src/lib/fatsecret/ai-normalize';

const TEST_CASES = [
    '16oz 90 lean ground beef',
    'rice vinegar',
    '1 lb 93% lean ground beef',
    '2 tbsp apple cider vinegar',
];

async function debugMappingPipeline(rawLine: string) {
    console.log('\n' + '='.repeat(80));
    console.log(`RAW LINE: "${rawLine}"`);
    console.log('='.repeat(80));

    // Step 1: Parse the ingredient line
    const parsed = parseIngredientLine(rawLine);
    console.log('\n1. PARSED INGREDIENT:');
    console.log(JSON.stringify(parsed, null, 2));

    // Step 2: Get the base name
    const baseName = parsed?.name?.trim() || rawLine.trim();
    console.log(`\n2. BASE NAME: "${baseName}"`);

    // Step 3: Apply normalization rules
    const normalization = normalizeIngredientName(baseName);
    console.log('\n3. NORMALIZATION RULES APPLIED:');
    console.log(`   Cleaned: "${normalization.cleaned}"`);
    console.log(`   Noun Only: "${normalization.nounOnly}"`);
    console.log(`   Stripped: [${normalization.stripped.join(', ')}]`);

    // Step 4: Apply AI normalization
    const aiHint = await aiNormalizeIngredient(rawLine, normalization.cleaned);
    console.log('\n4. AI NORMALIZATION:');
    if (aiHint.status === 'success') {
        console.log(`   Normalized Name: "${aiHint.normalizedName}"`);
        console.log(`   Synonyms: [${aiHint.synonyms.join(', ')}]`);
        console.log(`   Prep Phrases: [${aiHint.prepPhrases.join(', ')}]`);
        console.log(`   Size Phrases: [${aiHint.sizePhrases.join(', ')}]`);
    } else {
        console.log(`   Status: ${aiHint.status}, Reason: ${aiHint.reason}`);
    }

    // Step 5: Build search expressions
    const searchExpressions = buildSearchExpressions(parsed, normalization.cleaned);
    console.log('\n5. SEARCH EXPRESSIONS GENERATED:');
    searchExpressions.forEach((expr, idx) => {
        console.log(`   [${idx + 1}] "${expr}"`);
    });

    // Step 6: Show what normalizeQuery does to each expression
    console.log('\n6. NORMALIZED QUERIES (what gets sent to search):');
    searchExpressions.slice(0, 5).forEach((expr, idx) => {
        const normalized = normalizeQuery(expr);
        console.log(`   [${idx + 1}] "${expr}" → "${normalized}"`);
    });
}

async function main() {
    console.log('DEBUGGING INGREDIENT MAPPING PIPELINE');
    console.log('This script traces the transformation of ingredient strings\n');

    for (const testCase of TEST_CASES) {
        await debugMappingPipeline(testCase);
    }

    console.log('\n' + '='.repeat(80));
    console.log('ANALYSIS COMPLETE');
    console.log('='.repeat(80));
}

main().catch(console.error);
