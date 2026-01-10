import 'dotenv/config';
import { deriveMustHaveTokens } from '../src/lib/fatsecret/filter-candidates';

console.log('Testing singular/plural matching:');
console.log('');
console.log('Query: "green chilies"');
console.log('  Tokens:', deriveMustHaveTokens('green chilies'));

// Check if 'chilies' matches in 'Chopped Green Chili Peppers'
const candidate = 'chopped green chili peppers';
console.log('');
console.log('Candidate: "Chopped Green Chili Peppers"');
console.log('  Contains "chilies":', candidate.includes('chilies'));
console.log('  Contains "chili":', candidate.includes('chili'));

// The token is "chilies" but candidate has "chili" - no match!
// We need to add singular/plural handling
