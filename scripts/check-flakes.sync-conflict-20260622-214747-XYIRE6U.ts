import { prisma } from '../src/lib/db';

async function main() {
    console.log('=== Red Pepper Flakes / Crushed Red Pepper Entries ===\n');

    // FatSecret - flakes
    const fsFlakes = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'flakes', mode: 'insensitive' } }
    });
    console.log('FatSecret with "flakes":', fsFlakes.length);
    fsFlakes.slice(0, 5).forEach(f => {
        const n = f.nutrientsPer100g as any;
        console.log(`  [${f.id}] ${f.name} | ${n?.calories ?? 'null'}kcal`);
    });

    // FDC - flakes
    const fdcFlakes = await prisma.fdcFoodCache.findMany({
        where: { description: { contains: 'flakes', mode: 'insensitive' } }
    });
    console.log('\nFDC with "flakes":', fdcFlakes.length);
    fdcFlakes.slice(0, 5).forEach(f => {
        const n = f.nutrients as any;
        console.log(`  [${f.id}] ${f.description} | ${n?.calories ?? 'null'}kcal`);
    });

    // FatSecret - crushed red pepper
    const fsCrushed = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'crushed red pepper', mode: 'insensitive' } }
    });
    console.log('\nFatSecret with "crushed red pepper":', fsCrushed.length);
    fsCrushed.forEach(f => {
        const n = f.nutrientsPer100g as any;
        console.log(`  [${f.id}] ${f.name} | ${f.brandName || 'Generic'} | ${n?.calories ?? 'null'}kcal`);
    });

    // FDC - crushed red pepper
    const fdcCrushed = await prisma.fdcFoodCache.findMany({
        where: { description: { contains: 'crushed red pepper', mode: 'insensitive' } }
    });
    console.log('\nFDC with "crushed red pepper":', fdcCrushed.length);
    fdcCrushed.forEach(f => {
        const n = f.nutrients as any;
        console.log(`  [${f.id}] ${f.description} | ${f.dataType} | ${n?.calories ?? 'null'}kcal`);
    });

    await prisma.$disconnect();
}

main();
