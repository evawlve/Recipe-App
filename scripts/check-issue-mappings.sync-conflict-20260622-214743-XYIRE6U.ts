import { prisma } from '../src/lib/db';

async function main() {
    // Check Green Onion mappings
    const goMappings = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'green onion', mode: 'insensitive' } }
    });
    console.log('GREEN ONION MAPPINGS:');
    for (const m of goMappings) console.log(`  "${m.normalizedForm}" → ${m.foodName} (${m.foodId})`);

    // Check Red Pepper Flakes mappings
    const rpfMappings = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'pepper flakes', mode: 'insensitive' } }
    });
    console.log('\nRED PEPPER FLAKES MAPPINGS:');
    for (const m of rpfMappings) console.log(`  "${m.normalizedForm}" → ${m.foodName} (${m.foodId})`);

    // Check Rice Vinegar mappings
    const rvMappings = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'rice vinegar', mode: 'insensitive' } }
    });
    console.log('\nRICE VINEGAR MAPPINGS:');
    for (const m of rvMappings) console.log(`  "${m.normalizedForm}" → ${m.foodName} (${m.foodId})`);

    // Check Jalapeno mappings
    const jMappings = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'jalap', mode: 'insensitive' } }
    });
    console.log('\nJALAPENO MAPPINGS:');
    for (const m of jMappings) console.log(`  "${m.normalizedForm}" → ${m.foodName} (${m.foodId})`);

    // Check Palm Sugar mappings
    const psMappings = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'palm sugar', mode: 'insensitive' } }
    });
    console.log('\nPALM SUGAR MAPPINGS:');
    for (const m of psMappings) console.log(`  "${m.normalizedForm}" → ${m.foodName} (${m.foodId})`);

    await prisma.$disconnect();
}
main();
