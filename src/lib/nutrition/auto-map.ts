import { prisma } from '../db';
import { logger } from '../logger';
import { parseIngredientLine } from '../parse/ingredient-line';
import { mapIngredientWithFatsecret } from '../fatsecret/map-ingredient';
import { FATSECRET_MIN_CONFIDENCE } from '../fatsecret/config';

/**
 * Automatically map ingredients to foods based on name matching
 * FatSecret-first: uses cache, falls back to FatSecret API + autocomplete
 */
export async function autoMapIngredients(recipeId: string): Promise<number> {
  logger.info('autoMap:start', { recipeId, mode: 'fatsecret-only' });

  const ingredients = await prisma.ingredient.findMany({
    where: { recipeId },
    include: { foodMaps: true },
  });

  // Only map ingredients that have no active mapping yet
  const unmappedIngredients = ingredients.filter((ing) => ing.foodMaps.length === 0);
  if (unmappedIngredients.length === 0) {
    logger.info('autoMap:done', { recipeId, mappedCount: 0, reason: 'no_unmapped' });
    return 0;
  }

  let mappedCount = 0;
  for (const ingredient of unmappedIngredients) {
    const ingredientLine = ingredient.unit && ingredient.unit.trim()
      ? `${ingredient.qty} ${ingredient.unit} ${ingredient.name}`
      : `${ingredient.qty} ${ingredient.name}`;

    const mapped = await mapIngredientWithFatsecret(ingredientLine, {
      minConfidence: FATSECRET_MIN_CONFIDENCE,
    });

    if (!mapped) {
      logger.info('autoMap:skipped-no-match', { ingredientId: ingredient.id, ingredientLine });
      continue;
    }

    try {
      const payload: any = {
        ingredientId: ingredient.id,
        fatsecretFoodId: mapped.foodId,
        fatsecretServingId: mapped.servingId ?? null,
        fatsecretGrams: mapped.grams,
        fatsecretConfidence: mapped.confidence,
        fatsecretSource: mapped.servingDescription ?? null,
        pendingVolume: false,
        mappedBy: 'auto-fatsecret',
        confidence: mapped.confidence,
        useOnce: false,
        isActive: true,
      };

      await prisma.ingredientFoodMap.create({ data: payload });

      logger.info('autoMap:mapped', {
        ingredientId: ingredient.id,
        fatsecretFoodId: mapped.foodId,
        servingId: mapped.servingId,
        confidence: mapped.confidence,
        rawLine: ingredientLine,
        foodName: mapped.foodName,
      });
      mappedCount += 1;
    } catch (err) {
      logger.warn('autoMap:error-map', {
        ingredientId: ingredient.id,
        err: (err as Error).message,
      });
    }
  }

  logger.info('autoMap:done', {
    recipeId,
    mappedCount,
    totalIngredients: ingredients.length,
    unmapped: unmappedIngredients.length,
  });
  return mappedCount;
}
