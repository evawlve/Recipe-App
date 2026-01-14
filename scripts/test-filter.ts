/**
 * Debug test for token filtering
 */
import 'dotenv/config';
import { filterCandidatesByTokens, deriveMustHaveTokens } from '../src/lib/fatsecret/filter-candidates';
import type { UnifiedCandidate } from '../src/lib/fatsecret/gather-candidates';

const testCandidates: UnifiedCandidate[] = [
    {
        id: '123',
        name: 'SALTED BUTTER',
        source: 'fdc',
        score: 0.95,
        foodType: 'generic',
        rawData: {}
    },
    {
        id: '456',
        name: 'Butter, Salted',
        source: 'fatsecret',
        score: 0.90,
        foodType: 'generic',
        rawData: {}
    }
];

console.log('Testing filterCandidatesByTokens for "salted butter"');
console.log('');

const normalizedName = 'salted butter';
const rawLine = '2 tbsp salted butter';

console.log('1. deriveMustHaveTokens("salted butter"):');
const tokens = deriveMustHaveTokens(normalizedName);
console.log('   Must-have tokens:', tokens);
console.log('');

console.log('2. Filtering candidates with debug=true:');
const result = filterCandidatesByTokens(testCandidates, normalizedName, { debug: true, rawLine });

console.log('');
console.log('3. Result:');
console.log('   Filtered count:', result.filtered.length);
console.log('   Removed count:', result.removedCount);
if (result.filtered.length > 0) {
    console.log('   Filtered candidates:', result.filtered.map(c => c.name));
} else {
    console.log('   ALL REJECTED!');
}
