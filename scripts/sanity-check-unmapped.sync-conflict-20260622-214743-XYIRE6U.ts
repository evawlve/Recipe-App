import { PrismaClient } from '@prisma/client';
import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const client = new FatSecretClient();

async function main() {
    console.log('Fetching unmapped ingredients...');

    // Find ingredients that don't have a corresponding IngredientFoodMap entry
    const allIngredients = await prisma.ingredient.findMany({
        include: {
            foodMaps: true,
        },
    });

    const unmapped = allIngredients.filter(i => i.foodMaps.length === 0);

    console.log(`Found ${unmapped.length} unmapped ingredients.`);

    if (unmapped.length === 0) {
        console.log('No unmapped ingredients found! Great job!');
        return;
    }

    console.log('\n--- Starting Sanity Check (Attempting to map unmapped items) ---\n');

    let successCount = 0;

    for (const ingredient of unmapped) {
        console.log(`Processing: "${ingredient.name}" (ID: ${ingredient.id})`);

        try {
            const result = await mapIngredientWithFatsecret(ingredient.name, { client });

            if (result) {
                console.log(`  ✅ MAPPED: ${result.foodName} (ID: ${result.foodId})`);
                console.log(`     Serving: ${result.servingDescription} (${result.grams}g)`);
                console.log(`     Confidence: ${result.confidence}`);
                successCount++;
            } else {
                console.log(`  ❌ FAILED: Could not map.`);
            }
        } catch (error) {
            console.error(`  ⚠️ ERROR: ${(error as Error).message}`);
        }
        console.log('------------------------------------------------');
    }

    console.log(`\nSanity Check Complete.`);
    console.log(`Successfully mapped ${successCount} out of ${unmapped.length} previously unmapped ingredients.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
