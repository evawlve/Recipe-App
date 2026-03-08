/**
 * Clear bad cached mappings for dark chocolate 70% and quinoa
 * These cached entries mapped to wrong products
 */
import { prisma } from '../src/lib/db';

async function clearBadMappings() {
    console.log('🧹 Clearing bad cached mappings...\n');

    // Clear 70% dark chocolate mappings that went to generic "Sweet or Dark Chocolate"
    const chocResult = await prisma.validatedMapping.deleteMany({
        where: {
            normalizedForm: {
                contains: 'dark chocolate',
                mode: 'insensitive',
            },
            foodName: 'Sweet or Dark Chocolate',
        },
    });
    console.log(`✓ Deleted ${chocResult.count} bad dark chocolate → "Sweet or Dark Chocolate" mappings`);

    // Clear quinoa mappings that went to dry QUINOA instead of cooked
    const quinoaDryResult = await prisma.validatedMapping.deleteMany({
        where: {
            normalizedForm: {
                contains: 'quinoa',
                mode: 'insensitive',
            },
            foodName: 'QUINOA',  // This is dry quinoa
        },
    });
    console.log(`✓ Deleted ${quinoaDryResult.count} bad quinoa → "QUINOA" (dry) mappings`);

    console.log('\n✅ Done! Re-run pilot import to get fresh mappings.');
}

clearBadMappings()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
