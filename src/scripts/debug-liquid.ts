// Debug why liquid→water normalization isn't working
import { normalizeIngredientName, applySynonyms } from '../lib/fatsecret/normalization-rules';
import { parseIngredientLine } from '../lib/parse/ingredient-line';

console.log('=== Testing Liquid Normalization ===\n');

const testInputs = [
    '3 tbsp 100% liquid',
    '3 tbsp liquid',
    'liquid',
    '100% liquid',
];

for (const input of testInputs) {
    console.log(`Input: "${input}"`);

    // Test parsing
    const parsed = parseIngredientLine(input);
    console.log(`  Parsed name: "${parsed?.name}"`);

    // Test normalization on parsed name
    if (parsed?.name) {
        const normalized = normalizeIngredientName(parsed.name);
        console.log(`  Normalized cleaned: "${normalized.cleaned}"`);

        const synonymed = applySynonyms(parsed.name);
        console.log(`  After synonyms: "${synonymed}"`);
    }

    console.log('');
}
