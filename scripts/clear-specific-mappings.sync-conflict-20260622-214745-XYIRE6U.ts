/**
 * Clear specific cached mappings for ground chuck and tacos to test pipeline
 */
import { prisma } from '../src/lib/db';

async function clearSpecificMappings() {
    console.log('🧹 Clearing specific mappings for testing...\n');

    // Clear ground chuck mappings
    const groundChuckResult = await prisma.validatedMapping.deleteMany({
        where: {
            normalizedName: {
                contains: 'ground chuck',
                mode: 'insensitive',
            },
        },
    });
    console.log(`✓ Ground chuck mappings cleared: ${groundChuckResult.count}`);

    // Clear taco mappings
    const tacoResult = await prisma.validatedMapping.deleteMany({
        where: {
            OR: [
                { normalizedName: { contains: 'taco', mode: 'insensitive' } },
                { rawIngredient: { contains: 'taco', mode: 'insensitive' } },
            ],
        },
    });
    console.log(`✓ Taco mappings cleared: ${tacoResult.count}`);

    // Clear crushed red pepper mappings
    const pepperResult = await prisma.validatedMapping.deleteMany({
        where: {
            normalizedName: {
                contains: 'crushed red pepper',
                mode: 'insensitive',
            },
        },
    });
    console.log(`✓ Crushed red pepper mappings cleared: ${pepperResult.count}`);

    console.log('\n✅ Done! Run debug-mapping-issue.ts to see fresh pipeline results.');
}

clearSpecificMappings()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
