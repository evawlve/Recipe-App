import 'dotenv/config';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';

const rawLine = 'fat free cheddar cheese';
const parsed = parseIngredientLine(rawLine);
const normResult = normalizeIngredientName(parsed?.name || rawLine);
const normalized = typeof normResult === 'string' ? normResult : normResult.cleaned;

console.log('=== Query Debug ===');
console.log('rawLine:', rawLine);
console.log('parsed.name:', parsed?.name);
console.log('normalized:', normalized);
console.log('');
console.log('PROBLEM: If normalized lost "fat free", the API gets wrong query!');
