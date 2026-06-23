import { prisma } from '../src/lib/db';

async function main() {
  const totalRecipes = await prisma.recipe.count();
  const totalIngredients = await prisma.ingredient.count();

  // Find recipes where every ingredient has at least one IngredientFoodMap
  const fullyMappedRecipes = await prisma.recipe.count({
    where: {
      ingredients: {
        every: {
          foodMaps: {
            some: {}
          }
        }
      }
    }
  });

  const unmappedRecipes = await prisma.recipe.count({
    where: {
      ingredients: {
        some: {
          foodMaps: {
            none: {}
          }
        }
      }
    }
  });

  const mappedIngredients = await prisma.ingredient.count({
    where: { foodMaps: { some: {} } }
  });

  const unmappedIngredients = await prisma.ingredient.count({
    where: { foodMaps: { none: {} } }
  });

  // Check FDC maps
  const fdcMaps = await prisma.ingredientFoodMap.count({
    where: { fatsecretSource: 'fdc' }
  });

  const fsMaps = await prisma.ingredientFoodMap.count({
    where: { fatsecretSource: 'fatsecret' }
  });

  const aiMaps = await prisma.ingredientFoodMap.count({
    where: { aiGeneratedFoodId: { not: null } }
  });

  console.log({
    totalRecipes,
    fullyMappedRecipes,
    unmappedRecipes,
    totalIngredients,
    mappedIngredients,
    unmappedIngredients,
    sources: {
      fdc: fdcMaps,
      fatsecret: fsMaps,
      aiGenerated: aiMaps
    }
  });
}

main().finally(() => prisma.$disconnect());
