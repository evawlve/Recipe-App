// Debug 100% liquid normalization
import 'dotenv/config';
import { applySynonyms, normalizeIngredientName } from '../lib/fatsecret/normalization-rules';
import { parseIngredientLine } from '../lib/parse/ingredient-line';

const testInputs = [
    '3 tbsp 100% liquid',
    '3 tbsp liquid',
    '100% liquid',
    'liquid',
];

console.log('=== TESTING 100% LIQUID NORMALIZATION ===\n');

for (const input of testInputs) {
    const parsed = parseIngredientLine(input);
    console.log(`Input: "${input}"`);
    console.log(`  Parsed name: "${parsed?.name}"`);

    if (parsed?.name) {
        const synonymed = applySynonyms(parsed.name);
        console.log(`  After synonyms: "${synonymed}"`);

        const normalized = normalizeIngredientName(parsed.name);
        console.log(`  After normalization: "${normalized.cleaned}"`);
    }
    console.log('');
}
