
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    console.log('--- Investigating Pilot Findings ---');

    // 1. Check STRAWBERRY (TONY'S)
    console.log('\n1. Searching for "STRAWBERRY (TONY\'S)" in DB...');
    const badStrawberry = await prisma.fatSecretFoodCache.findFirst({
        where: { name: { contains: "STRAWBERRY (TONY'S)", mode: 'insensitive' } }
    });

    if (badStrawberry) {
        console.log('Found suspiciously high carb strawberry:', badStrawberry);
        console.log('Nutrients:', badStrawberry.nutrientsPer100g);
    } else {
        console.log('Could not find specific "STRAWBERRY (TONY\'S)" in DB by name.');
    }

    // 2. Debug "8 tacos"
    console.log('\n2. Debugging "8 tacos"...');
    const tacoResult = await mapIngredientWithFallback("8 tacos", { debug: true });
    console.log('Taco Result:', JSON.stringify(tacoResult, null, 2));

    // 3. Debug "egg beaters"
    console.log('\n3. Debugging "0.5 cup egg beaters"...');
    const eggResult = await mapIngredientWithFallback("0.5 cup egg beaters", { debug: true });
    console.log('Egg Result:', JSON.stringify(eggResult, null, 2));

}

main().catch(console.error).finally(() => prisma.$disconnect());
