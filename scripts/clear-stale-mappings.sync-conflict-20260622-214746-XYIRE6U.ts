/**
 * Clear WRONG ValidatedMapping entries for banana/onion
 * Only delete mappings to Banana Peppers or Green Onion when the raw ingredient
 * doesn't explicitly mention those.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('\n=== Checking for Bad ValidatedMappings ===\n');

    // Find BAD banana mappings (mapped to Banana Peppers instead of Banana fruit)
    const badBananaMappings = await prisma.validatedMapping.findMany({
        where: {
            rawIngredient: { contains: 'banana', mode: 'insensitive' },
            foodName: { contains: 'pepper', mode: 'insensitive' },
            NOT: {
                rawIngredient: { contains: 'pepper', mode: 'insensitive' },
            },
        },
        select: { id: true, rawIngredient: true, foodName: true },
    });

    console.log(`Found ${badBananaMappings.length} BAD banana→pepper mappings:`);
    for (const m of badBananaMappings) {
        console.log(`  ✗ "${m.rawIngredient}" → "${m.foodName}"`);
    }

    // Find BAD onion mappings (mapped to Green Onion when not explicitly requested)
    const badOnionMappings = await prisma.validatedMapping.findMany({
        where: {
            rawIngredient: { contains: 'onion', mode: 'insensitive' },
            foodName: { contains: 'green', mode: 'insensitive' },
            NOT: {
                rawIngredient: { contains: 'green', mode: 'insensitive' },
            },
        },
        select: { id: true, rawIngredient: true, foodName: true },
    });

    console.log(`\nFound ${badOnionMappings.length} BAD onion→green onion mappings:`);
    for (const m of badOnionMappings) {
        console.log(`  ✗ "${m.rawIngredient}" → "${m.foodName}"`);
    }

    const idsToDelete = [
        ...badBananaMappings.map(m => m.id),
        ...badOnionMappings.map(m => m.id),
    ];

    if (idsToDelete.length > 0) {
        console.log(`\nDeleting ${idsToDelete.length} bad mappings...`);

        await prisma.validatedMapping.deleteMany({
            where: { id: { in: idsToDelete } },
        });

        console.log('Done!');
    } else {
        console.log('\n✓ No bad mappings found - all looks good!');
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
