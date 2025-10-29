import 'server-only';
import { prisma } from '@/lib/db';
import { convertUnit } from '@/lib/nutrition/compute';

export async function getRecipeIngredients(recipeId: string) {
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    include: { 
      ingredients: {
        include: {
          foodMaps: {
            include: {
              food: true
            }
          }
        }
      }
    },
  });
  
  if (!recipe) {
    return null;
  }

  // Transform the data to include mapping status and nutrition
  const ingredientsWithMapping = recipe.ingredients.map(ingredient => {
    // Get the best mapping (highest confidence, active)
    const bestMapping = ingredient.foodMaps
      .filter(m => m.isActive)
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
    
    // Calculate nutrition if mapped
    let nutrition = null;
    if (bestMapping?.food) {
      const grams = convertUnit(ingredient.qty, ingredient.unit, ingredient.name);
      const multiplier = grams / 100; // Convert to per-100g basis
      
      nutrition = {
        calories: Math.round(bestMapping.food.kcal100 * multiplier),
        proteinG: bestMapping.food.protein100 * multiplier,
        carbsG: bestMapping.food.carbs100 * multiplier,
        fatG: bestMapping.food.fat100 * multiplier,
        fiberG: (bestMapping.food.fiber100 || 0) * multiplier,
        sugarG: (bestMapping.food.sugar100 || 0) * multiplier,
      };
    }
    
    return {
      id: ingredient.id,
      name: ingredient.name,
      qty: ingredient.qty,
      unit: ingredient.unit,
      currentMapping: bestMapping ? {
        foodId: bestMapping.foodId,
        foodName: bestMapping.food.name,
        foodBrand: bestMapping.food.brand,
        confidence: bestMapping.confidence
      } : null,
      nutrition
    };
  });

  return ingredientsWithMapping;
}

export async function upsertRecipeIngredients(
  recipeId: string, 
  items: Array<{ id?: string; name: string; qty: number; unit: string }>
) {
  // Delete existing ingredients and recreate them
  await prisma.ingredient.deleteMany({ where: { recipeId } });
  
  const newIngredients = await prisma.ingredient.createMany({
    data: items.map(item => ({
      recipeId,
      name: item.name,
      qty: item.qty,
      unit: item.unit,
    })),
  });

  // Return the updated ingredients
  return getRecipeIngredients(recipeId);
}

export async function getRecipeIngredientsSimple(recipeId: string) {
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    include: { ingredients: true },
  });
  
  if (!recipe) {
    return null;
  }

  return recipe.ingredients;
}
