#!/usr/bin/env ts-node
/**
 * Test the AI size estimation directly 
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { requestSizeEstimates } from '../src/lib/ai/serving-estimator';

async function main() {
    console.log('\n🔍 Testing AI Size Estimation\n');

    const testFoods = [
        'potato',
        'apple',
        'egg',
        'tomato',
        'onion',
    ];

    for (const food of testFoods) {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`Testing: "${food}"`);
        console.log('='.repeat(50));

        const result = await requestSizeEstimates(food, 'fdc');

        if (result.status === 'success') {
            console.log(`✅ AI Size Estimates:`);
            console.log(`   Small:  ${result.sizes.small}g`);
            console.log(`   Medium: ${result.sizes.medium}g`);
            console.log(`   Large:  ${result.sizes.large}g`);
            console.log(`   Confidence: ${result.sizes.confidence}`);
            if (result.sizes.rationale) {
                console.log(`   Rationale: ${result.sizes.rationale}`);
            }
        } else {
            console.log(`❌ Error: ${result.reason}`);
        }
    }

    console.log('\n✅ Done');
    await prisma.$disconnect();
}

main().catch(console.error);
