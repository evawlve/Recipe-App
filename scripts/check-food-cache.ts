import { prisma } from '../src/lib/db';

async function main() {
    console.log('=== Checking Food Cache ===\n');

    // Rice vinegar
    const riceVinegar = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'rice vinegar', mode: 'insensitive' } },
        take: 10
    });
    console.log('Rice Vinegar entries:', riceVinegar.length);
    riceVinegar.forEach(f => {
        const n = f.nutrientsPer100g as any;
        console.log(' -', f.name, '|', f.brandName || 'Generic', '|', n?.calories, 'kcal');
    });

    // Also check for just 'vinegar'
    const vinegar = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'vinegar', mode: 'insensitive' } },
        take: 10
    });
    console.log('\nVinegar entries:', vinegar.length);
    vinegar.slice(0, 5).forEach(f => {
        const n = f.nutrientsPer100g as any;
        console.log(' -', f.name, '|', f.brandName || 'Generic', '|', n?.calories, 'kcal');
    });

    // Pepper flakes
    const pepperFlakes = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'pepper flakes', mode: 'insensitive' } },
        take: 10
    });
    console.log('\nPepper Flakes entries:', pepperFlakes.length);
    pepperFlakes.forEach(f => {
        const n = f.nutrientsPer100g as any;
        console.log(' -', f.name, '|', f.brandName || 'Generic', '|', n?.calories, 'kcal');
    });

    // Check for crushed red pepper
    const crushedRed = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'crushed red pepper', mode: 'insensitive' } },
        take: 5
    });
    console.log('\nCrushed Red Pepper entries:', crushedRed.length);
    crushedRed.forEach(f => {
        const n = f.nutrientsPer100g as any;
        console.log(' -', f.name, '|', f.brandName || 'Generic', '|', n?.calories, 'kcal');
    });

    await prisma.$disconnect();
}

main();
