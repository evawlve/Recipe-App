/**
 * Fix bad FatSecret scallion servings and clear cache
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { mapIngredientWithFallback } from '../lib/fatsecret/map-ingredient-with-fallback';

const prisma = new PrismaClient();

async function main() {
    console.log("\n=== FIXING FATSECRET SCALLION SERVINGS ===");

    const foods = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'scallion', mode: 'insensitive' } }
    });

    for (const food of foods) {
        console.log(`\nFood: ${food.name} (ID: ${food.id})`);

        // Delete bad servings > 50g (a scallion is ~15g)
        const deleted = await prisma.fatSecretServingCache.deleteMany({
            where: {
                foodId: food.id,
                metricServingAmount: { gt: 50 }
            }
        });
        console.log(`  Deleted ${deleted.count} bad servings > 50g`);
    }

    // Also clear any scallion validated mappings
    console.log("\n=== CLEARING VALIDATED MAPPINGS ===");
    const deletedMappings = await prisma.validatedMapping.deleteMany({
        where: {
            OR: [
                { normalizedForm: { contains: 'scallion', mode: 'insensitive' } },
                { rawIngredient: { contains: 'scallion', mode: 'insensitive' } },
                { normalizedForm: { contains: 'spring onion', mode: 'insensitive' } },
            ]
        }
    });
    console.log(`Deleted ${deletedMappings.count} mappings`);

    await prisma.$disconnect();

    // Test the mapping
    console.log("\n=== TESTING ===\n");

    const result = await mapIngredientWithFallback("3 scallions");
    console.log(`"3 scallions":`);
    console.log(`  Food: ${result?.foodName}`);
    console.log(`  Grams: ${result?.grams} ${result?.grams && result.grams < 100 ? '✅ FIXED' : '❌ STILL BROKEN'}`);
    console.log(`  Serving: ${result?.servingDescription}`);

    console.log("\n✅ Done\n");
    process.exit(0);
}

main().catch(console.error);
