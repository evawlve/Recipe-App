/**
 * Check why valid RICE VINEGAR entry isn't being selected
 */
import { prisma } from '../src/lib/db';
import { hasNullOrInvalidMacros } from '../src/lib/fatsecret/filter-candidates';

async function main() {
    console.log('=== RICE VINEGAR Investigation ===\n');

    // Find the valid rice vinegar entry
    const riceVinegar = await prisma.fdcFoodCache.findMany({
        where: {
            AND: [
                { description: { contains: 'rice', mode: 'insensitive' } },
                { description: { contains: 'vinegar', mode: 'insensitive' } }
            ]
        }
    });
    console.log('FDC "rice vinegar" entries:', riceVinegar.length);
    riceVinegar.forEach(f => {
        const n = f.nutrients as any;
        const invalid = hasNullOrInvalidMacros(n);
        console.log(`  [${f.id}] ${f.description} | ${f.dataType}`);
        console.log(`     kcal:${n?.calories} P:${n?.protein} C:${n?.carbs} F:${n?.fat}`);
        console.log(`     hasNullOrInvalidMacros: ${invalid}`);
    });

    // Also check FatSecret
    const fsRiceVinegar = await prisma.fatSecretFoodCache.findMany({
        where: {
            AND: [
                { name: { contains: 'rice', mode: 'insensitive' } },
                { name: { contains: 'vinegar', mode: 'insensitive' } }
            ]
        }
    });
    console.log('\nFatSecret "rice vinegar" entries:', fsRiceVinegar.length);
    fsRiceVinegar.forEach(f => {
        const n = f.nutrientsPer100g as any;
        const invalid = hasNullOrInvalidMacros(n);
        console.log(`  [${f.id}] ${f.name} | ${f.brandName || 'Generic'}`);
        console.log(`     kcal:${n?.calories} P:${n?.protein} C:${n?.carbs} F:${n?.fat}`);
        console.log(`     hasNullOrInvalidMacros: ${invalid}`);
    });

    await prisma.$disconnect();
}

main();
