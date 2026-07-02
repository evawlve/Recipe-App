import { prisma } from '@/lib/db';
import type { Nutrition } from '@prisma/client';
import { goalSuggestions, methodSuggestions, cuisineSuggestions, computeMacroFeatures } from '@/lib/classifier/heuristics';
import { dietSuggestions } from '@/lib/classifier/diet';

export async function writeRecipeFeatureLite(recipeId: string) {
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    include: { 
      nutrition: true, 
      ingredients: true 
    }
  });
  
  if (!recipe) return;

  const n: Nutrition | null = recipe.nutrition;
  const { pPct, cPct, fPct, fiber, kcal, protein, carbs, fat } = computeMacroFeatures(n);
  
  // per-100kcal macros
  const per100 = (kcal && kcal > 0) ? {
    proteinPer100kcal: ((protein ?? 0) * 4) / (kcal/100),
    carbPer100kcal:    ((carbs   ?? 0) * 4) / (kcal/100),
    fatPer100kcal:     ((fat     ?? 0) * 9) / (kcal/100),
  } : { proteinPer100kcal: 0, carbPer100kcal: 0, fatPer100kcal: 0 };

  const ingredientsText = recipe.ingredients.map(i => i.name ?? '').join(' ');
  const textBlob = `${recipe.title}\n${recipe.bodyMd}\n${ingredientsText}`;

  // Get suggestions from classifiers
  const goal = Object.fromEntries(goalSuggestions(n).map(s => [s.slug, s.confidence]));
  const methods = methodSuggestions(textBlob).map(s => s.slug);
  const cuisines = Object.fromEntries(cuisineSuggestions(ingredientsText).map(s => [s.slug, s.confidence]));
  
  // Get diet suggestions
  const dietSuggestionsList = dietSuggestions(n, ingredientsText);
  const dietScores = Object.fromEntries(dietSuggestionsList.map(s => [s.slug, s.confidence]));

  await prisma.recipeFeatureLite.upsert({
    where: { recipeId },
    update: {
      proteinPer100kcal: per100.proteinPer100kcal,
      carbPer100kcal: per100.carbPer100kcal,
      fatPer100kcal: per100.fatPer100kcal,
      fiberPerServing: fiber ?? 0,
      sugarPerServing: n?.sugarG ?? 0,
      kcalPerServing: kcal ?? 0,
      goalScores: JSON.stringify(goal),
      methodFlags: JSON.stringify(methods),
      cuisineScores: JSON.stringify(cuisines),
    },
    create: {
      recipeId,
      proteinPer100kcal: per100.proteinPer100kcal,
      carbPer100kcal: per100.carbPer100kcal,
      fatPer100kcal: per100.fatPer100kcal,
      fiberPerServing: fiber ?? 0,
      sugarPerServing: n?.sugarG ?? 0,
      kcalPerServing: kcal ?? 0,
      goalScores: JSON.stringify(goal),
      methodFlags: JSON.stringify(methods),
      cuisineScores: JSON.stringify(cuisines),
    }
  });
}
