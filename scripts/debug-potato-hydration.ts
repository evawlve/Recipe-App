#!/usr/bin/env ts-node
/**
 * Test single potato mapping - VERBOSE version
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    console.log('\n🔍 VERBOSE Potato Mapping Test\n');

    // Step 1: Clear ALL potato mappings
    const deleted = await prisma.validatedMapping.deleteMany({
        where: {
            OR: [
                { rawIngredient: { contains: 'potato', mode: 'insensitive' } },
                { normalizedForm: { contains: 'potato', mode: 'insensitive' } },
            ],
        },
    });
    console.log(`✅ Cleared ${deleted.count} potato mappings from cache\n`);

    // Verify cache is empty
    const remaining = await prisma.validatedMapping.count({
        where: {
            OR: [
                { rawIngredient: { contains: 'potato', mode: 'insensitive' } },
                { normalizedForm: { contains: 'potato', mode: 'insensitive' } },
            ],
        },
    });
    console.log(`Remaining potato mappings: ${remaining}\n`);

    // Step 2: Run mapping
    console.log('Running mapIngredientWithFallback("4 medium potatoes")...\n');
    const result = await mapIngredientWithFallback('4 medium potatoes');

    console.log('='.repeat(70));
    console.log('RESULT:');
    console.log('='.repeat(70));
    if (result) {
        console.log(`Food Name: ${result.foodName}`);
        console.log(`Source: ${result.source}`);
        console.log(`Food ID: ${result.foodId}`);
        console.log(`Serving: ${result.servingDescription}`);
        console.log(`Grams: ${result.grams}`);
        console.log(`Fat: ${result.fat}g`);
        console.log(`Confidence: ${result.confidence}`);

        if (result.source === 'fdc' || result.foodId.startsWith('fdc_')) {
            console.log('\n✅ SUCCESS: FDC was selected!');
        } else {
            console.log('\n❌ ISSUE: FatSecret was selected instead of FDC');
        }
    } else {
        console.log('❌ Mapping failed');
    }
    console.log('='.repeat(70));

    // Step 3: Check what was saved
    const saved = await prisma.validatedMapping.findFirst({
        where: { normalizedForm: { contains: 'potato', mode: 'insensitive' } },
    });
    console.log(`\nSaved to cache: ${saved ? `"${saved.foodName}" (ID: ${saved.foodId}, source: ${saved.source})` : 'nothing'}`);

    await prisma.$disconnect();
}

main().catch(console.error);
