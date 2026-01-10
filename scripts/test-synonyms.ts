import { getKnownSynonyms, generateAndSaveSynonyms } from '../src/lib/fatsecret/ai-synonym-generator';

async function test() {
    console.log('=== Testing New Conservative Synonym Generator ===\n');

    // Test known synonyms (fast path)
    console.log('--- Known Synonyms (Fast Path) ---');
    const knownTests = [
        'aubergine',     // British → should return ['eggplant']
        'eggplant',      // American → should return ['aubergine']
        'double cream',  // British → should return ['heavy cream', 'heavy whipping cream']
        'beef',          // Generic → should return null
        'heavy',         // Generic → should return null
        'cream',         // Generic → should return null
    ];

    for (const term of knownTests) {
        const result = getKnownSynonyms(term);
        console.log(`  "${term}" → ${result ? JSON.stringify(result) : 'null'}`);
    }

    // Test full generateAndSaveSynonyms (should skip generic terms)
    console.log('\n--- Generate & Save (Conservative) ---');
    const saveTests = [
        { mapped: 'Heavy Cream', query: 'cream' },           // Valid
        { mapped: 'beef', query: 'beef' },                    // Should skip (generic)
        { mapped: 'Chicken Breast', query: 'chicken breast' }, // Valid ingredient
        { mapped: 'aubergine', query: 'eggplant' },           // Known synonym
    ];

    for (const { mapped, query } of saveTests) {
        const result = await generateAndSaveSynonyms(mapped, query);
        console.log(`  "${mapped}" → saved=${result.saved}, source=${result.source}`);
    }

    console.log('\nDone!');
}

test().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
});
