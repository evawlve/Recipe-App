// Debug what normalized name is passed to isCategoryMismatch
import 'dotenv/config';
import { parseIngredientLine } from '../lib/parse/ingredient-line';
import { normalizeIngredientName } from '../lib/fatsecret/normalization-rules';
import { isCategoryMismatch } from '../lib/fatsecret/filter-candidates';

const testInput = '1.5 cup milk lowfat';

const parsed = parseIngredientLine(testInput);
console.log('Parsed:', parsed);

if (parsed?.name) {
    const normalized = normalizeIngredientName(parsed.name);
    console.log('Normalized:', normalized);

    // Test category mismatch
    const testCandidate = 'Milk (Nonfat)';
    const isMismatch = isCategoryMismatch(normalized.cleaned, testCandidate);
    console.log(`\nisCategoryMismatch("${normalized.cleaned}", "${testCandidate}"): ${isMismatch}`);
}
