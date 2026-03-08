import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { getCachedFoodWithRelations, cacheFoodToDetails } from '../src/lib/fatsecret/cache-search';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

// Check why Mangos hydration fails and falls back to Mango Chunks
async function main() {
    console.log('\n=== Why Mangos Hydration Fails ===\n');

    // Check Mangos (35863) servings
    const mangos = await getCachedFoodWithRelations('35863');
    if (mangos) {
        console.log(`Mangos (35863) in cache: YES`);
        const details = cacheFoodToDetails(mangos);
        console.log(`Servings: ${details.servings?.length || 0}`);
        for (const s of details.servings || []) {
            const grams = s.servingWeightGrams || s.metricServingAmount;
            console.log(`  - "${s.description || s.measurementDescription}" = ${grams}g (isDefault: ${s.isDefault})`);
        }

        // Check nutrition
        console.log(`\nNutrition per 100g:`);
        console.log(`  Calories: ${details.nutrientsPer100g?.calories}`);
        console.log(`  Protein: ${details.nutrientsPer100g?.protein}`);
    } else {
        console.log('Mangos (35863) NOT in cache!');
    }

    // Check Mango Chunks (3920792) servings
    console.log('\n---');
    const chunks = await getCachedFoodWithRelations('3920792');
    if (chunks) {
        console.log(`Mango Chunks (3920792) in cache: YES`);
        const details = cacheFoodToDetails(chunks);
        console.log(`Servings: ${details.servings?.length || 0}`);
        for (const s of details.servings || []) {
            const grams = s.servingWeightGrams || s.metricServingAmount;
            console.log(`  - "${s.description || s.measurementDescription}" = ${grams}g`);
        }
    }

    // Parse "1 mango" to see what it expects
    console.log('\n---');
    const parsed = parseIngredientLine('1 mango');
    console.log('Parsed "1 mango":', { qty: parsed?.qty, unit: parsed?.unit, name: parsed?.name });
}

main().finally(() => prisma.$disconnect());
