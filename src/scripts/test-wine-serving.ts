// Test wine mapping to understand serving selection issue
process.env.LOG_LEVEL = 'error';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: [] });

async function main() {
    // Check Red Table Wine servings
    console.log('=== RED TABLE WINE SERVINGS ===\n');

    const wine = await prisma.fatSecretFoodCache.findFirst({
        where: { name: { contains: 'Red Table Wine', mode: 'insensitive' } },
        include: { servings: true },
    });

    if (wine) {
        console.log(`Food: ${wine.name} (ID: ${wine.id})`);
        for (const s of wine.servings) {
            console.log(`  "${s.measurementDescription}"`);
            console.log(`    servingWeightGrams: ${s.servingWeightGrams}`);
            console.log(`    numberOfUnits: ${s.numberOfUnits}`);
            console.log(`    gramsPerUnit: ${(s.servingWeightGrams ?? 0) / (s.numberOfUnits ?? 1)}g`);
        }
    } else {
        console.log('No Red Table Wine found');

        // Try just "Wine"
        const anyWine = await prisma.fatSecretFoodCache.findMany({
            where: { name: { contains: 'wine', mode: 'insensitive' } },
            take: 5,
            include: { servings: true },
        });

        for (const w of anyWine) {
            console.log(`\n${w.name} (ID: ${w.id})`);
            for (const s of w.servings.slice(0, 3)) {
                console.log(`  "${s.measurementDescription}" = ${s.servingWeightGrams}g, numberOfUnits=${s.numberOfUnits}`);
            }
        }
    }

    // Check IngredientFoodMap for red wine
    console.log('\n=== RED WINE MAPPINGS ===\n');

    const wineMapping = await prisma.ingredientFoodMap.findMany({
        where: {
            ingredient: { name: { contains: 'red wine', mode: 'insensitive' } },
        },
        include: {
            ingredient: { select: { name: true, qty: true, unit: true } },
        },
        take: 3,
    });

    for (const m of wineMapping) {
        console.log(`"${m.ingredient.qty} ${m.ingredient.unit} ${m.ingredient.name}"`);
        console.log(`  -> foodId: ${m.fatsecretFoodId}, grams: ${m.fatsecretGrams}, servingId: ${m.fatsecretServingId}`);
    }

    await prisma.$disconnect();
}

main().catch(console.error);
