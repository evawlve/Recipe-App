import 'dotenv/config';
import { filterCandidatesByTokens, deriveMustHaveTokens } from '../src/lib/fatsecret/filter-candidates';
import type { UnifiedCandidate } from '../src/lib/fatsecret/gather-candidates';

// Simple test for almond milk case
const candidates: UnifiedCandidate[] = [
    { id: '1', name: 'Unsweetened Almond Milk', source: 'fatsecret', score: 0.9, foodType: 'Generic', rawData: {} },
    { id: '2', name: 'Milk Chocolate with Almonds Candies', source: 'fatsecret', score: 0.9, foodType: 'Generic', rawData: {} },
];

console.log('\n=== ALMOND MILK DEBUG ===\n');
console.log('Query: "almond milk"');
console.log('Must-have tokens:', deriveMustHaveTokens('almond milk'));

// Check if "almond" is in "Unsweetened Almond Milk"
const testName = 'unsweetened almond milk';
console.log('\nToken check for "Unsweetened Almond Milk":');
console.log('  Contains "almond":', testName.includes('almond'));

// Manual category mismatch check
const query = 'almond milk';
const candName = 'Milk Chocolate with Almonds Candies';
console.log(`\nCategory check for "${candName}":`);
console.log('  Contains "candy":', candName.toLowerCase().includes('candy'));
console.log('  Contains "candies":', candName.toLowerCase().includes('candies'));
console.log('  Contains "chocolate candy":', candName.toLowerCase().includes('chocolate candy'));

// Check multi-ingredient
const multiMatch = candName.toLowerCase().match(/^(.+?)\s+(&|and|with)\s+(.+)$/i);
console.log('\nMulti-ingredient check for "Milk Chocolate with Almonds Candies":');
console.log('  Match:', multiMatch ? [multiMatch[1], multiMatch[2], multiMatch[3]] : 'no match');

// Now run actual filter
console.log('\n\n=== ACTUAL FILTER TEST ===\n');
const result = filterCandidatesByTokens(candidates, 'almond milk', { debug: false, rawLine: '1 cup almond milk' });
console.log('Kept:', result.filtered.map(c => c.name));
console.log('Removed:', result.removedCount);
