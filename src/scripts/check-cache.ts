// Simple database query to check ice and serving data
import { prisma } from '../lib/db';

async function main() {
    // Check ICE foods in cache
    console.log('\n=== ICE FOODS IN CACHE ===\n');
    const iceFoods = await prisma.fatSecretFoodCache.findMany({
        where: {
            name: { contains: 'ice', mode: 'insensitive' },
            NOT: { name: { contains: 'rice', mode: 'insensitive' } },
        },
        take: 15,
        select: { id: true, name: true, brandName: true },
    });
    for (const f of iceFoods) {
        console.log(`${f.id}: ${f.name} (${f.brandName || 'Generic'})`);
    }
    console.log(`\nTotal: ${iceFoods.length} ice foods (excluding rice)`);

    // Check RICE candidates that might match "ice" 
    console.log('\n=== RICE FOODS IN CACHE ===\n');
    const riceFoods = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'Rice', mode: 'insensitive' } },
        take: 10,
        select: { id: true, name: true, brandName: true },
    });
    for (const f of riceFoods) {
        console.log(`${f.id}: ${f.name} (${f.brandName || 'Generic'})`);
    }

    // Check Honey servings
    console.log('\n=== HONEY SERVINGS ===\n');
    const honeyServings = await prisma.fatSecretServingCache.findMany({
        where: { food: { name: { equals: 'Honey', mode: 'insensitive' } } },
        include: { food: { select: { id: true, name: true, brandName: true } } },
        take: 10,
    });
    for (const s of honeyServings) {
        const grams = s.servingWeightGrams ?? s.metricServingAmount ?? 0;
        console.log(`${s.food.name} (${s.food.id}): "${s.measurementDescription}" = ${grams}g, numberOfUnits=${s.numberOfUnits}`);
    }

    // Check Mayonnaise servings
    console.log('\n=== MAYONNAISE SERVINGS ===\n');
    const mayoServings = await prisma.fatSecretServingCache.findMany({
        where: { food: { name: { contains: 'Mayonnaise', mode: 'insensitive' } } },
        include: { food: { select: { id: true, name: true, brandName: true } } },
        take: 10,
    });
    for (const s of mayoServings) {
        const grams = s.servingWeightGrams ?? s.metricServingAmount ?? 0;
        console.log(`${s.food.name} (${s.food.id}): "${s.measurementDescription}" = ${grams}g, numberOfUnits=${s.numberOfUnits}`);
    }

    // Check Sugar servings - specifically look for Granulated Sugar
    console.log('\n=== GRANULATED SUGAR SERVINGS ===\n');
    const sugarServings = await prisma.fatSecretServingCache.findMany({
        where: { food: { name: { contains: 'Granulated Sugar', mode: 'insensitive' } } },
        include: { food: { select: { id: true, name: true, brandName: true } } },
        take: 10,
    });
    for (const s of sugarServings) {
        const grams = s.servingWeightGrams ?? s.metricServingAmount ?? 0;
        console.log(`${s.food.name} (${s.food.id}): "${s.measurementDescription}" = ${grams}g, numberOfUnits=${s.numberOfUnits}`);
    }

    await prisma.$disconnect();
}

main().catch(console.error);
