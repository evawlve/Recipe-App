#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

/**
 * Clears all recipes and ingredients for a specific user
 * Use this to start completely fresh with recipe imports
 */

const TARGET_USER_ID = '279a6119-a377-42b4-9ee9-1f08169a8e71';

async function clearUserRecipes() {
    console.log('\n🧹 Clearing User Recipes & Ingredients\n');
    console.log(`User ID: ${TARGET_USER_ID}\n`);

    // 1. Count what we're about to delete
    const recipeCount = await prisma.recipe.count({
        where: { authorId: TARGET_USER_ID }
    });

    const ingredientCount = await prisma.ingredient.count({
        where: {
            recipe: {
                authorId: TARGET_USER_ID
            }
        }
    });

    const mappingCount = await prisma.ingredientFoodMap.count({
        where: {
            ingredient: {
                recipe: {
                    authorId: TARGET_USER_ID
                }
            }
        }
    });

    console.log(`Found for this user:`);
    console.log(`  - ${recipeCount} recipes`);
    console.log(`  - ${ingredientCount} ingredients`);
    console.log(`  - ${mappingCount} ingredient mappings`);

    // Confirm deletion
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const answer = await new Promise<string>((resolve) => {
        readline.question('\n⚠️  Delete ALL recipes for this user? (yes/no): ', resolve);
    });

    readline.close();

    if (answer.toLowerCase() !== 'yes') {
        console.log('\n❌ Cancelled\n');
        await prisma.$disconnect();
        return;
    }

    console.log('\n🗑️  Deleting...\n');

    // 2. Delete in correct order (due to foreign keys)

    // First, delete ingredient mappings
    const deletedMappings = await prisma.ingredientFoodMap.deleteMany({
        where: {
            ingredient: {
                recipe: {
                    authorId: TARGET_USER_ID
                }
            }
        }
    });
    console.log(`✅ Deleted ${deletedMappings.count} ingredient mappings`);

    // Then delete ingredients (cascade should handle this, but being explicit)
    const deletedIngredients = await prisma.ingredient.deleteMany({
        where: {
            recipe: {
                authorId: TARGET_USER_ID
            }
        }
    });
    console.log(`✅ Deleted ${deletedIngredients.count} ingredients`);

    // Delete recipe tags/associations
    const deletedRecipeTags = await prisma.recipeTag.deleteMany({
        where: {
            recipe: {
                authorId: TARGET_USER_ID
            }
        }
    });
    console.log(`✅ Deleted ${deletedRecipeTags.count} recipe tags`);

    const deletedCollectionRecipes = await prisma.collectionRecipe.deleteMany({
        where: {
            recipe: {
                authorId: TARGET_USER_ID
            }
        }
    });
    console.log(`✅ Deleted ${deletedCollectionRecipes.count} collection entries`);

    // Delete Nutrition
    const deletedNutrition = await prisma.nutrition.deleteMany({
        where: {
            recipe: {
                authorId: TARGET_USER_ID
            }
        }
    });
    console.log(`✅ Deleted ${deletedNutrition.count} nutrition entries`);

    // Delete Photos
    const deletedPhotos = await prisma.photo.deleteMany({
        where: {
            recipe: {
                authorId: TARGET_USER_ID
            }
        }
    });
    console.log(`✅ Deleted ${deletedPhotos.count} photos`);

    // Delete Likes
    const deletedLikes = await prisma.like.deleteMany({
        where: {
            recipe: {
                authorId: TARGET_USER_ID
            }
        }
    });
    console.log(`✅ Deleted ${deletedLikes.count} likes`);

    // Delete Notifications related to these recipes
    const deletedNotifications = await prisma.notification.deleteMany({
        where: {
            recipe: {
                authorId: TARGET_USER_ID
            }
        }
    });
    console.log(`✅ Deleted ${deletedNotifications.count} notifications`);

    // Delete RecipeFeatureLite
    const deletedFeatures = await prisma.recipeFeatureLite.deleteMany({
        where: {
            recipe: {
                authorId: TARGET_USER_ID
            }
        }
    });
    console.log(`✅ Deleted ${deletedFeatures.count} feature entries`);

    // Delete RecipeInteractionDaily
    const deletedInteractions = await prisma.recipeInteractionDaily.deleteMany({
        where: {
            recipe: {
                authorId: TARGET_USER_ID
            }
        }
    });
    console.log(`✅ Deleted ${deletedInteractions.count} interaction entries`);

    // Delete RecipeSimilar (both directions)
    const deletedSimilarTo = await prisma.recipeSimilar.deleteMany({
        where: {
            recipe: {
                authorId: TARGET_USER_ID
            }
        }
    });
    const deletedSimilarFrom = await prisma.recipeSimilar.deleteMany({
        where: {
            similar: {
                authorId: TARGET_USER_ID
            }
        }
    });
    console.log(`✅ Deleted ${deletedSimilarTo.count + deletedSimilarFrom.count} similarity entries`);

    // Delete RecipeView
    const deletedViews = await prisma.recipeView.deleteMany({
        where: {
            recipe: {
                authorId: TARGET_USER_ID
            }
        }
    });
    console.log(`✅ Deleted ${deletedViews.count} view entries`);

    // Finally, delete recipes
    const deletedRecipes = await prisma.recipe.deleteMany({
        where: {
            authorId: TARGET_USER_ID
        }
    });
    console.log(`✅ Deleted ${deletedRecipes.count} recipes`);

    console.log(`\n✅ Done! User's recipes cleared. Ready for fresh import.\n`);

    await prisma.$disconnect();
}

clearUserRecipes().catch(console.error);
