#!/usr/bin/env npx tsx
/**
 * Debug script to understand why "Coconut Milk or Cream (Liquid, Canned)" 
 * beats "Coconut Milk" in the scorer.
 */

import 'dotenv/config';
import { simpleRerank, toRerankCandidate, type RerankCandidate } from '../src/lib/fatsecret/simple-rerank';

// Simulate the candidates that would come from the API
const mockCandidates: RerankCandidate[] = [
    {
        id: '1',
        name: 'Coconut Milk or Cream (Liquid, Canned)',
        brandName: undefined,
        score: 0.95,  // API position 1
        source: 'fatsecret',
    },
    {
        id: '2', 
        name: 'Coconut Milk',
        brandName: undefined,
        score: 0.93,  // API position 2
        source: 'fatsecret',
    },
    {
        id: '3',
        name: 'Unsweetened Coconut Milk',
        brandName: 'Silk',
        score: 0.91,  // API position 3
        source: 'fatsecret',
    },
    {
        id: '4',
        name: 'Coconut Milk Beverage',
        brandName: undefined,
        score: 0.89,  // API position 4
        source: 'fatsecret',
    },
];

console.log('='.repeat(70));
console.log('DEBUG: Why does "Coconut Milk or Cream" beat "Coconut Milk"?');
console.log('='.repeat(70));

// Test with different query variations
const queries = [
    'coconut milk',                    // What AI normalized produces
    'unsweetened coconut milk',        // What it SHOULD be
];

for (const query of queries) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Query: "${query}"`);
    console.log('─'.repeat(70));
    
    const result = simpleRerank(query, mockCandidates);
    
    if (result) {
        console.log(`Winner: ${result.winner.name}`);
        console.log(`Confidence: ${result.confidence.toFixed(3)}`);
        console.log(`Reason: ${result.reason}`);
    }
}

// Now let's manually compute scores to understand the breakdown
console.log('\n' + '='.repeat(70));
console.log('MANUAL SCORE BREAKDOWN for query "coconut milk"');
console.log('='.repeat(70));

function tokenize(text: string): string[] {
    const IGNORE_TOKENS = new Set([
        'raw', 'fresh', 'organic', 'natural', 'whole',
        'all', 'purpose', 'pure', 'real', 'original',
    ]);
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1 && !IGNORE_TOKENS.has(t));
}

const query = 'coconut milk';
const queryTokens = tokenize(query);
console.log(`Query tokens: [${queryTokens.join(', ')}]`);

for (const cand of mockCandidates) {
    const candTokens = tokenize(cand.name);
    const extraTokens = candTokens.filter(ct => !queryTokens.includes(ct));
    
    console.log(`\n${cand.name}:`);
    console.log(`  Candidate tokens: [${candTokens.join(', ')}]`);
    console.log(`  Extra tokens: [${extraTokens.join(', ')}] (${extraTokens.length} extra)`);
    console.log(`  API score: ${cand.score}`);
    
    // Calculate penalty
    if (queryTokens.length > 0 && extraTokens.length > 0) {
        const extraRatio = extraTokens.length / (queryTokens.length + extraTokens.length);
        const penalty = extraRatio * 0.15;  // EXTRA_TOKEN_PENALTY weight
        console.log(`  Extra token ratio: ${extraRatio.toFixed(3)}`);
        console.log(`  Penalty applied: -${penalty.toFixed(3)}`);
    }
}

