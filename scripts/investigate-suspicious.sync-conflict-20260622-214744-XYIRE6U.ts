
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    console.log('--- Investigating Suspicious Mappings ---');

    const cases = [
        { input: "8 tacos", note: "Mapped to 'nachos taco bell' in pilot" },
        { input: "1 dash pepper", note: "Mapped to 'PEPPERS' (likely vegetable) instead of black pepper" }
    ];

    for (const c of cases) {
        console.log(`\nTesting "${c.input}"...`);
        const result = await mapIngredientWithFallback(c.input, { debug: true, skipCache: true });
        if (result) {
            console.log(`Result: "${result.foodName}" (ID: ${result.foodId}, Brand: ${result.brandName})`);
            console.log(`Macros per 100g: ${result.calories}kcal, P:${result.protein}, C:${result.carbs}, F:${result.fat}`);
        } else {
            console.log("Result: NULL");
        }
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
