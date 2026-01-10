import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function checkBadIds() {
    // Look for entries with 'fdc_' prefix in FatSecretFoodCache that are tomatoes
    const fdcInCache = await prisma.fatSecretFoodCache.findMany({
        where: {
            id: { startsWith: 'fdc_' },
            name: { contains: 'tomato', mode: 'insensitive' }
        },
        take: 10,
    });

    console.log('FDC tomatoes in FatSecretFoodCache:', fdcInCache.length);
    for (const f of fdcInCache) {
        console.log('  ' + f.id + ': ' + f.name);
    }

    // Check if any ValidatedMapping has an FDC ID for tomato
    const fdcMappings = await prisma.validatedMapping.findMany({
        where: {
            foodId: { startsWith: 'fdc_' },
            rawIngredient: { contains: 'tomato', mode: 'insensitive' }
        },
    });

    console.log('\nFDC tomato ValidatedMappings:', fdcMappings.length);
    for (const m of fdcMappings) {
        console.log('  ' + m.rawIngredient + ' -> ' + m.foodId);
    }
}

checkBadIds()
    .then(() => prisma.$disconnect())
    .catch(e => { console.error(e); process.exit(1); });
