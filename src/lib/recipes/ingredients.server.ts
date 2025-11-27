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

  // Collect IDs for batch fetching
  const fatsecretIds = new Set<string>();
  const fdcIds = new Set<number>();

  recipe.ingredients.forEach(ing => {
    const best = ing.foodMaps
      .filter(m => m.isActive)
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];

    if (best && !best.food) {
      if (best.fatsecretFoodId) {
        if (best.fatsecretFoodId.startsWith('fdc:')) {
          const id = parseInt(best.fatsecretFoodId.split(':')[1]);
          if (!isNaN(id)) fdcIds.add(id);
        } else {
          fatsecretIds.add(best.fatsecretFoodId);
        }
      }
    }
  });

  // Fetch from caches
  let fatsecretFoods: Record<string, any> = {};
  let fdcFoods: Record<number, any> = {};

  if (fatsecretIds.size > 0) {
    const foods = await prisma.fatSecretFoodCache.findMany({
      where: { id: { in: Array.from(fatsecretIds) } }
    });
    foods.forEach(f => fatsecretFoods[f.id] = f);
  }

  if (fdcIds.size > 0) {
    const foods = await (prisma as any).fdcFoodCache.findMany({
      where: { id: { in: Array.from(fdcIds) } }
    });
    foods.forEach((f: any) => fdcFoods[f.id] = f);
  }

  // Transform the data to include mapping status and nutrition
  const ingredientsWithMapping = recipe.ingredients.map(ingredient => {
    // Get the best mapping (highest confidence, active)
    const bestMapping = ingredient.foodMaps
      .filter(m => m.isActive)
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];

    let nutrition = null;
    let foodName = null;
    let foodBrand = null;
    let foodId = null;

    if (bestMapping) {
      const grams = convertUnit(ingredient.qty, ingredient.unit, ingredient.name);
      const multiplier = grams / 100; // Convert to per-100g basis

      if (bestMapping.food) {
        // Legacy Food Model
        foodName = bestMapping.food.name;
        foodBrand = bestMapping.food.brand;
        foodId = bestMapping.foodId;

        nutrition = {
          calories: Math.round(bestMapping.food.kcal100 * multiplier),
          proteinG: bestMapping.food.protein100 * multiplier,
          carbsG: bestMapping.food.carbs100 * multiplier,
          fatG: bestMapping.food.fat100 * multiplier,
          fiberG: (bestMapping.food.fiber100 || 0) * multiplier,
          sugarG: (bestMapping.food.sugar100 || 0) * multiplier,
        };
      } else if (bestMapping.fatsecretFoodId) {
        foodId = bestMapping.fatsecretFoodId;

        if (bestMapping.fatsecretFoodId.startsWith('fdc:')) {
          // FDC Cache
          const fdcId = parseInt(bestMapping.fatsecretFoodId.split(':')[1]);
          const fdcFood = fdcFoods[fdcId];

          if (fdcFood) {
            foodName = fdcFood.description;
            foodBrand = fdcFood.brandName;

            // Extract nutrients from FDC JSON
            const nutrients = fdcFood.nutrients as any[];
            const getNutrient = (id: number) => {
              const n = nutrients.find((x: any) => x.nutrient?.id === id || x.nutrientId === id);
              return n?.amount || 0;
            };

            nutrition = {
              calories: Math.round(getNutrient(1008) * multiplier),
              proteinG: getNutrient(1003) * multiplier,
              carbsG: getNutrient(1005) * multiplier,
              fatG: getNutrient(1004) * multiplier,
              fiberG: getNutrient(1079) * multiplier,
              sugarG: getNutrient(2000) * multiplier,
            };
          }
        } else {
          // FatSecret Cache
          const fsFood = fatsecretFoods[bestMapping.fatsecretFoodId];

          if (fsFood) {
            foodName = fsFood.name;
            foodBrand = fsFood.brandName;

            // Extract nutrients from FatSecret JSON
            // Assuming nutrientsPer100g is { calories: number, protein: number, ... }
            const n = fsFood.nutrientsPer100g as any || {};

            nutrition = {
              calories: Math.round((n.calories || 0) * multiplier),
              proteinG: (n.protein || 0) * multiplier,
              carbsG: (n.carbohydrate || 0) * multiplier,
              fatG: (n.fat || 0) * multiplier,
              fiberG: (n.fiber || 0) * multiplier,
              sugarG: (n.sugar || 0) * multiplier,
            };
          }
        }
      }
    }

    return {
      id: ingredient.id,
      name: ingredient.name,
      qty: ingredient.qty,
      unit: ingredient.unit,
      currentMapping: bestMapping ? {
        foodId: foodId || 'unknown',
        foodName: foodName || 'Unknown Food',
        foodBrand: foodBrand,
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
