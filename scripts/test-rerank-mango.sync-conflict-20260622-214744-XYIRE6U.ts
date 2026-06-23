/**
 * Debug reranker for mango
 */
import 'dotenv/config';
import { simpleRerank, toRerankCandidate } from '../src/lib/fatsecret/simple-rerank';

const candidates = [
    { id: '1', name: 'Mangos', brandName: null, source: 'fatsecret', score: 0.95, foodType: 'Generic' },
    { id: '2', name: 'Mango', brandName: null, source: 'fatsecret', score: 0.90, foodType: 'Generic' },
    { id: '3', name: 'Mango Chunks', brandName: 'Dole', source: 'fatsecret', score: 0.85, foodType: 'Brand' },
    { id: '4', name: 'Cut Mango', brandName: 'Fresh & Easy', source: 'fatsecret', score: 0.80, foodType: 'Brand' },
];

const rerankCandidates = candidates.map(c => toRerankCandidate({
    id: c.id,
    name: c.name,
    brandName: c.brandName,
    foodType: c.foodType,
    score: c.score,
    source: c.source as 'fatsecret',
}));

const result = simpleRerank('mango', rerankCandidates);

console.log('\n=== RERANK TEST FOR "mango" ===\n');
console.log(`Winner: ${result?.winner.name}`);
console.log(`Confidence: ${result?.confidence.toFixed(3)}`);
console.log(`Reason: ${result?.reason}`);
