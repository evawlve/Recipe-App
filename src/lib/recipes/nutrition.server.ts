import 'server-only';
import { prisma } from '@/lib/db';

export async function computeNutritionForRecipe(recipeId: string, goal: string = 'general') {
  // Load recipe + ingredients
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    include: { ingredients: true },
  });
  
  if (!recipe) {
    return { ok: false, error: 'not_found' };
  }

  // Import your existing nutrition calculator dynamically to avoid top-level heavy deps
  const { computeRecipeNutrition } = await import('@/lib/nutrition/compute');
  const nutrition = await computeRecipeNutrition(recipeId, goal as any);

  // Persist nutrition data
  await prisma.nutrition.upsert({
    where: { recipeId },
    update: { 
      calories: nutrition.totals.calories,
      proteinG: nutrition.totals.proteinG,
      carbsG: nutrition.totals.carbsG,
      fatG: nutrition.totals.fatG,
      fiberG: nutrition.totals.fiberG || 0,
      sugarG: nutrition.totals.sugarG || 0,
      healthScore: nutrition.score.value,
      goal: goal,
      computedAt: new Date() 
    },
    create: { 
      recipeId,
      calories: nutrition.totals.calories,
      proteinG: nutrition.totals.proteinG,
      carbsG: nutrition.totals.carbsG,
      fatG: nutrition.totals.fatG,
      fiberG: nutrition.totals.fiberG || 0,
      sugarG: nutrition.totals.sugarG || 0,
      healthScore: nutrition.score.value,
      goal: goal,
      computedAt: new Date() 
    },
  });

  // Optionally update RecipeFeatureLite
  try {
    const { writeRecipeFeatureLite } = await import('@/lib/features/writeRecipeFeatureLite');
    await writeRecipeFeatureLite(recipeId);
  } catch (error) {
    console.warn('Failed to write recipe features:', error);
    // Don't fail the whole operation if feature writing fails
  }

  return { ok: true, nutrition };
}
