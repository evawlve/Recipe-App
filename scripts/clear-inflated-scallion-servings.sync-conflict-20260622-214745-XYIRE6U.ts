/**
 * Clear inflated AI servings for scallions/spring onions
 * 
 * Issue: Scallions have AI-estimated servings of 150g/225g for medium/large,
 * when actual scallions should be 5-25g each.
 */

import { prisma } from '../src/lib/db';

async function main() {
    console.log('Investigating and clearing inflated scallion/spring onion servings...\n');

    // Find all AI-generated servings for scallions with inflated weights
    const inflatedServings = await prisma.fatSecretServingCache.findMany({
        where: {
            OR: [
                { food: { name: { contains: 'scallion', mode: 'insensitive' } } },
                { food: { name: { contains: 'spring onion', mode: 'insensitive' } } }
            ],
            source: { in: ['ai', 'ai_ambiguous'] },
            servingWeightGrams: { gt: 30 }, // Any serving >30g is suspicious for single scallion
            measurementDescription: { in: ['small', 'medium', 'large'] }
        },
        include: { food: { select: { name: true, id: true } } }
    });

    console.log(`Found ${inflatedServings.length} inflated scallion AI servings:\n`);

    for (const s of inflatedServings) {
        console.log(`  [${s.food.id}] ${s.food.name}`);
        console.log(`    "${s.measurementDescription}" = ${s.servingWeightGrams}g (source: ${s.source})`);
    }

    if (inflatedServings.length === 0) {
        console.log('✓ No inflated scallion servings found.');
        await prisma.$disconnect();
        return;
    }

    // Delete inflated servings
    console.log('\nDeleting inflated servings...');

    const idsToDelete = inflatedServings.map(s => s.id);
    const deleted = await prisma.fatSecretServingCache.deleteMany({
        where: { id: { in: idsToDelete } }
    });

    console.log(`✓ Deleted ${deleted.count} inflated AI servings`);

    // Also clear any related validated mappings that used these foods
    console.log('\nChecking for related validated mappings...');

    const affectedFoodIds = [...new Set(inflatedServings.map(s => s.food.id))];
    const relatedMappings = await prisma.validatedMapping.findMany({
        where: {
            OR: [
                { normalizedForm: { contains: 'scallion', mode: 'insensitive' } },
                { normalizedForm: { contains: 'spring onion', mode: 'insensitive' } }
            ]
        }
    });

    if (relatedMappings.length > 0) {
        console.log(`Found ${relatedMappings.length} related mappings:`);
        for (const m of relatedMappings) {
            console.log(`  "${m.normalizedForm}" → ${m.foodName} (${m.foodId})`);
        }

        // Clear mappings so re-mapping uses fresh serving data
        const deletedMappings = await prisma.validatedMapping.deleteMany({
            where: {
                OR: [
                    { normalizedForm: { contains: 'scallion', mode: 'insensitive' } },
                    { normalizedForm: { contains: 'spring onion', mode: 'insensitive' } }
                ]
            }
        });
        console.log(`✓ Deleted ${deletedMappings.count} related validated mappings`);
    }

    // Also clear AiNormalizeCache entries
    console.log('\nClearing related AiNormalizeCache entries...');
    const clearedNormalizeCache = await prisma.aiNormalizeCache.deleteMany({
        where: {
            OR: [
                { normalizedName: { contains: 'scallion', mode: 'insensitive' } },
                { normalizedName: { contains: 'spring onion', mode: 'insensitive' } }
            ]
        }
    });
    console.log(`✓ Cleared ${clearedNormalizeCache.count} AiNormalizeCache entries`);

    console.log('\n✅ Cleanup complete! Re-run pilot import to get fresh estimations.');

    await prisma.$disconnect();
}

main().catch(console.error);
