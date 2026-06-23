import { prisma } from '../src/lib/db';

async function main() {
    console.log('=== Clearing Red Pepper Flakes & Rice Vinegar Mappings ===\n');

    // Red pepper flakes
    const rpf = await prisma.validatedMapping.deleteMany({
        where: { normalizedForm: { contains: 'red pepper', mode: 'insensitive' } }
    });
    console.log('Red pepper mappings deleted:', rpf.count);

    // Rice vinegar
    const rv = await prisma.validatedMapping.deleteMany({
        where: { normalizedForm: { contains: 'rice vinegar', mode: 'insensitive' } }
    });
    console.log('Rice vinegar mappings deleted:', rv.count);

    // Also clear just "vinegar" to be safe
    const v = await prisma.validatedMapping.deleteMany({
        where: { normalizedForm: { equals: 'vinegar' } }
    });
    console.log('Vinegar mappings deleted:', v.count);

    console.log('\n✅ Complete!');
    await prisma.$disconnect();
}

main();
