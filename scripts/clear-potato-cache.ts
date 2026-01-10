#!/usr/bin/env ts-node
/**
 * Check and clear ALL potato-related cache entries for testing FDC preference
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { normalizeQuery } from '../src/lib/search/normalize';

async function main() {
    console.log('\n📋 FULL POTATO CACHE CHECK\n');

    // Check what normalizeQuery does to "potatoes"
    const normalizedPotatoes = normalizeQuery('potatoes');
    console.log(`normalizeQuery('potatoes') = "${normalizedPotatoes}"`);
    console.log(`normalizeQuery('4 medium potatoes') = "${normalizeQuery('4 medium potatoes')}"`);

    // Find ALL ValidatedMappings that could match
    const mappings = await prisma.validatedMapping.findMany({
        where: {
            OR: [
                { rawIngredient: { contains: 'potato', mode: 'insensitive' } },
                { normalizedForm: { contains: 'potato', mode: 'insensitive' } },
                // Also check the exact normalized form
                { normalizedForm: normalizedPotatoes },
            ],
        },
        take: 20,
    });

    console.log(`\nFound ${mappings.length} potential potato mappings:`);
    for (const m of mappings) {
        console.log(`\n  ID: ${m.id}`);
        console.log(`  Raw: "${m.rawIngredient}"`);
        console.log(`  NormalizedForm: "${m.normalizedForm}"`);
        console.log(`  Food: "${m.foodName}" (${m.foodId})`);
        console.log(`  Source: ${m.source}`);
    }

    // Also check FatSecretFoodCache for potato
    const fsFoods = await prisma.fatSecretFoodCache.findMany({
        where: {
            OR: [
                { name: { contains: 'potato', mode: 'insensitive' } },
                { id: '5718' },  // The ID that was returned
            ],
        },
        take: 5,
    });

    console.log(`\n🥔 FatSecretFoodCache potato entries: ${fsFoods.length}`);
    for (const f of fsFoods) {
        console.log(`  ID: ${f.id}, Name: "${f.name}"`);
    }

    if (mappings.length > 0) {
        console.log('\n🗑️ Deleting ALL potato-related ValidatedMappings...');
        const deleted = await prisma.validatedMapping.deleteMany({
            where: {
                OR: [
                    { rawIngredient: { contains: 'potato', mode: 'insensitive' } },
                    { normalizedForm: { contains: 'potato', mode: 'insensitive' } },
                    { normalizedForm: normalizedPotatoes },
                ],
            },
        });
        console.log(`✅ Deleted ${deleted.count} mappings`);
    }

    await prisma.$disconnect();
    console.log('\n✅ Done\n');
}

main().catch(console.error);
