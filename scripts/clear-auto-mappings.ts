#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

/**
 * Clears all auto-mapped ingredients and validated cache
 * Use this to start fresh with the new AI validation system
 */

async function clearAutoMappedIngredients() {
    console.log('\n🧹 Clearing Auto-Mapped Ingredients & Validated Cache\n');

    // 1. Count what we're about to delete
    const autoMappedCount = await prisma.ingredientFoodMap.count({
        where: {
            mappedBy: {
                in: ['ai_pilot', 'auto', 'system']  // All auto-mapped sources
            }
        }
    });

    const validatedCacheCount = await prisma.validatedMapping.count();

    console.log(`Found:`);
    console.log(`  - ${autoMappedCount} auto-mapped ingredients`);
    console.log(`  - ${validatedCacheCount} validated cache entries`);

    // Confirm deletion
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const answer = await new Promise<string>((resolve) => {
        readline.question('\n⚠️  Delete all these? (yes/no): ', resolve);
    });

    readline.close();

    if (answer.toLowerCase() !== 'yes') {
        console.log('\n❌ Cancelled\n');
        await prisma.$disconnect();
        return;
    }

    console.log('\n🗑️  Deleting...\n');

    // 2. Delete auto-mapped ingredients
    const deletedMappings = await prisma.ingredientFoodMap.deleteMany({
        where: {
            mappedBy: {
                in: ['ai_pilot', 'auto', 'system']
            }
        }
    });

    console.log(`✅ Deleted ${deletedMappings.count} auto-mapped ingredients`);

    // 3. Clear validated cache
    const deletedCache = await prisma.validatedMapping.deleteMany({});

    console.log(`✅ Deleted ${deletedCache.count} validated cache entries`);

    // 4. Clear AI normalize cache (optional - these might still be good)
    const deletedNormalizeCache = await prisma.aiNormalizeCache.deleteMany({});

    console.log(`✅ Deleted ${deletedNormalizeCache.count} AI normalize cache entries`);

    // 5. Show stats
    const remainingMappings = await prisma.ingredientFoodMap.count();
    const unmappedIngredients = await prisma.ingredient.count({
        where: {
            foodMaps: {
                none: {}
            }
        }
    });

    console.log(`\n📊 Results:`);
    console.log(`  - ${remainingMappings} manual mappings remain`);
    console.log(`  - ${unmappedIngredients} ingredients now unmapped (ready for re-mapping)`);
    console.log(`\n✅ Done! Ready for fresh auto-mapping with AI validation.\n`);

    await prisma.$disconnect();
}

clearAutoMappedIngredients().catch(console.error);
