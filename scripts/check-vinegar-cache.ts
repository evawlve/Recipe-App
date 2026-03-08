/**
 * Check and clear rice vinegar cache entries
 */
import { prisma } from '../src/lib/db';

async function main() {
    console.log('=== Rice Vinegar Cache Check ===\n');

    // Check ValidatedMapping
    const mappings = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'vinegar', mode: 'insensitive' } }
    });
    console.log('ValidatedMapping entries with "vinegar":', mappings.length);
    for (const m of mappings) {
        console.log(`  ${m.normalizedForm} -> ${m.foodName} | ${m.source} | conf:${m.aiConfidence}`);
    }

    // Check specifically for rice vinegar
    const riceVinegar = await prisma.validatedMapping.findMany({
        where: {
            OR: [
                { rawIngredient: { contains: 'rice vinegar', mode: 'insensitive' } },
                { normalizedForm: { contains: 'rice vinegar', mode: 'insensitive' } }
            ]
        }
    });
    console.log('\nSpecific rice vinegar entries:', riceVinegar.length);
    for (const m of riceVinegar) {
        console.log(`  raw: "${m.rawIngredient}" -> "${m.foodName}" | conf:${m.aiConfidence}`);
    }

    // Delete rice vinegar mappings if they exist with bad data
    if (riceVinegar.length > 0) {
        const deleted = await prisma.validatedMapping.deleteMany({
            where: {
                OR: [
                    { rawIngredient: { contains: 'rice vinegar', mode: 'insensitive' } },
                    { normalizedForm: { contains: 'rice vinegar', mode: 'insensitive' } }
                ]
            }
        });
        console.log(`\n✗ Deleted ${deleted.count} rice vinegar mappings`);
    }

    await prisma.$disconnect();
}

main();
