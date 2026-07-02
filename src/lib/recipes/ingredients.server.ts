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
  const fdcIds = new Set<number>();
  const offBarcodes = new Set<string>();
  const aiGeneratedIds = new Set<string>();

  recipe.ingredients.forEach(ing => {
    const best = ing.foodMaps
      .filter(m => m.isActive)
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];

    if (best && !best.food) {
      if (best.fdcId) {
        fdcIds.add(best.fdcId);
      } else if (best.offBarcode) {
        offBarcodes.add(best.offBarcode);
      } else if (best.aiGeneratedFoodId) {
        aiGeneratedIds.add(best.aiGeneratedFoodId);
      }
    }
  });

  // Fetch from consolidated tables
  let fdcFoods: Record<number, any> = {};
  let offFoods: Record<string, any> = {};
  let aiGeneratedFoods: Record<string, any> = {};

  if (fdcIds.size > 0) {
    const foods = await prisma.fdcFood.findMany({
      where: { fdcId: { in: Array.from(fdcIds) } }
    });
    foods.forEach(f => fdcFoods[f.fdcId] = f);
  }

  if (offBarcodes.size > 0) {
    const foods = await prisma.offFood.findMany({
      where: { barcode: { in: Array.from(offBarcodes) } }
    });
    foods.forEach(f => offFoods[f.barcode] = f);
  }

  if (aiGeneratedIds.size > 0) {
    const foods = await prisma.aiGeneratedFood.findMany({
      where: { id: { in: Array.from(aiGeneratedIds) } }
    });
    foods.forEach(f => aiGeneratedFoods[f.id] = f);
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
      } else {
        let resolvedFood: any = null;
        let nutrients: any = null;

        if (bestMapping.fdcId) {
          foodId = `fdc_${bestMapping.fdcId}`;
          resolvedFood = fdcFoods[bestMapping.fdcId];
          if (resolvedFood) {
            foodName = resolvedFood.description;
            foodBrand = resolvedFood.brandName;
            nutrients = resolvedFood.nutrientsPer100g;
          }
        } else if (bestMapping.offBarcode) {
          foodId = `off_${bestMapping.offBarcode}`;
          resolvedFood = offFoods[bestMapping.offBarcode];
          if (resolvedFood) {
            foodName = resolvedFood.foodName;
            foodBrand = resolvedFood.brandName;
            nutrients = resolvedFood.nutrientsPer100g;
          }
        } else if (bestMapping.aiGeneratedFoodId) {
          foodId = bestMapping.aiGeneratedFoodId;
          resolvedFood = aiGeneratedFoods[bestMapping.aiGeneratedFoodId];
          if (resolvedFood) {
            foodName = resolvedFood.displayName;
            foodBrand = resolvedFood.brandName;
            nutrients = resolvedFood.nutrientsPer100g;
          }
        }

        if (resolvedFood && nutrients) {
          const kcal = nutrients.calories ?? nutrients.energy ?? nutrients.kcal ?? 0;
          const protein = nutrients.protein ?? 0;
          const carbs = nutrients.carbohydrate ?? nutrients.carbs ?? 0;
          const fat = nutrients.fat ?? 0;
          const fiber = nutrients.fiber ?? 0;
          const sugar = nutrients.sugar ?? 0;

          nutrition = {
            calories: Math.round(kcal * multiplier),
            proteinG: protein * multiplier,
            carbsG: carbs * multiplier,
            fatG: fat * multiplier,
            fiberG: fiber * multiplier,
            sugarG: sugar * multiplier,
          };
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
