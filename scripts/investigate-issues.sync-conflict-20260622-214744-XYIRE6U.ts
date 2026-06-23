/**
 * Investigate remaining mapping issues
 */

import { normalizeIngredientName, clearRulesCache } from '../src/lib/fatsecret/normalization-rules';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

clearRulesCache();

const client = new FatSecretClient();

interface Issue {
    rawLine: string;
    description: string;
}

const issues: Issue[] = [
    { rawLine: '3 fl oz single cream', description: 'LOW_CONF - British cream term' },
    { rawLine: '4 oz sugar substitute 3/4 cup', description: 'High kcal (425) for sweetener' },
    { rawLine: '44 g fancy low-moisture part-skim mozzarella cheese', description: 'MISSING_FAT_MOD flag' },
    { rawLine: '16 oz ground beef', description: 'Mapped to fattier than 85% lean' },
];

async function investigate() {
    for (const issue of issues) {
        console.log('\n' + '='.repeat(70));
        console.log(`ISSUE: ${issue.description}`);
        console.log(`INPUT: "${issue.rawLine}"`);
        console.log('='.repeat(70));

        // Parse
        const parsed = parseIngredientLine(issue.rawLine);
        console.log(`\nPARSED: qty=${parsed?.qty}, unit=${parsed?.unit}, name="${parsed?.name}"`);

        // Normalize
        const baseName = parsed?.name?.trim() || issue.rawLine;
        const normalized = normalizeIngredientName(baseName);
        console.log(`NORMALIZED: "${normalized.cleaned}"`);

        // Search FatSecret
        console.log(`\nFatSecret API search for: "${normalized.cleaned}"`);
        try {
            const results = await client.searchFoodsV4(normalized.cleaned, { maxResults: 8 });
            if (results.length === 0) {
                console.log('  No results found!');
            } else {
                results.forEach((r, i) => {
                    console.log(`  ${i + 1}. ${r.name} (${r.brandName || 'Generic'}) [${r.foodType}]`);
                });
            }
        } catch (err) {
            console.log(`  ERROR: ${(err as Error).message}`);
        }

        // Also try alternate search terms if relevant
        const alternates: string[] = [];
        if (normalized.cleaned.includes('cream')) {
            alternates.push('half and half', 'coffee cream', 'table cream');
        }
        if (normalized.cleaned.includes('mozzarella')) {
            alternates.push('part skim mozzarella', 'low fat mozzarella');
        }
        if (normalized.cleaned.includes('ground beef')) {
            alternates.push('ground beef 85% lean', 'ground beef 80/20', '85/15 ground beef');
        }
        if (normalized.cleaned.includes('sugar substitute')) {
            alternates.push('splenda', 'stevia', 'sucralose');
        }

        for (const alt of alternates) {
            console.log(`\nAlternate search: "${alt}"`);
            try {
                const results = await client.searchFoodsV4(alt, { maxResults: 3 });
                results.forEach((r, i) => {
                    console.log(`  ${i + 1}. ${r.name} (${r.brandName || 'Generic'})`);
                });
            } catch (err) {
                console.log(`  ERROR: ${(err as Error).message}`);
            }
        }
    }
}

investigate().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
