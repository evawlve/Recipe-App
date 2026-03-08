/**
 * Check all red pepper/crushed entries for data quality
 */
import { prisma } from '../src/lib/db';
import { hasNullOrInvalidMacros } from '../src/lib/fatsecret/filter-candidates';

async function main() {
    console.log('=== Red Pepper Data Quality Check ===\n');

    // FDC - crushed red pepper
    const fdcCrushed = await prisma.fdcFoodCache.findMany({
        where: { description: { contains: 'crushed', mode: 'insensitive' } }
    });
    console.log('FDC with "crushed":', fdcCrushed.length);
    for (const f of fdcCrushed) {
        const n = f.nutrients as any;
        const nutr = { calories: n?.calories, protein: n?.protein, carbs: n?.carbs, fat: n?.fat };
        const invalid = hasNullOrInvalidMacros(nutr);
        console.log(`  [${f.id}] ${f.description} | ${f.dataType}`);
        console.log(`     kcal:${n?.calories ?? 'null'} P:${n?.protein ?? 'null'} C:${n?.carbs ?? 'null'} F:${n?.fat ?? 'null'} | INVALID:${invalid}`);
    }

    // FatSecret - crushed red pepper
    const fsCrushed = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'crushed red pepper', mode: 'insensitive' } }
    });
    console.log('\nFatSecret with "crushed red pepper":', fsCrushed.length);
    for (const f of fsCrushed) {
        const n = f.nutrientsPer100g as any;
        const nutr = { calories: n?.calories, protein: n?.protein, carbs: n?.carbs, fat: n?.fat };
        const invalid = hasNullOrInvalidMacros(nutr);
        console.log(`  [${f.id}] ${f.name} | ${f.brandName || 'Generic'}`);
        console.log(`     kcal:${n?.calories ?? 'null'} P:${n?.protein ?? 'null'} C:${n?.carbs ?? 'null'} F:${n?.fat ?? 'null'} | INVALID:${invalid}`);
    }

    // Check cayenne as alternative
    const fdcCayenne = await prisma.fdcFoodCache.findMany({
        where: { description: { contains: 'cayenne', mode: 'insensitive' } },
        take: 5
    });
    console.log('\nFDC with "cayenne":', fdcCayenne.length);
    for (const f of fdcCayenne) {
        const n = f.nutrients as any;
        const nutr = { calories: n?.calories, protein: n?.protein, carbs: n?.carbs, fat: n?.fat };
        const invalid = hasNullOrInvalidMacros(nutr);
        console.log(`  [${f.id}] ${f.description} | ${f.dataType}`);
        console.log(`     kcal:${n?.calories ?? 'null'} P:${n?.protein ?? 'null'} C:${n?.carbs ?? 'null'} F:${n?.fat ?? 'null'} | INVALID:${invalid}`);
    }

    await prisma.$disconnect();
}

main();
