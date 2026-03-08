/**
 * Delete inflated scallion/spring onion servings with direct foodId query
 */

import { prisma } from '../src/lib/db';

async function main() {
    console.log('Checking scallion AI servings...\n');

    // Query by foodId 36451 which is "Scallions or Spring Onions" 
    const scallionServings = await prisma.fatSecretServingCache.findMany({
        where: {
            foodId: '36451',
            source: { in: ['ai', 'ai_ambiguous'] }
        },
        include: { food: { select: { name: true } } }
    });

    console.log(`Found ${scallionServings.length} AI servings for Scallions:`);
    for (const s of scallionServings) {
        const needsDelete = (s.servingWeightGrams || 0) > 30;
        console.log(`  ${s.measurementDescription} = ${s.servingWeightGrams}g ${needsDelete ? '← INFLATED' : ''}`);
    }

    // Delete any servings >30g for scallion sizes (single scallion should be 5-25g)
    const idsToDelete = scallionServings
        .filter(s => (s.servingWeightGrams || 0) > 30 && ['small', 'medium', 'large'].includes(s.measurementDescription || ''))
        .map(s => s.id);

    if (idsToDelete.length > 0) {
        console.log(`\nDeleting ${idsToDelete.length} inflated servings...`);
        const deleted = await prisma.fatSecretServingCache.deleteMany({
            where: { id: { in: idsToDelete } }
        });
        console.log(`✓ Deleted ${deleted.count} entries`);
    } else {
        console.log('\n✓ No inflated scallion servings to delete');
    }

    // Clear validated mappings for scallions to force re-mapping
    console.log('\nClearing scallion-related validated mappings...');
    const deletedMappings = await prisma.validatedMapping.deleteMany({
        where: {
            OR: [
                { normalizedForm: { contains: 'scallion', mode: 'insensitive' } },
                { normalizedForm: { contains: 'spring onion', mode: 'insensitive' } }
            ]
        }
    });
    console.log(`✓ Cleared ${deletedMappings.count} validated mappings`);

    console.log('\n✅ Done!');
    await prisma.$disconnect();
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
