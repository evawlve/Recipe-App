/**
 * Test script for enhanced category filtering
 * Verifies that false positives are now properly filtered out
 */

import 'dotenv/config';
import { filterCandidatesByTokens, deriveMustHaveTokens } from '../src/lib/fatsecret/filter-candidates';
import type { UnifiedCandidate } from '../src/lib/fatsecret/gather-candidates';

// Test cases from the false positive analysis
const testCases: Array<{
    query: string;
    candidates: Array<{ id: string; name: string; shouldPass: boolean }>;
}> = [
        {
            query: 'almond milk',
            candidates: [
                { id: '1', name: 'Unsweetened Almond Milk', shouldPass: true },
                { id: '2', name: 'Milk Chocolate with Almonds Candies', shouldPass: false },
                { id: '3', name: 'Almond Breeze Original', shouldPass: true },
                { id: '4', name: 'Chocolate Almond Candy Bar', shouldPass: false },
            ],
        },
        {
            query: 'green chilies',
            candidates: [
                { id: '1', name: 'Green Chilies', shouldPass: true },
                { id: '2', name: 'Diced Tomatoes & Green Chilies', shouldPass: false },
                { id: '3', name: 'Chopped Green Chili Peppers', shouldPass: true },
                { id: '4', name: 'Canned Tomatoes with Green Chilies', shouldPass: false },
            ],
        },
        {
            query: 'tomato',
            candidates: [
                { id: '1', name: 'Tomato', shouldPass: true },
                { id: '2', name: 'Tomato Juice', shouldPass: false },
                { id: '3', name: 'Fresh Tomatoes', shouldPass: true },
                { id: '4', name: 'Tomato Paste', shouldPass: false },
            ],
        },
        {
            query: 'miso paste',
            candidates: [
                { id: '1', name: 'Miso Paste', shouldPass: true },
                { id: '2', name: 'Miso Soup', shouldPass: false },
                { id: '3', name: 'White Miso Paste', shouldPass: true },
                { id: '4', name: 'Miso Broth', shouldPass: false },
            ],
        },
        {
            query: 'cream',
            candidates: [
                { id: '1', name: 'Heavy Cream', shouldPass: true },
                { id: '2', name: 'Ice Cream', shouldPass: false },
                { id: '3', name: 'Whipping Cream', shouldPass: true },
                { id: '4', name: 'Vanilla Ice Cream', shouldPass: false },
            ],
        },
    ];

function createCandidate(id: string, name: string): UnifiedCandidate {
    return {
        id,
        name,
        source: 'fatsecret',
        score: 0.9,
        foodType: 'Generic',
        rawData: {},
    };
}

async function runTests() {
    console.log('=== CATEGORY FILTERING TEST ===\n');

    let totalTests = 0;
    let passedTests = 0;
    let failedTests: string[] = [];

    for (const testCase of testCases) {
        console.log(`\n📝 Testing: "${testCase.query}"`);
        console.log(`   Must-have tokens: [${deriveMustHaveTokens(testCase.query).join(', ')}]`);

        const candidates = testCase.candidates.map(c => createCandidate(c.id, c.name));
        const result = filterCandidatesByTokens(candidates, testCase.query, { debug: true });

        const filteredIds = new Set(result.filtered.map(c => c.id));

        console.log(`   Filtered out ${result.removedCount} candidates`);
        const keptNames = result.filtered.map(c => c.name);
        const removedNames = candidates.filter(c => !filteredIds.has(c.id)).map(c => c.name);
        if (removedNames.length > 0) {
            console.log(`   Removed: ${removedNames.join(', ')}`);
        }

        for (const expected of testCase.candidates) {
            totalTests++;
            const didPass = filteredIds.has(expected.id);
            const isCorrect = didPass === expected.shouldPass;

            if (isCorrect) {
                passedTests++;
                const status = expected.shouldPass ? '✅ KEPT' : '🚫 FILTERED';
                console.log(`   ${status}: "${expected.name}"`);
            } else {
                const status = expected.shouldPass ? '❌ WRONGLY FILTERED' : '❌ WRONGLY KEPT';
                console.log(`   ${status}: "${expected.name}"`);
                failedTests.push(`${testCase.query} → ${expected.name}`);
            }
        }
    }

    console.log('\n' + '='.repeat(50));
    console.log(`RESULTS: ${passedTests}/${totalTests} tests passed`);

    if (failedTests.length > 0) {
        console.log('\n❌ FAILED TESTS:');
        for (const fail of failedTests) {
            console.log(`   - ${fail}`);
        }
    } else {
        console.log('\n✅ ALL TESTS PASSED!');
    }
}

runTests().catch(console.error);
