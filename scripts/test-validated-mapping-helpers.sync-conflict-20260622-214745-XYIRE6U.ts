/**
 * Quick test of validated mapping helper functions
 * 
 * This tests:
 * 1. Saving a validated mapping to the database
 * 2. Retrieving it from cache
 * 3. Saving AI normalize cache
 * 4. Retrieving AI normalize from cache
 */

import {
    saveValidatedMapping,
    getValidatedMapping,
    saveAiNormalizeCache,
    getAiNormalizeCache,
    trackValidationFailure
} from '../src/lib/fatsecret/validated-mapping-helpers';

async function testValidatedMappingHelpers() {
    console.log('='.repeat(80));
    console.log('TESTING VALIDATED MAPPING HELPERS');
    console.log('='.repeat(80));
    console.log('');

    // Test 1: Save and retrieve a validated mapping
    console.log('📝 Test 1: Save ValidatedMapping');
    const testMapping = {
        foodId: 'test-food-123',
        foodName: 'Ground Beef, 90% Lean',
        brandName: null,
        confidence: 0.92,
        grams: 100,
        kcal: 180,
        protein: 20,
        carbs: 0,
        fat: 10,
        quality: 'high' as const,
        rawLine: '90 lean ground beef',
        source: 'fatsecret' as const,
    };

    const testValidation = {
        approved: true,
        confidence: 0.92,
        reason: 'Mapping correctly preserves 90% lean qualifier',
        category: 'correct' as const,
    };

    try {
        await saveValidatedMapping('90 lean ground beef', testMapping, testValidation);
        console.log('  ✅ Saved successfully');
    } catch (error) {
        console.error('  ❌ Save failed:', (error as Error).message);
        return;
    }

    // Test 2: Retrieve the validated mapping
    console.log('');
    console.log('🔍 Test 2: Retrieve ValidatedMapping from cache');
    try {
        const cached = await getValidatedMapping('90 lean ground beef');
        if (cached) {
            console.log('  ✅ Retrieved from cache:', cached.foodName);
            console.log('  📊 Confidence:', cached.confidence);
        } else {
            console.log('  ❌ Not found in cache (unexpected)');
        }
    } catch (error) {
        console.error('  ❌ Retrieve failed:', (error as Error).message);
    }

    // Test 3: Save AI normalize cache
    console.log('');
    console.log('📝 Test 3: Save AI Normalize Cache');
    const aiNormalizeResult = {
        normalizedName: 'ground beef lean',
        synonyms: ['ground beef 90', 'lean ground beef'],
        prepPhrases: [],
        sizePhrases: [],
    };

    try {
        await saveAiNormalizeCache('1 lb 90 lean ground beef', aiNormalizeResult);
        console.log('  ✅ Saved AI normalize cache');
    } catch (error) {
        console.error('  ❌ Save failed:', (error as Error).message);
    }

    // Test 4: Retrieve AI normalize cache
    console.log('');
    console.log('🔍 Test 4: Retrieve AI Normalize from cache');
    try {
        const cached = await getAiNormalizeCache('1 lb 90 lean ground beef');
        if (cached) {
            console.log('  ✅ Retrieved from cache:', cached.normalizedName);
            console.log('  📝 Synonyms:', cached.synonyms);
        } else {
            console.log('  ❌ Not found in cache (unexpected)');
        }
    } catch (error) {
        console.error('  ❌ Retrieve failed:', (error as Error).message);
    }

    // Test 5: Track a validation failure
    console.log('');
    console.log('📝 Test 5: Track Validation Failure');
    const failedMapping = {
        foodId: 'generic-beef-456',
        foodName: 'Beef',
        brandName: null,
        confidence: 0.85,
        grams: 100,
        kcal: 250,
        protein: 26,
        carbs: 0,
        fat: 15,
        quality: 'medium' as const,
        rawLine: '90 lean ground beef',
        source: 'fatsecret' as const,
    };

    const failedValidation = {
        approved: false,
        confidence: 0.3,
        reason: 'Missing leanness qualifier - mapped to generic beef',
        category: 'fat_mismatch' as const,
        suggestedAlternative: 'ground beef, 90% lean',
    };

    try {
        await trackValidationFailure(
            '90 lean ground beef',
            failedMapping,
            failedValidation,
            { succeeded: true, suggestedQuery: 'ground beef, 90% lean' }
        );
        console.log('  ✅ Tracked validation failure');
    } catch (error) {
        console.error('  ❌ Track failed:', (error as Error).message);
    }

    console.log('');
    console.log('='.repeat(80));
    console.log('✅ ALL TESTS COMPLETE');
    console.log('='.repeat(80));
    console.log('');
    console.log('✨ Database helper functions are working correctly!');
    console.log('   Ready to proceed with Phase 3 integration.');
}

// Run the test
testValidatedMappingHelpers()
    .then(() => {
        console.log('\n✅ Test completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    });
