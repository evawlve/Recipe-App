#!/usr/bin/env ts-node
/**
 * Check and clear ALL potato/lentil ValidatedMapping entries
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('\n🔍 Checking ValidatedMapping entries for potato/lentil...\n');

    const entries = await prisma.validatedMapping.findMany({
        where: {
            OR: [
                { rawIngredient: { contains: 'potato', mode: 'insensitive' } },
                { normalizedForm: { contains: 'potato', mode: 'insensitive' } },
                { rawIngredient: { contains: 'lentil', mode: 'insensitive' } },
                { normalizedForm: { contains: 'lentil', mode: 'insensitive' } },
            ]
        }
    });

    console.log(`Found ${entries.length} entries:\n`);
    for (const e of entries) {
        console.log(`  "${e.rawIngredient}" -> "${e.foodName}" (id: ${e.foodId})`);
    }

    if (entries.length > 0) {
        console.log('\n🧹 Deleting all these entries...');
        const deleted = await prisma.validatedMapping.deleteMany({
            where: {
                id: { in: entries.map(e => e.id) }
            }
        });
        console.log(`   Deleted ${deleted.count} entries`);
    }

    // Also delete the FatSecretFoodCache entries
    const potatoCache = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'Potato', mode: 'insensitive' } }
    });
    const lentilCache = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'Lentil', mode: 'insensitive' } }
    });

    console.log('\n📦 FatSecretFoodCache entries:');
    console.log(`   Potato-related: ${potatoCache.length}`);
    console.log(`   Lentil-related: ${lentilCache.length}`);

    for (const c of [...potatoCache, ...lentilCache]) {
        const nutrients = c.nutrientsPer100g as { calories?: number; fat?: number } | null;
        console.log(`   ${c.name} (${c.id}): ${nutrients?.calories}kcal, ${nutrients?.fat}g fat`);
    }

    console.log('\n✅ Done');
}

main()
    .catch((error) => {
        console.error('Error:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
