/**
 * Check cached mappings for chocolate and quinoa to understand what's being cached
 */
import { prisma } from '../src/lib/db';

async function checkCachedMappings() {
    console.log('=== Checking Chocolate Mappings ===\n');

    const chocolateMappings = await prisma.validatedMapping.findMany({
        where: {
            normalizedForm: {
                contains: 'chocolate',
                mode: 'insensitive',
            },
        },
        select: {
            normalizedForm: true,
            foodName: true,
            createdAt: true,
        },
        take: 10,
    });

    console.log('Chocolate entries:');
    for (const m of chocolateMappings) {
        console.log(`  "${m.normalizedForm}" → "${m.foodName}" (${m.createdAt.toISOString()})`);
    }

    console.log('\n=== Checking Quinoa Mappings ===\n');

    const quinoaMappings = await prisma.validatedMapping.findMany({
        where: {
            normalizedForm: {
                contains: 'quinoa',
                mode: 'insensitive',
            },
        },
        select: {
            normalizedForm: true,
            foodName: true,
            createdAt: true,
        },
        take: 10,
    });

    console.log('Quinoa entries:');
    for (const m of quinoaMappings) {
        console.log(`  "${m.normalizedForm}" → "${m.foodName}" (${m.createdAt.toISOString()})`);
    }

    console.log('\n=== Checking Dark Chocolate Specifically ===\n');

    const darkChocMappings = await prisma.validatedMapping.findMany({
        where: {
            normalizedForm: {
                contains: 'dark chocolate',
                mode: 'insensitive',
            },
        },
        select: {
            normalizedForm: true,
            foodName: true,
            createdAt: true,
        },
        take: 10,
    });

    console.log('Dark chocolate entries:');
    for (const m of darkChocMappings) {
        console.log(`  "${m.normalizedForm}" → "${m.foodName}" (${m.createdAt.toISOString()})`);
    }
}

checkCachedMappings()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
