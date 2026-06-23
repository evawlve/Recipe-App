/**
 * Diagnostic test: Check why batch import only processes 1 recipe and doesn't create IngredientFoodMap
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    console.log('\n=== DIAGNOSTIC: Batch Import Flow ===\n');

    // Step 1: Query recipes the same way pilot-batch-import does
    const recipes = await prisma.recipe.findMany({
        where: {
            ingredients: {
                some: {
                    foodMaps: {
                        none: {},
                    },
                },
            },
        },
        include: {
            ingredients: {
                where: {
                    foodMaps: {
                        none: {},
                    },
                },
            },
        },
        take: 3,  // Just 3 recipes for diagnostics
    });

    console.log(`Found ${recipes.length} recipes with unmapped ingredients\n`);

    for (const recipe of recipes) {
        console.log(`📝 Recipe: "${recipe.title}"`);
        console.log(`   Ingredients to process: ${recipe.ingredients.length}`);

        // Process each ingredient
        for (const ingredient of recipe.ingredients.slice(0, 3)) {  // Just 3 per recipe
            const rawLine = `${ingredient.qty || ''} ${ingredient.unit || ''} ${ingredient.name}`.trim();
            console.log(`\n   🔄 Mapping: "${rawLine}"`);

            try {
                const result = await mapIngredientWithFallback(rawLine, {
                    minConfidence: 0.5,
                    skipAiValidation: true,
                    debug: false,
                });

                if (result) {
                    console.log(`   ✓ Mapped to: ${result.foodName} (${result.confidence.toFixed(2)})`);
                    console.log(`   📁 Attempting to create IngredientFoodMap...`);

                    try {
                        const created = await prisma.ingredientFoodMap.create({
                            data: {
                                ingredientId: ingredient.id,
                                fatsecretFoodId: result.foodId,
                                fatsecretServingId: result.servingId || null,
                                fatsecretGrams: result.grams,
                                fatsecretConfidence: result.confidence,
                                fatsecretSource: 'fatsecret',
                                mappedBy: 'diagnostic_test',
                                isActive: true,
                            },
                        });
                        console.log(`   ✅ Created IngredientFoodMap: ${created.id}`);
                    } catch (createErr: unknown) {
                        const error = createErr as Error;
                        console.error(`   ❌ Create failed:`, error.message);
                        console.error(`   Error details:`, JSON.stringify(createErr, null, 2));
                    }
                } else {
                    console.log(`   ❌ No mapping found`);
                }
            } catch (mapErr: unknown) {
                const error = mapErr as Error;
                console.error(`   ❌ Mapping error:`, error.message);
            }
        }
        console.log();
    }

    // Final check
    const mapCount = await prisma.ingredientFoodMap.count();
    const validatedCount = await prisma.validatedMapping.count();
    console.log('\n=== Final Counts ===');
    console.log(`IngredientFoodMap: ${mapCount}`);
    console.log(`ValidatedMapping: ${validatedCount}`);

    await prisma.$disconnect();
}

main().catch(console.error);
