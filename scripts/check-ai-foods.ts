import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const foods = await prisma.aiGeneratedFood.findMany();
    console.log(`\n=== AI Generated Foods: ${foods.length} ===`);
    for (const f of foods) {
        console.log(`  ${f.id}: "${f.ingredientName}" - ${f.caloriesPer100g}kcal/100g | P:${f.proteinPer100g} C:${f.carbsPer100g} F:${f.fatPer100g} | conf:${f.confidence} model:${f.model}`);
    }

    const servings = await prisma.aiGeneratedServing.findMany();
    console.log(`\n=== AI Generated Servings: ${servings.length} ===`);
    for (const s of servings) {
        console.log(`  ${s.id}: foodId=${s.aiGeneratedFoodId} "${s.unit}" = ${s.gramsPerUnit}g | conf:${s.confidence}`);
    }

    const maps = await prisma.ingredientFoodMap.findMany({
        where: { aiGeneratedFoodId: { not: null } },
    });
    console.log(`\n=== IngredientFoodMaps with AI food: ${maps.length} ===`);
    for (const m of maps) {
        console.log(`  ${m.id}: ingredientId=${m.ingredientId} aiGeneratedFoodId=${m.aiGeneratedFoodId} conf=${m.confidence}`);
    }

    await prisma.$disconnect();
}

main().catch(console.error);
