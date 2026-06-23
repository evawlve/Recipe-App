import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { mapIngredientWithFallback } from "../src/lib/fatsecret/map-ingredient-with-fallback";

const prisma = new PrismaClient();

const testItems = [
    "4 sprays butter cooking spray",
    "1 cup sour cream",
    "Palm Sugar",
    "Tortilla Chips",
    "fried shallots",
    "pitted cherries",
    "sherry wine",
    "Protein Powder",
    "honey",
    "1 packet sweetener",
    "4 parsley flakes",
    "1 tbsp oil",
    "Salt and Pepper",
];

async function main() {
    const report = [];
    for (const item of testItems) {
        console.log(`\n\n=== Testing: "${item}" ===`);
        const result = await mapIngredientWithFallback(item);
        if (result && !('status' in result)) {
            report.push({ test: item, status: 'SUCCESS', result: { foodName: result.foodName, grams: result.grams, kcal: result.kcal, serving: result.servingDescription } });
        } else {
            report.push({ test: item, status: 'FAILED' });
        }
    }
    require('fs').writeFileSync('tmp/heuristics-report.json', JSON.stringify(report, null, 2));
    await prisma.$disconnect();
}

main().catch(console.error);
