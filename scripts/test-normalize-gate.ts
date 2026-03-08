/**
 * Test Normalize Gate Integration
 * Verifies that the normalize gate is being used to skip LLM calls
 */

import { gatherCandidates, type GatherOptions } from '../src/lib/fatsecret/gather-candidates';
import { shouldNormalizeLlm } from '../src/lib/fatsecret/normalize-gate';
import { extractModifierConstraints } from '../src/lib/fatsecret/modifier-constraints';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';

async function testNormalizeGate(rawLine: string): Promise<void> {
    console.log(`\nTesting: "${rawLine}"`);
    console.log('-'.repeat(50));

    const parsed = parseIngredientLine(rawLine);
    const normalizedName = normalizeIngredientName(parsed?.name || rawLine).cleaned || rawLine;

    console.log(`  Parsed name: ${parsed?.name}`);
    console.log(`  Normalized: ${normalizedName}`);

    // Gather candidates
    const gatherOptions: GatherOptions = {
        skipCache: true,  // Skip cache for testing
        skipLiveApi: false,
        skipFdc: false,
    };

    const candidates = await gatherCandidates(rawLine, parsed, normalizedName, gatherOptions);
    console.log(`  Candidates found: ${candidates.length}`);

    // Extract constraints and check gate
    const constraints = extractModifierConstraints(rawLine);
    console.log(`  Required tokens: ${constraints.requiredTokens.slice(0, 3).join(', ')}...`);
    console.log(`  Banned tokens: ${constraints.bannedTokens.slice(0, 3).join(', ')}...`);

    const decision = shouldNormalizeLlm(rawLine, candidates, constraints);

    console.log(`\n  GATE DECISION:`);
    console.log(`    Should call LLM: ${decision.shouldCallLlm ? 'YES' : 'NO'}`);
    console.log(`    Reason: ${decision.reason}`);
    console.log(`    Confidence: ${decision.confidence.toFixed(2)}`);
}

async function main() {
    console.log('='.repeat(60));
    console.log('Normalize Gate Integration Test');
    console.log('='.repeat(60));

    // Test cases - some should skip LLM, some should call it
    const testCases = [
        '1 banana',              // Should SKIP (high confidence match)
        '1 egg',                 // Should SKIP (high confidence match)
        '1 cup fat free milk',   // Should SKIP (modifier variants found)
        'salt and pepper',       // Should CALL (multi-ingredient)
        'kraft cheddar cheese',  // May CALL (brand detection)
        'xyz strange food',      // Should CALL (no candidates)
    ];

    for (const testCase of testCases) {
        await testNormalizeGate(testCase);
    }

    console.log('\n' + '='.repeat(60));
    console.log('Test complete');
}

main().catch(console.error);
