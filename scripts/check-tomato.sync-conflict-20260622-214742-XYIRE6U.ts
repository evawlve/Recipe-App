import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function checkTomato() {
    // Check what tomato entries exist in cache
    const cached = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'tomato', mode: 'insensitive' } },
        select: { id: true, name: true, source: true },
        take: 15,
    });

    console.log('Cached tomato foods:\n');
    for (const f of cached) {
        const idType = f.id.startsWith('fdc_') ? 'FDC' : (/^\d+$/.test(f.id) ? 'FatSecret' : 'Unknown');
        console.log(`  [${f.id}] ${f.name} (${idType})`);
    }

    // Check if there's a ValidatedMapping for tomato
    console.log('\n\nValidatedMapping for tomato:');
    const mapping = await prisma.validatedMapping.findFirst({
        where: { rawIngredient: { contains: 'tomato', mode: 'insensitive' } },
    });

    if (mapping) {
        console.log(`  Raw: "${mapping.rawIngredient}"`);
        console.log(`  Food: ${mapping.foodName} (${mapping.foodId})`);
        console.log(`  Source: ${mapping.source}`);
    } else {
        console.log('  No mapping found');
    }
}

checkTomato()
    .then(() => prisma.$disconnect())
    .catch(e => { console.error(e); process.exit(1); });
