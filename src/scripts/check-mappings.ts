// Check actual mappings for honey/mayo/sugar
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: [] });

async function main() {
    console.log('=== HONEY MAPPINGS ===');
    const honeyMaps = await prisma.ingredientFoodMap.findMany({
        where: {
            ingredient: { name: { contains: 'honey', mode: 'insensitive' } },
        },
        include: { ingredient: { select: { name: true, qty: true, unit: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
    });
    for (const m of honeyMaps) {
        console.log(`"${m.ingredient.qty} ${m.ingredient.unit} ${m.ingredient.name}"`);
        console.log(`  -> foodId: ${m.fatsecretFoodId}, grams: ${m.fatsecretGrams}, servingId: ${m.fatsecretServingId}`);
        console.log(`  -> source: ${m.fatsecretSource}, confidence: ${m.confidence}`);
    }

    console.log('\n=== MAYONNAISE MAPPINGS ===');
    const mayoMaps = await prisma.ingredientFoodMap.findMany({
        where: {
            ingredient: { name: { contains: 'mayonnaise', mode: 'insensitive' } },
        },
        include: { ingredient: { select: { name: true, qty: true, unit: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
    });
    for (const m of mayoMaps) {
        console.log(`"${m.ingredient.qty} ${m.ingredient.unit} ${m.ingredient.name}"`);
        console.log(`  -> foodId: ${m.fatsecretFoodId}, grams: ${m.fatsecretGrams}, servingId: ${m.fatsecretServingId}`);
        console.log(`  -> source: ${m.fatsecretSource}, confidence: ${m.confidence}`);
    }

    console.log('\n=== SUGAR MAPPINGS ===');
    const sugarMaps = await prisma.ingredientFoodMap.findMany({
        where: {
            ingredient: { name: { contains: 'sugar', mode: 'insensitive' } },
        },
        include: { ingredient: { select: { name: true, qty: true, unit: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
    });
    for (const m of sugarMaps) {
        console.log(`"${m.ingredient.qty} ${m.ingredient.unit} ${m.ingredient.name}"`);
        console.log(`  -> foodId: ${m.fatsecretFoodId}, grams: ${m.fatsecretGrams}, servingId: ${m.fatsecretServingId}`);
        console.log(`  -> source: ${m.fatsecretSource}, confidence: ${m.confidence}`);
    }

    console.log('\n=== ICE MAPPINGS ===');
    const iceMaps = await prisma.ingredientFoodMap.findMany({
        where: {
            ingredient: { name: { contains: 'ice', mode: 'insensitive' } },
        },
        include: { ingredient: { select: { name: true, qty: true, unit: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
    });
    for (const m of iceMaps) {
        console.log(`"${m.ingredient.qty} ${m.ingredient.unit} ${m.ingredient.name}"`);
        console.log(`  -> foodId: ${m.fatsecretFoodId}, grams: ${m.fatsecretGrams}, servingId: ${m.fatsecretServingId}`);
        console.log(`  -> source: ${m.fatsecretSource}, confidence: ${m.confidence}`);
    }

    await prisma.$disconnect();
}

main().catch(console.error);
