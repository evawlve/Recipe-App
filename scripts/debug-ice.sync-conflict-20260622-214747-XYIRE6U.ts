import 'dotenv/config';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { isCategoryMismatch } from '../src/lib/fatsecret/filter-candidates';

const raw = '1 cup crushed ice';
const parsed = parseIngredientLine(raw);
console.log('Parsed:', JSON.stringify(parsed, null, 2));

// Use parsed.name instead of cleanedName
const normalizedName = parsed.name!;
const candidateName = 'Ice Cubes (Ice Breakers)';
const result = isCategoryMismatch(normalizedName, candidateName);
console.log('\nisCategoryMismatch result:', result);
console.log('Query input:', normalizedName);
console.log('Candidate:', candidateName);

// Test raw matching logic
const queryLower = normalizedName.toLowerCase().trim();
console.log('\n--- Checking match logic ---');
const queryPatterns = ['ice', 'ice cubes', 'ice cube', 'crushed ice', 'shaved ice'];
for (const q of queryPatterns) {
    const exactMatch = queryLower === q;
    const endsWith = queryLower.endsWith(' ' + q);
    const startsWith = queryLower.startsWith(q + ' ');
    const includes = queryLower.includes(q);
    console.log(`Pattern "${q}": exact=${exactMatch}, endsWith=${endsWith}, startsWith=${startsWith}, includes=${includes}`);
}
