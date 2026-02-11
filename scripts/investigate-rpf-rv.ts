/**
 * Deep investigation into red pepper flakes and rice vinegar mapping failures
 */

import { prisma } from '../src/lib/db';

async function main() {
    console.log('=== Deep Investigation: Red Pepper Flakes & Rice Vinegar ===\n');

    // ===============================================
    // RED PEPPER FLAKES
    // ===============================================
    console.log('--- RED PEPPER FLAKES ---\n');

    // Check ValidatedMapping
    const rpfMapping = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'pepper', mode: 'insensitive' } },
        take: 10
    });
    console.log('ValidatedMapping entries with "pepper":', rpfMapping.length);
    rpfMapping.forEach(m => {
        console.log(`  - "${m.normalizedForm}" -> "${m.foodName}" (${m.brandName || 'Generic'}) conf:${m.aiConfidence}`);
    });

    // Check FatSecretFoodCache for flakes
    const rpfCache = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'pepper flakes', mode: 'insensitive' } },
        take: 10
    });
    console.log('\nFatSecretFoodCache with "pepper flakes":', rpfCache.length);
    rpfCache.forEach(f => {
        const n = f.nutrientsPer100g as any;
        console.log(`  - [${f.id}] ${f.name} | ${f.brandName || 'Generic'} | ${n?.calories ?? 'null'}kcal | P:${n?.protein ?? 'null'} C:${n?.carbs ?? 'null'} F:${n?.fat ?? 'null'}`);
    });

    // Check for crushed red pepper
    const crushedCache = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'crushed red pepper', mode: 'insensitive' } },
        take: 10
    });
    console.log('\nFatSecretFoodCache with "crushed red pepper":', crushedCache.length);
    crushedCache.forEach(f => {
        const n = f.nutrientsPer100g as any;
        console.log(`  - [${f.id}] ${f.name} | ${f.brandName || 'Generic'} | ${n?.calories ?? 'null'}kcal`);
    });

    // ===============================================
    // RICE VINEGAR
    // ===============================================
    console.log('\n\n--- RICE VINEGAR ---\n');

    // Check ValidatedMapping
    const rvMapping = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'vinegar', mode: 'insensitive' } },
        take: 10
    });
    console.log('ValidatedMapping entries with "vinegar":', rvMapping.length);
    rvMapping.forEach(m => {
        console.log(`  - "${m.normalizedForm}" -> "${m.foodName}" (${m.brandName || 'Generic'}) conf:${m.aiConfidence}`);
    });

    // Check FatSecretFoodCache
    const rvCache = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'rice vinegar', mode: 'insensitive' } },
        take: 10
    });
    console.log('\nFatSecretFoodCache with "rice vinegar":', rvCache.length);
    rvCache.forEach(f => {
        const n = f.nutrientsPer100g as any;
        console.log(`  - [${f.id}] ${f.name} | ${f.brandName || 'Generic'} | ${n?.calories ?? 'null'}kcal | P:${n?.protein ?? 'null'} C:${n?.carbs ?? 'null'} F:${n?.fat ?? 'null'}`);
    });

    // Check for any vinegar
    const anyVinegar = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'vinegar', mode: 'insensitive' } },
        take: 15
    });
    console.log('\nFatSecretFoodCache with "vinegar" (any):', anyVinegar.length);
    anyVinegar.forEach(f => {
        const n = f.nutrientsPer100g as any;
        console.log(`  - [${f.id}] ${f.name} | ${f.brandName || 'Generic'} | ${n?.calories ?? 'null'}kcal`);
    });

    // ===============================================
    // Check FDC too
    // ===============================================
    console.log('\n\n--- FDC CACHE ---\n');

    const fdcVinegar = await prisma.fdcFoodCache.findMany({
        where: { description: { contains: 'vinegar', mode: 'insensitive' } },
        take: 10
    });
    console.log('FdcFoodCache with "vinegar":', fdcVinegar.length);
    fdcVinegar.forEach(f => {
        const n = f.nutrients as any;
        console.log(`  - [${f.id}] ${f.description} | ${f.dataType} | ${n?.calories ?? 'null'}kcal`);
    });

    const fdcPepper = await prisma.fdcFoodCache.findMany({
        where: { description: { contains: 'pepper', mode: 'insensitive' } },
        take: 10
    });
    console.log('\nFdcFoodCache with "pepper":', fdcPepper.length);
    fdcPepper.forEach(f => {
        const n = f.nutrients as any;
        console.log(`  - [${f.id}] ${f.description} | ${f.dataType} | ${n?.calories ?? 'null'}kcal`);
    });

    await prisma.$disconnect();
}

main();
