
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    console.log('--- Investigating 8 Tacos ---');

    const input = "8 tacos";
    console.log(`\nTesting "${input}"...`);
    const result = await mapIngredientWithFallback(input, { debug: true, skipCache: true });

    if (result) {
        console.log(`Result: "${result.foodName}" (ID: ${result.foodId})`);
        // console.log(result); // Inspect full object if needed
    } else {
        console.log("Result: NULL");
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
