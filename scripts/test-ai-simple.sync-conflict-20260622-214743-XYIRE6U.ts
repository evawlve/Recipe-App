#!/usr/bin/env ts-node

import 'dotenv/config';
import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';
import { getValidatedMapping } from '../src/lib/fatsecret/validated-mapping-helpers';

async function testSingle(rawLine: string) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Testing: "${rawLine}"`);
    console.log('='.repeat(70));

    const result = await mapIngredientWithFatsecret(rawLine, {
        minConfidence: 0.5,
        debug: false,
    });

    if (!result) {
        console.log('❌ No mapping found\n');
        return;
    }

    console.log(`\n✅ Mapped to: "${result.foodName}"`);
    if (result.brandName) console.log(`   Brand: ${result.brandName}`);
    console.log(`   Our Confidence: ${result.confidence.toFixed(3)}`);
    console.log(`   Grams: ${result.grams}g`);

    // Check validated cache
    const cached = await getValidatedMapping(rawLine);
    if (cached) {
        console.log(`\n   💾 ✅ SAVED TO VALIDATED CACHE`);
        console.log(`      (AI approved this mapping)`);
    } else {
        console.log(`\n   ⚠️  NOT in validated cache`);
        console.log(`      (AI likely rejected or confidence < 0.85)`);
    }

    console.log();
}

async function main() {
    console.log('\n🧪 AI Validation Test\n');

    // Test 1: Should be REJECTED (almond flour → rice flour is wrong)
    await testSingle('2 tbsps almond flour');

    // Test 2: Should be APPROVED (chicken is correct)
    await testSingle('4 chicken breasts');

    console.log('\n✅ Tests Complete\n');
}

main().catch(console.error).finally(() => process.exit(0));
