import { prisma } from '../src/lib/db';

async function main() {
    console.log('=== Checking ValidatedMappings ===\n');

    // Red pepper
    const redPepper = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'red pepper', mode: 'insensitive' } }
    });
    console.log('Red Pepper mappings:');
    redPepper.forEach(m => console.log(`  "${m.normalizedForm}" -> "${m.foodName}" | ${m.brandName || 'Generic'} | conf:${m.aiConfidence}`));

    // Vinegar
    const vinegar = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'vinegar', mode: 'insensitive' } }
    });
    console.log('\nVinegar mappings:');
    vinegar.forEach(m => console.log(`  "${m.normalizedForm}" -> "${m.foodName}" | ${m.brandName || 'Generic'} | conf:${m.aiConfidence}`));

    // Rice
    const rice = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'rice', mode: 'insensitive' } },
        take: 10
    });
    console.log('\nRice mappings (sample):');
    rice.forEach(m => console.log(`  "${m.normalizedForm}" -> "${m.foodName}" | ${m.brandName || 'Generic'}`));

    await prisma.$disconnect();
}
main();
