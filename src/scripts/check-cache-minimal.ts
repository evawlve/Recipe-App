// Minimal database query - no extra imports to reduce logging
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: [] }); // Disable query logging

async function main() {
    console.log('=== ICE FOODS IN CACHE ===');
    const iceFoods = await prisma.fatSecretFoodCache.findMany({
        where: {
            name: { contains: 'ice', mode: 'insensitive' },
            NOT: { name: { contains: 'rice', mode: 'insensitive' } },
        },
        take: 15,
        select: { id: true, name: true, brandName: true },
    });
    if (iceFoods.length === 0) {
        console.log('NO ICE FOODS FOUND IN CACHE!');
    } else {
        for (const f of iceFoods) {
            console.log(`${f.id}: ${f.name} (${f.brandName || 'Generic'})`);
        }
    }
    console.log(`Total: ${iceFoods.length}`);

    console.log('\n=== HONEY EXACT MATCH ===');
    const honey = await prisma.fatSecretFoodCache.findFirst({
        where: { name: { equals: 'Honey', mode: 'insensitive' } },
        include: { servings: true },
    });
    if (honey) {
        console.log(`Food: ${honey.name} (ID: ${honey.id})`);
        for (const s of honey.servings) {
            const g = s.servingWeightGrams ?? s.metricServingAmount ?? 0;
            console.log(`  "${s.measurementDescription}" = ${g}g, units=${s.numberOfUnits}`);
        }
    } else {
        console.log('No Honey found');
    }

    console.log('\n=== MAYONNAISE EXACT MATCH ===');
    const mayo = await prisma.fatSecretFoodCache.findFirst({
        where: { name: { equals: 'Mayonnaise', mode: 'insensitive' } },
        include: { servings: true },
    });
    if (mayo) {
        console.log(`Food: ${mayo.name} (ID: ${mayo.id})`);
        for (const s of mayo.servings) {
            const g = s.servingWeightGrams ?? s.metricServingAmount ?? 0;
            console.log(`  "${s.measurementDescription}" = ${g}g, units=${s.numberOfUnits}`);
        }
    } else {
        console.log('No Mayonnaise found');
    }

    await prisma.$disconnect();
}

main().catch(console.error);
