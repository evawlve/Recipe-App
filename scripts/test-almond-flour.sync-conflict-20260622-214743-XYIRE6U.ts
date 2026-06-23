#!/usr/bin/env ts-node

import 'dotenv/config';
import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';
import { getValidatedMapping } from '../src/lib/fatsecret/validated-mapping-helpers';
import { prisma } from '../src/lib/db';

async function testAlmondFlour() {
    const rawLine = '2 tbsps almond flour';

    console.log(`\n${'='.repeat(70)}`);
    console.log(`Testing: "${rawLine}"`);
    console.log('='.repeat(70));

    // Clear any existing validated mapping
    await prisma.validatedMapping.deleteMany({
        where: { rawIngredient: rawLine },
    });

    const result = await mapIngredientWithFatsecret(rawLine, {
        minConfidence: 0.5,
        debug: false,
    });

    if (!result) {
        console.log('\n❌ No mapping found\n');
        return;
    }

    console.log(`\n✅ Mapped to: "${result.foodName}"`);
    if (result.brandName) console.log(`   Brand: ${result.brandName}`);
    console.log(`   Our Confidence: ${result.confidence.toFixed(3)}`);

    // Check validated cache
    const cached = await getValidatedMapping(rawLine);

    if (result.foodName.toLowerCase().includes('rice')) {
        console.log(`\n🔴 WRONG MATCH: Almond flour mapped to RICE flour!`);
        if (cached) {
            console.log(`   ❌ BAD: AI APPROVED THIS (should have rejected)`);
        } else {
            console.log(`   ✅ GOOD: AI REJECTED this mapping`);
            console.log(`      Not saved to validated cache`);
        }
    } else if (result.foodName.toLowerCase().includes('almond')) {
        console.log(`\n✅ CORRECT MATCH: Almond flour`);
        if (cached) {
            console.log(`   ✅ Saved to validated cache (AI approved)`);
        } else {
            console.log(`   ⚠️  Not in cache (confidence < 0.85 or AI rejected)`);
        }
    }

    await prisma.$disconnect();
}

testAlmondFlour().catch(console.error);
