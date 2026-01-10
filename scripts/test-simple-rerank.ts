import { simpleRerank, toRerankCandidate } from '../src/lib/fatsecret/simple-rerank';

console.log('=== Testing Simple Rerank ===\n');

const mockCandidates = [
    { id: '1', name: 'Chicken Breast', brandName: null, foodType: null, score: 0.9, source: 'fatsecret' as const },
    { id: '2', name: 'Grilled Chicken Breast with Herbs', brandName: 'Brand X', foodType: null, score: 0.95, source: 'fdc' as const },
    { id: '3', name: 'Chicken', brandName: null, foodType: null, score: 0.8, source: 'fatsecret' as const },
    { id: '4', name: 'Chicken Breast Boneless Skinless', brandName: null, foodType: null, score: 0.85, source: 'cache' as const },
];

// Test 1: "chicken breast" should prefer shorter, generic FatSecret match
console.log('Test 1: "chicken breast"');
const result1 = simpleRerank('chicken breast', mockCandidates.map(toRerankCandidate));
console.log('  Winner:', result1?.winner.name);
console.log('  Confidence:', result1?.confidence.toFixed(2));
console.log('  Reason:', result1?.reason);
console.log('');

// Test 2: "olive oil" with different sources
const oilCandidates = [
    { id: 'a', name: 'Olive Oil', brandName: null, foodType: null, score: 0.9, source: 'fatsecret' as const },
    { id: 'b', name: 'Extra Virgin Olive Oil', brandName: null, foodType: null, score: 0.92, source: 'fdc' as const },
    { id: 'c', name: 'OLIVE OIL', brandName: 'Store Brand', foodType: null, score: 0.88, source: 'fdc' as const },
];

console.log('Test 2: "olive oil"');
const result2 = simpleRerank('olive oil', oilCandidates.map(toRerankCandidate));
console.log('  Winner:', result2?.winner.name);
console.log('  Confidence:', result2?.confidence.toFixed(2));
console.log('  Reason:', result2?.reason);
console.log('');

// Test 3: Single candidate
console.log('Test 3: Single candidate');
const result3 = simpleRerank('salt', [toRerankCandidate({ id: 'x', name: 'Salt', brandName: null, foodType: null, score: 0.95, source: 'cache' as const })]);
console.log('  Winner:', result3?.winner.name);
console.log('  Reason:', result3?.reason);

console.log('\nDone!');
