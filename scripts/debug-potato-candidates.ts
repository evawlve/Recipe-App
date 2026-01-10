#!/usr/bin/env ts-node
/**
 * Debug: Test FDC results for singular vs plural query
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('\n🔬 FDC API: Singular vs Plural Query\n');

    const { fdcApi } = await import('../src/lib/usda/fdc-api');

    // Test singular
    console.log('Query: "potato" (singular)');
    const singularResults = await fdcApi.searchFoods({ query: 'potato', pageSize: 10 });
    console.log('Top 5:');
    for (let i = 0; i < Math.min(5, singularResults?.foods?.length || 0); i++) {
        const food = singularResults!.foods[i];
        console.log(`  ${i + 1}. "${food.description}"`);
    }

    console.log('\nQuery: "potatoes" (plural)');
    const pluralResults = await fdcApi.searchFoods({ query: 'potatoes', pageSize: 10 });
    console.log('Top 5:');
    for (let i = 0; i < Math.min(5, pluralResults?.foods?.length || 0); i++) {
        const food = pluralResults!.foods[i];
        console.log(`  ${i + 1}. "${food.description}"`);
    }

    await prisma.$disconnect();
}

main().catch(console.error);
