/**
 * Debug script to trace the flour mapping issue
 */

import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { FatSecretClient } from '../src/lib/fatsecret/client';

async function debug() {
    const client = new FatSecretClient();

    const testCases = [
        '1 cup all purpose flour',
        '3 tsp liquid aminos',
        '4 ice cubes ice cubes',
        '3 tbsp 100% liquid',
    ];

    for (const line of testCases) {
        console.log('\n' + '='.repeat(60));
        console.log(`INPUT: "${line}"`);

        // Step 1: Parse
        const parsed = parseIngredientLine(line);
        console.log(`PARSED: qty=${parsed?.qty}, unit=${parsed?.unit}, name="${parsed?.name}"`);

        // Step 2: Normalize
        const baseName = parsed?.name?.trim() || line;
        const normalized = normalizeIngredientName(baseName);
        console.log(`NORMALIZED: cleaned="${normalized.cleaned}", nounOnly="${normalized.nounOnly}"`);

        // Step 3: Search FatSecret with the normalized name
        console.log(`SEARCHING FatSecret for: "${normalized.cleaned}"`);
        try {
            const results = await client.searchFoodsV4(normalized.cleaned, { maxResults: 5 });
            console.log(`RESULTS (top 5):`);
            results.forEach((r, i) => {
                console.log(`  ${i + 1}. ${r.name} (${r.id}) - ${r.brandName || 'Generic'}`);
            });
        } catch (err) {
            console.log(`  ERROR: ${(err as Error).message}`);
        }

        // Also search with the original parsed name to compare
        if (baseName !== normalized.cleaned) {
            console.log(`\nSEARCHING FatSecret for ORIGINAL: "${baseName}"`);
            try {
                const results = await client.searchFoodsV4(baseName, { maxResults: 5 });
                console.log(`RESULTS (top 5):`);
                results.forEach((r, i) => {
                    console.log(`  ${i + 1}. ${r.name} (${r.id}) - ${r.brandName || 'Generic'}`);
                });
            } catch (err) {
                console.log(`  ERROR: ${(err as Error).message}`);
            }
        }
    }
}

debug().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
