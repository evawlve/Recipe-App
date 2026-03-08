/**
 * Clear bad data mappings identified in walkthrough investigation
 * 
 * Issues:
 * - Green Onion → Freshii product (0 kcal)
 * - Rice Vinegar → sweetened product (300 kcal/100g)  
 * - Jalapeño → GOLCHIN product (macro mismatch)
 */

import { prisma } from '../src/lib/db';

async function main() {
    console.log('=== Clearing Bad Data Mappings ===\n');

    // 1. Green Onion (Freshii) - 0kcal branded product
    console.log('1. Clearing Green Onion mappings to Freshii...');
    const greenOnionDeleted = await prisma.validatedMapping.deleteMany({
        where: {
            normalizedForm: { contains: 'green onion', mode: 'insensitive' },
            foodName: { contains: 'Freshii', mode: 'insensitive' }
        }
    });
    console.log(`   ✓ Deleted ${greenOnionDeleted.count} Green Onion → Freshii mappings`);

    // Also clear generic green onion mappings to force re-evaluation
    const greenOnionAll = await prisma.validatedMapping.deleteMany({
        where: {
            normalizedForm: { in: ['green onion', 'green onions'] }
        }
    });
    console.log(`   ✓ Deleted ${greenOnionAll.count} additional green onion mappings`);

    // 2. Rice Vinegar - clear all to force re-evaluation
    console.log('\n2. Clearing Rice Vinegar mappings...');
    const riceVinegarDeleted = await prisma.validatedMapping.deleteMany({
        where: {
            normalizedForm: { contains: 'rice vinegar', mode: 'insensitive' }
        }
    });
    console.log(`   ✓ Deleted ${riceVinegarDeleted.count} Rice Vinegar mappings`);

    // 3. Jalapeño - clear GOLCHIN mappings (macro mismatch)
    console.log('\n3. Clearing Jalapeño mappings...');
    const jalapenoDeleted = await prisma.validatedMapping.deleteMany({
        where: {
            OR: [
                { normalizedForm: { contains: 'jalapeno', mode: 'insensitive' } },
                { normalizedForm: { contains: 'jalapeño', mode: 'insensitive' } }
            ]
        }
    });
    console.log(`   ✓ Deleted ${jalapenoDeleted.count} Jalapeño mappings`);

    // 4. Red Pepper Flakes - clear to force re-evaluation
    console.log('\n4. Clearing Red Pepper Flakes mappings...');
    const pepperFlakesDeleted = await prisma.validatedMapping.deleteMany({
        where: {
            normalizedForm: { contains: 'pepper flakes', mode: 'insensitive' }
        }
    });
    console.log(`   ✓ Deleted ${pepperFlakesDeleted.count} Red Pepper Flakes mappings`);

    // 5. Clear related AiNormalizeCache entries
    console.log('\n5. Clearing related AiNormalizeCache entries...');
    const aiCacheDeleted = await prisma.aiNormalizeCache.deleteMany({
        where: {
            OR: [
                { normalizedName: { contains: 'green onion', mode: 'insensitive' } },
                { normalizedName: { contains: 'rice vinegar', mode: 'insensitive' } },
                { normalizedName: { contains: 'jalapeno', mode: 'insensitive' } },
                { normalizedName: { contains: 'jalapeño', mode: 'insensitive' } },
                { normalizedName: { contains: 'pepper flakes', mode: 'insensitive' } }
            ]
        }
    });
    console.log(`   ✓ Deleted ${aiCacheDeleted.count} AiNormalizeCache entries`);

    console.log('\n✅ Cleanup complete! Re-run debug pipeline to verify fresh mappings.');

    await prisma.$disconnect();
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
