import { prisma } from '../db';
import { logger } from '../logger';
import { parseIngredientLine } from '../parse/ingredient-line';
import { mapIngredientWithFallback, type FatsecretMappedIngredient } from '../mapping/map-ingredient-with-fallback';
import { createFoodAlias } from '../mapping/alias-manager';
import { normalizeIngredientName, refreshNormalizationRules } from '../mapping/normalization-rules';
import { applyCleanupPatterns, recordCleanupOutcome } from '../ingredients/cleanup';
import { learnPatternsFromAI } from '../ingredients/pattern-learner';
import { aiNormalizeIngredient } from '../mapping/ai-normalize';

// Align with pilot importer: allow candidates down to 0.5 but gate on AI validation
const MIN_AUTOMAP_CONFIDENCE = 0.5;

/** The subset of IngredientFoodMap columns that identify WHICH record was mapped. */
type IngredientFoodMapColumns = {
  foodId?: string;
  offBarcode?: string;
  fdcId?: number;
  aiGeneratedFoodId?: string;
};

/**
 * Decompose the mapper's prefixed `foodId` into the IngredientFoodMap columns that exist.
 *
 * The mapper emits `fdc_<int>` | `off_<barcode>` | `fs_<id>` | a bare AiGeneratedFood id —
 * the same prefix scheme `resolveFoodDetails` reads. IngredientFoodMap has a typed column
 * for three of those four and NONE for FatSecret, so `fs_` returns null and the caller must
 * decide what to do about it. Do not "solve" that by stuffing a prefixed string into a text
 * column: this function replaced exactly that hack (`fatsecretFoodId: \`fdc:${id}\``), which
 * targeted a column that does not exist and silently failed every write.
 *
 * Returns null for anything unstorable — FatSecret, `water_default`, and any id whose
 * numeric part does not parse — never a partially-populated row.
 */
export function ingredientFoodMapLink(
  foodId: string | null | undefined,
): { columns: IngredientFoodMapColumns; source: string } | null {
  if (!foodId) return null;

  if (foodId.startsWith('fdc_')) {
    const fdcId = Number.parseInt(foodId.slice(4), 10);
    return Number.isSafeInteger(fdcId) ? { columns: { fdcId }, source: 'fdc' } : null;
  }
  if (foodId.startsWith('off_')) {
    const offBarcode = foodId.slice(4);
    return offBarcode ? { columns: { offBarcode }, source: 'off' } : null;
  }
  // fs_ has no column, and `water_default` (the zero-calorie fast path) resolves to no
  // record at all. Both are unstorable; say so rather than inventing a home for them.
  if (foodId.startsWith('fs_') || foodId === 'water_default') return null;

  // No recognised prefix ⇒ an AiGeneratedFood id. This leg has a real FK, so a wrong guess
  // is rejected by the database rather than written as a dangling reference.
  return { columns: { aiGeneratedFoodId: foodId }, source: 'ai' };
}

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

        // The GlobalIngredientMapping tier that used to sit here was REMOVED 2026-07-29.
        // It dereferenced a model that has never existed in the schema, through
        // `(prisma as any)`, as the first await in this try — so it threw for every
        // ingredient of every recipe, was swallowed by the catch below as a warn, and
        // autoMapIngredients returned 0 every time it was called. Nothing beneath it had
        // ever executed. Its feature (a cross-recipe mapping cache with usage counts and
        // user overrides) is already served, better, by `FoodMapping` — which
        // mapIngredientWithFallback reads and writes on its own.
        //
        // The live-USDA-API FDC fallback that followed was removed in the same pass: its
        // cache table (FdcFoodCache) was equally a ghost, and mapIngredientWithFallback
        // already searches FDC through `searchFdcLocal` against the ingested corpus.
        let mapped: FatsecretMappedIngredient | null = await mapIngredientWithFallback(cleanedLine, {
          minConfidence: MIN_AUTOMAP_CONFIDENCE,
          debug: true,
        }) as FatsecretMappedIngredient | null;

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

        // Decompose the mapper's prefixed foodId onto the columns IngredientFoodMap
        // actually has. The five `fatsecret*` fields this used to send exist nowhere in
        // the model — Prisma rejects unknown args at runtime, so every create here failed
        // (silently, behind the same catch) even before the ghost above was reached.
        const link = ingredientFoodMapLink(mapped.foodId);

        if (!link) {
          // A FatSecret winner has no home: IngredientFoodMap has no fsId column and no
          // FatSecretFood relation. Report it rather than dropping it — a silent skip here
          // is what let this whole path read as "working" while writing nothing.
          logger.warn('autoMap:unstorable-source', {
            ingredientId: ingredient.id,
            foodId: mapped.foodId,
            reason: 'IngredientFoodMap has no fsId column — see queue item #29',
            rawLine: ingredientLine,
            foodName: mapped.foodName,
          });
          return { success: false, ingredientId: ingredient.id, error: 'unstorable_source' };
        }

        await prisma.ingredientFoodMap.create({
          data: {
            ingredientId: ingredient.id,
            ...link.columns,
            pendingVolume: false,
            mappedBy: `auto-${link.source}`,
            confidence: mapped.confidence,
            useOnce: false,
            isActive: true,
          },
        });

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
          foodId: mapped.foodId,      // prefixed mapper id; `fatsecretFoodId` was a misnomer
          mappedSource: link.source,
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
