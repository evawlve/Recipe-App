import { prisma } from '../db';
import { logger } from '../logger';
import { parseIngredientLine } from '../parse/ingredient-line';
import { mapIngredientWithFallback, type FatsecretMappedIngredient } from '../fatsecret/map-ingredient-with-fallback';
import { mapIngredientWithFdc } from '../usda/map-ingredient-fdc';
import { createFoodAlias } from '../fatsecret/alias-manager';
import { normalizeIngredientName, refreshNormalizationRules } from '../fatsecret/normalization-rules';
import { applyCleanupPatterns, recordCleanupOutcome } from '../ingredients/cleanup';
import { learnPatternsFromAI } from '../ingredients/pattern-learner';
import { aiNormalizeIngredient } from '../fatsecret/ai-normalize';

// Align with pilot importer: allow candidates down to 0.5 but gate on AI validation
const MIN_AUTOMAP_CONFIDENCE = 0.5;

/**
 * Process items in batches with concurrency control
 */
async function processBatch<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number = 10
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }

  return results;
}

/**
 * Automatically map ingredients to foods based on name matching
 * FatSecret-first: uses cache, falls back to FatSecret API + autocomplete
 * 
 * PHASE B: Now with parallel processing for faster batch imports
 */
export async function autoMapIngredients(recipeId: string, options?: { concurrency?: number }): Promise<number> {
  const concurrency = options?.concurrency ?? 100;  // INCREASED: Default 100 for maximized parallel processing

  // Sync AI-learned prep phrases before processing
  await refreshNormalizationRules();

  logger.info('autoMap:start', { recipeId, mode: 'fatsecret-only', concurrency });

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

  // PHASE B: Process ingredients in parallel batches for speed
  const results = await processBatch(
    unmappedIngredients,
    async (ingredient) => {
      try {
        const ingredientLine = ingredient.unit && ingredient.unit.trim()
          ? `${ingredient.qty} ${ingredient.unit} ${ingredient.name}`
          : `${ingredient.qty} ${ingredient.name}`;

        // PHASE 2: Apply learned cleanup patterns BEFORE mapping
        const cleanupResult = await applyCleanupPatterns(ingredient.name);
        const cleanedName = cleanupResult.cleaned;

        // Use cleaned name for parsing and mapping
        const cleanedLine = ingredient.unit && ingredient.unit.trim()
          ? `${ingredient.qty} ${ingredient.unit} ${cleanedName}`
          : `${ingredient.qty} ${cleanedName}`;

        const parsed = parseIngredientLine(cleanedLine);
        const normalizedName = normalizeIngredientName(parsed?.name || cleanedName).cleaned;

        // 1. Check Global Mappings (Cache/Overrides)
        // Use any cast to avoid TS errors if client isn't updated in editor yet
        const globalMapping = await (prisma as any).globalIngredientMapping.findUnique({
          where: { normalizedName }
        });

        if (globalMapping && (globalMapping.confidence >= 0.7 || globalMapping.isUserOverride)) {
          // Update usage stats
          await (prisma as any).globalIngredientMapping.update({
            where: { id: globalMapping.id },
            data: {
              usageCount: { increment: 1 },
              lastUsed: new Date()
            }
          });

          const payload: any = {
            ingredientId: ingredient.id,
            mappedBy: globalMapping.isUserOverride ? 'user-override' : 'global-auto',
            confidence: globalMapping.confidence,
            isActive: true,
            fatsecretGrams: 100, // Default fallback, ideally we'd recalculate
            // We need to set at least one ID
          };

          if (globalMapping.source === 'fatsecret') {
            payload.fatsecretFoodId = globalMapping.fatsecretFoodId;
            payload.fatsecretServingId = globalMapping.fatsecretServingId;
            payload.fatsecretSource = 'global-cache';
          } else if (globalMapping.source === 'fdc') {
            payload.fatsecretFoodId = `fdc:${globalMapping.fdcId}`;
            payload.fatsecretSource = 'fdc-global';
          }

          await prisma.ingredientFoodMap.create({ data: payload });

          logger.info('autoMap:global-hit', {
            ingredientId: ingredient.id,
            normalizedName,
            source: globalMapping.source
          });
          return { success: true, ingredientId: ingredient.id };
        }

        // Always enable debug logging for failure analysis
        // Use cleaned ingredient line for mapping
        // NOTE: mapIngredientWithFallback already includes FDC search in parallel,
        // so the FDC fallback below is a secondary safety net for edge cases.
        let mapped: FatsecretMappedIngredient | null = await mapIngredientWithFallback(cleanedLine, {
          minConfidence: MIN_AUTOMAP_CONFIDENCE,
          debug: true,
        }) as FatsecretMappedIngredient | null;

        // FDC Fallback
        // If FatSecret failed or confidence is low (< 0.4), try FDC
        if (!mapped || mapped.confidence < 0.4) {
          const fdcResult = await mapIngredientWithFdc(cleanedLine);

          if (fdcResult) {
            // If we have no FatSecret result, or FDC is significantly better
            if (!mapped || fdcResult.confidence > mapped.confidence + 0.1) {
              logger.info('autoMap:fdc-fallback-used', {
                ingredientLine: cleanedLine,
                fdcFood: fdcResult.description,
                confidence: fdcResult.confidence,
                fatsecretConfidence: mapped?.confidence
              });

              // Adapt FDC result to mapped format for DB insertion
              // Since fatsecretFoodId is just a string without FK constraint, we can store FDC ID with prefix
              const payload: any = {
                ingredientId: ingredient.id,
                fatsecretFoodId: `fdc:${fdcResult.fdcId}`,
                fatsecretServingId: 'default', // FDC doesn't have serving IDs like FatSecret
                fatsecretGrams: fdcResult.grams,
                fatsecretConfidence: fdcResult.confidence,
                fatsecretSource: 'fdc',
                pendingVolume: false,
                mappedBy: 'auto-fdc',
                confidence: fdcResult.confidence,
                useOnce: false,
                isActive: true,
              };

              await prisma.ingredientFoodMap.create({ data: payload });

              // Save to Global Mappings if high confidence FDC result
              if (fdcResult.confidence >= 0.7 && fdcResult.fdcId) {
                await (prisma as any).globalIngredientMapping.upsert({
                  where: { normalizedName: normalizedName },
                  update: {
                    fdcId: fdcResult.fdcId,
                    confidence: fdcResult.confidence,
                    source: 'fdc',
                    lastUsed: new Date(),
                    usageCount: { increment: 1 }
                  },
                  create: {
                    normalizedName: normalizedName,
                    fdcId: fdcResult.fdcId,
                    confidence: fdcResult.confidence,
                    source: 'fdc',
                    createdBy: 'auto-map'
                  }
                });
              }

              logger.info('autoMap:mapped', {
                ingredientId: ingredient.id,
                fatsecretFoodId: `fdc:${fdcResult.fdcId}`,
                source: 'fdc',
                confidence: fdcResult.confidence,
                rawLine: ingredientLine,
                foodName: fdcResult.description,
              });
              return { success: true, ingredientId: ingredient.id };
            }
          }
        }

        // PHASE 2: If mapping still failed, try AI normalization and learn patterns
        if (!mapped) {
          logger.info('autoMap:attempting-ai-fallback', {
            ingredientId: ingredient.id,
            originalName: ingredient.name,
            cleanedName
          });

          // Try AI normalization as last resort
          const aiResult = await aiNormalizeIngredient(ingredient.name, cleanedName);

          if (aiResult.status === 'success') {
            // Learn patterns from AI for future use
            await learnPatternsFromAI(ingredient.name, aiResult);

            // Retry mapping with AI-normalized name
            const aiNormalizedLine = ingredient.unit && ingredient.unit.trim()
              ? `${ingredient.qty} ${ingredient.unit} ${aiResult.normalizedName}`
              : `${ingredient.qty} ${aiResult.normalizedName}`;

            mapped = await mapIngredientWithFallback(aiNormalizedLine, {
              minConfidence: MIN_AUTOMAP_CONFIDENCE,
              debug: true,
            }) as FatsecretMappedIngredient | null;

            if (!mapped) {
              logger.info('autoMap:skipped-no-match-after-ai', {
                ingredientId: ingredient.id,
                aiNormalizedName: aiResult.normalizedName
              });

              // Record cleanup failure for this ingredient
              if (cleanupResult.appliedPatterns.length > 0) {
                await recordCleanupOutcome(
                  ingredient.name,
                  cleanedName,
                  cleanupResult.appliedPatterns.map(p => p.id),
                  false, // mapping failed
                  0,
                  { recipeId, ingredientId: ingredient.id }
                );
              }
              return { success: false, ingredientId: ingredient.id };
            }
          } else {
            logger.info('autoMap:skipped-no-match', {
              ingredientId: ingredient.id,
              ingredientLine: cleanedLine
            });

            // Record cleanup failure
            if (cleanupResult.appliedPatterns.length > 0) {
              await recordCleanupOutcome(
                ingredient.name,
                cleanedName,
                cleanupResult.appliedPatterns.map(p => p.id),
                false,
                0,
                { recipeId, ingredientId: ingredient.id }
              );
            }
            return { success: false, ingredientId: ingredient.id };
          }
        }

        // Hard stop: if AI validation explicitly rejects, do not save
        if (mapped.aiValidation && mapped.aiValidation.approved === false) {
          logger.info('autoMap:ai_rejected', {
            ingredientId: ingredient.id,
            rawLine: ingredientLine,
            foodName: mapped.foodName,
            aiReason: mapped.aiValidation.reason,
            aiCategory: mapped.aiValidation.category,
            aiConfidence: mapped.aiValidation.confidence,
          });

          // Record cleanup attempt as failed so we can learn later
          if (cleanupResult.appliedPatterns.length > 0) {
            await recordCleanupOutcome(
              ingredient.name,
              cleanedName,
              cleanupResult.appliedPatterns.map(p => p.id),
              false,
              mapped.confidence,
              { recipeId, ingredientId: ingredient.id }
            );
          }

          return { success: false, ingredientId: ingredient.id, error: 'ai_rejected' };
        }

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

        // Save to Global Mappings if high confidence FatSecret result
        // QUICK FIX: Lowered threshold from 0.8 to 0.7 to capture more matches
        if (mapped.confidence >= 0.7 && mapped.foodId) {
          await (prisma as any).globalIngredientMapping.upsert({
            where: { normalizedName: normalizedName },
            update: {
              fatsecretFoodId: mapped.foodId,
              fatsecretServingId: mapped.servingId,
              confidence: mapped.confidence,
              source: 'fatsecret',
              lastUsed: new Date(),
              usageCount: { increment: 1 }
            },
            create: {
              normalizedName: normalizedName,
              fatsecretFoodId: mapped.foodId,
              fatsecretServingId: mapped.servingId,
              confidence: mapped.confidence,
              source: 'fatsecret',
              createdBy: 'auto-map'
            }
          });
        }

        // If we have a high-confidence match, create an alias for future lookups
        // QUICK FIX: Lowered threshold from 0.8 to 0.7
        if (mapped.confidence >= 0.7 && mapped.foodId) {
          // Use the cleaned name from normalization if available, otherwise the original name
          const aliasName = parsed?.name || ingredientLine;

          // Don't await this, let it run in background
          createFoodAlias(mapped.foodId, aliasName, 'auto-map').catch(err => {
            console.error('Failed to create alias in background', err);
          });
        }

        // PHASE 2: Record successful cleanup outcome
        if (cleanupResult.appliedPatterns.length > 0) {
          await recordCleanupOutcome(
            ingredient.name,
            cleanedName,
            cleanupResult.appliedPatterns.map(p => p.id),
            true, // mapping succeeded
            mapped.confidence,
            { recipeId, ingredientId: ingredient.id }
          );
        }

        logger.info('autoMap:mapped', {
          ingredientId: ingredient.id,
          fatsecretFoodId: mapped.foodId,
          servingId: mapped.servingId,
          confidence: mapped.confidence,
          rawLine: ingredientLine,
          cleanedLine,
          foodName: mapped.foodName,
          patternsApplied: cleanupResult.appliedPatterns.length
        });

        return { success: true, ingredientId: ingredient.id };
      } catch (err) {
        logger.warn('autoMap:error-map', {
          ingredientId: ingredient.id,
          err: (err as Error).message,
        });
        return { success: false, ingredientId: ingredient.id, error: (err as Error).message };
      }
    },
    concurrency
  );

  const mappedCount = results.filter(r => r.success).length;

  logger.info('autoMap:done', {
    recipeId,
    mappedCount,
    totalIngredients: ingredients.length,
    unmapped: unmappedIngredients.length,
  });

  // Automatically recompute nutrition for the recipe
  try {
    const { computeRecipeNutrition } = await import('./compute');
    await computeRecipeNutrition(recipeId, 'general');
    logger.info('autoMap:nutrition-recomputed', { recipeId });
  } catch (err) {
    logger.error('autoMap:nutrition-recompute-failed', { recipeId, err });
  }

  return mappedCount;
}
