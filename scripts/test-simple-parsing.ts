/**
 * Simple test to check the parsing and cleaning for specific cases
 */

import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeQuery } from '../src/lib/search/normalize';

function cleanIngredientNameSimple(rawName: string): string {
    const normalized = normalizeQuery(rawName);
    console.log(`  normalizeQuery: "${rawName}" → "${normalized}"`);

    const tokens = normalized.split(/\s+/).filter(Boolean);
    console.log(`  tokens:`, tokens);

    const cleaned: string[] = [];
    const DESCRIPTOR_STOPWORDS = new Set([
        'cut', 'cutting', 'sliced', 'diced', 'chopped', 'minced',
    ]);
    const UNIT_STOPWORDS = new Set([
        'tsp', 'tbsp', 'cup', 'oz', 'lb',
    ]);

    for (let token of tokens) {
        console.log(`    Processing token: "${token}"`);

        if (!token || DESCRIPTOR_STOPWORDS.has(token) || UNIT_STOPWORDS.has(token)) {
            console.log(`      SKIPPED (stopword)`);
            continue;
        }

        // Remove inch markers like 1" or 1-inch
        if (/^\d+("?|-inch|inch)?$/.test(token)) {
            console.log(`      SKIPPED (number pattern)`);
            continue;
        }

        // Singularize
        if (token.endsWith('es') && token.length > 3) {
            const newToken = token.slice(0, -2);
            console.log(`      Singularized: "${token}" → "${newToken}"`);
            token = newToken;
        } else if (token.endsWith('s') && token.length > 3) {
            const newToken = token.slice(0, -1);
            console.log(`      Singularized: "${token}" → "${newToken}"`);
            token = newToken;
        }

        cleaned.push(token);
    }

    const result = cleaned.join(' ').trim();
    console.log(`  Final cleaned: "${result}"\n`);
    return result;
}

console.log('=== Testing "90 lean ground beef" ===');
const parsed1 = parseIngredientLine('16oz 90 lean ground beef');
console.log('Parsed:', parsed1);
console.log('Base name:', parsed1?.name);
cleanIngredientNameSimple(parsed1?.name || '');

console.log('\n=== Testing "rice vinegar" ===');
const parsed2 = parseIngredientLine('2 tbsp rice vinegar');
console.log('Parsed:', parsed2);
console.log('Base name:', parsed2?.name);
cleanIngredientNameSimple(parsed2?.name || '');

console.log('\n=== Testing "93% lean ground beef" ===');
const parsed3 = parseIngredientLine('1 lb 93% lean ground beef');
console.log('Parsed:', parsed3);
console.log('Base name:', parsed3?.name);
cleanIngredientNameSimple(parsed3?.name || '');
