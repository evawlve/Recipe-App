/**
 * Quick script to check if problem mappings are from stale cache
 */
import { prisma } from '../src/lib/db';

async function main() {
    // Check for chilli peppers mapping
    const chilli = await prisma.validatedMapping.findFirst({
        where: {
            OR: [
                { normalizedForm: { contains: 'chilli' } },
                { rawIngredient: { contains: 'chilli' } },
            ]
        },
        select: {
            id: true,
            normalizedForm: true,
            rawIngredient: true,
            foodName: true,
            createdAt: true,
            updatedAt: true,
        }
    });
    console.log('\n=== Chilli Peppers Mapping ===');
    console.log(chilli ? JSON.stringify(chilli, null, 2) : 'NOT FOUND');

    // Check for mint mapping  
    const mint = await prisma.validatedMapping.findFirst({
        where: {
            normalizedForm: { contains: 'mint' }
        },
        select: {
            id: true,
            normalizedForm: true,
            rawIngredient: true,
            foodName: true,
            createdAt: true,
        }
    });
    console.log('\n=== Mint Mapping ===');
    console.log(mint ? JSON.stringify(mint, null, 2) : 'NOT FOUND');

    // Check for cucumber mapping
    const cucumber = await prisma.validatedMapping.findFirst({
        where: {
            normalizedForm: { contains: 'cucumber' }
        },
        select: {
            id: true,
            normalizedForm: true,
            foodName: true,
            createdAt: true,
        }
    });
    console.log('\n=== Cucumber Mapping ===');
    console.log(cucumber ? JSON.stringify(cucumber, null, 2) : 'NOT FOUND');

    // Check for red lentils mapping (bad nutrition)
    const lentils = await prisma.validatedMapping.findFirst({
        where: {
            normalizedForm: { contains: 'lentil' }
        },
        select: {
            id: true,
            normalizedForm: true,
            foodName: true,
            createdAt: true,
        }
    });
    console.log('\n=== Red Lentils Mapping ===');
    console.log(lentils ? JSON.stringify(lentils, null, 2) : 'NOT FOUND');

    // Count total mappings and when they were created
    const totalCount = await prisma.validatedMapping.count();
    const recentCount = await prisma.validatedMapping.count({
        where: {
            createdAt: {
                gte: new Date('2026-01-12T00:00:00Z')
            }
        }
    });
    console.log(`\n=== Summary ===`);
    console.log(`Total mappings: ${totalCount}`);
    console.log(`Created on/after Jan 12: ${recentCount}`);
    console.log(`Created before Jan 12: ${totalCount - recentCount}`);

    await prisma.$disconnect();
}

main().catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
});
