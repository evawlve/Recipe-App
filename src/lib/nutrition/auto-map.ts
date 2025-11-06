import { prisma } from '../db';
import { FOOD_MAPPING_V2 } from '../flags';
import { logger } from '../logger';
import { batchFetchAliases } from '../foods/alias-cache';
import { normalizeQuery, tokens } from '../search/normalize';
import { parseIngredientLine } from '../parse/ingredient-line';
import { rankCandidates, type Candidate } from '../foods/rank';
import { kcalBandForQuery } from '../foods/plausibility';

/**
 * Automatically map ingredients to foods based on name matching
 * Uses batched queries to avoid N+1 query issues
 * Now uses the same search logic as the manual search API for consistency
 */
export async function autoMapIngredients(recipeId: string): Promise<number> {
  logger.info('autoMap:start', { recipeId, v2: FOOD_MAPPING_V2 });
  
  // Get all ingredients for this recipe with their existing mappings
  const ingredients = await prisma.ingredient.findMany({
    where: { recipeId },
    include: {
      foodMaps: true
    }
  });

  // Filter to only unmapped ingredients
  const unmappedIngredients = ingredients.filter(i => i.foodMaps.length === 0);
  
  if (unmappedIngredients.length === 0) {
    logger.info('autoMap:done', { recipeId, mappedCount: 0, reason: 'no_unmapped' });
    return 0;
  }

  // Extract core ingredient names and normalize them
  // For ingredients like "1 cup fat free greek yogurt", extract "fat free greek yogurt"
  // and normalize to "nonfat greek yogurt", then tokenize to ["nonfat", "greek", "yogurt"]
  const ingredientSearchTerms = unmappedIngredients.map(ingredient => {
    // Try to parse the ingredient line to extract just the name
    // Reconstruct the full ingredient line: "1 cup fat free greek yogurt"
    let ingredientLine: string;
    if (ingredient.unit && ingredient.unit.trim()) {
      ingredientLine = `${ingredient.qty} ${ingredient.unit} ${ingredient.name}`;
    } else {
      // If no unit, just use qty and name
      ingredientLine = `${ingredient.qty} ${ingredient.name}`;
    }
    
    const parsed = parseIngredientLine(ingredientLine);
    // Use parsed name if available, otherwise fall back to ingredient.name
    // (in case ingredient.name is already clean like "fat free greek yogurt")
    const coreName = parsed?.name || ingredient.name;
    
    // Normalize and tokenize like the search API does
    const normalized = normalizeQuery(coreName);
    const searchTokens = tokens(normalized);
    
    return {
      ingredientId: ingredient.id,
      originalName: ingredient.name,
      coreName,
      normalized,
      searchTokens
    };
  });

  // Build search queries for each ingredient using normalized tokens
  // Each ingredient gets an AND query (all tokens must match) with OR conditions for name/brand/alias
  const allCandidateFoodsMap = new Map<string, Array<{
    id: string;
    name: string;
    brand: string | null;
    source: string;
    verification: string;
    categoryId: string | null;
    kcal100: number;
    protein100: number;
    carbs100: number;
    fat100: number;
    densityGml: number | null;
    popularity: number;
  }>>();
  
  // Process each ingredient separately to get better matches
  for (const { ingredientId, searchTokens } of ingredientSearchTerms) {
    if (searchTokens.length === 0) continue;
    
    // Build AND query: all tokens must match (in name OR brand OR alias)
    const andORs = searchTokens.map(t => ({
      OR: [
        { name: { contains: t, mode: 'insensitive' as const } },
        { brand: { contains: t, mode: 'insensitive' as const } },
        { aliases: { some: { alias: { contains: t, mode: 'insensitive' as const } } } },
      ]
    }));

    // Fetch full food data needed for ranking (same fields as search API)
    const foods = await prisma.food.findMany({
      where: {
        AND: andORs
      },
      take: 50, // Get enough candidates per ingredient
      select: {
        id: true,
        name: true,
        brand: true,
        source: true,
        verification: true,
        categoryId: true,
        kcal100: true,
        protein100: true,
        carbs100: true,
        fat100: true,
        densityGml: true,
        popularity: true,
      }
    });

    allCandidateFoodsMap.set(ingredientId, foods);
  }

  // Collect all unique food IDs for batch alias and barcode fetching
  const allFoodIds = new Set<string>();
  for (const foods of allCandidateFoodsMap.values()) {
    for (const food of foods) {
      allFoodIds.add(food.id);
    }
  }

  // Batch fetch aliases for all candidate foods
  const aliasMap = await batchFetchAliases(Array.from(allFoodIds));
  
  // Batch fetch barcodes for all candidate foods (needed for ranking)
  const barcodes = await prisma.barcode.findMany({
    where: {
      foodId: { in: Array.from(allFoodIds) }
    },
    select: {
      foodId: true,
      gtin: true
    }
  });
  
  // Build barcode map: foodId -> gtin[]
  const barcodeMap = new Map<string, string[]>();
  for (const barcode of barcodes) {
    const existing = barcodeMap.get(barcode.foodId) || [];
    existing.push(barcode.gtin);
    barcodeMap.set(barcode.foodId, existing);
  }

  let mappedCount = 0;

  // Now match each ingredient against its candidate foods using the same ranking as manual search
  for (const { ingredientId, originalName, coreName, normalized, searchTokens } of ingredientSearchTerms) {
    const candidateFoods = allCandidateFoodsMap.get(ingredientId) || [];
    
    if (candidateFoods.length === 0) continue;
    
    // Build candidates in the format expected by rankCandidates
    const candidates: Candidate[] = candidateFoods.map(food => ({
      food: {
        id: food.id,
        name: food.name,
        brand: food.brand,
        source: food.source,
        verification: food.verification as 'verified' | 'unverified' | 'suspect',
        kcal100: food.kcal100,
        protein100: food.protein100,
        carbs100: food.carbs100,
        fat100: food.fat100,
        densityGml: food.densityGml,
        categoryId: food.categoryId,
        popularity: food.popularity,
      },
      aliases: aliasMap.get(food.id) || [],
      barcodes: barcodeMap.get(food.id) || [],
      usedByUserCount: 0, // TODO: could personalize later based on user history
    }));

    // Use the same ranking algorithm as manual search
    const ranked = rankCandidates(candidates, {
      query: coreName, // Use the core name (e.g., "skinless chicken breast")
      kcalBand: kcalBandForQuery(coreName)
    });

    // Get the top-ranked candidate
    const topCandidate = ranked[0];
    
    if (topCandidate && topCandidate.confidence > 0) {
      // Confidence thresholds for auto-mapping
      // Lower threshold for verified foods since they're more trustworthy
      const minConfidence = topCandidate.candidate.food.verification === 'verified' ? 0.45 : 0.65;
      
      if (topCandidate.confidence >= minConfidence) {
        try {
          if (FOOD_MAPPING_V2) {
            await prisma.ingredientFoodMap.create({
              data: {
                ingredientId: ingredientId,
                foodId: topCandidate.candidate.food.id,
                mappedBy: 'auto',
                confidence: topCandidate.confidence,
                useOnce: false,
                isActive: true,
              },
            });
          } else {
            // Check if mapping already exists
            const existingMapping = await prisma.ingredientFoodMap.findFirst({
              where: {
                ingredientId: ingredientId,
                foodId: topCandidate.candidate.food.id,
              },
            });

            if (existingMapping) {
              // Update existing mapping
              await prisma.ingredientFoodMap.update({
                where: { id: existingMapping.id },
                data: { confidence: topCandidate.confidence },
              });
            } else {
              // Create new mapping
              await prisma.ingredientFoodMap.create({
                data: {
                  ingredientId: ingredientId,
                  foodId: topCandidate.candidate.food.id,
                  confidence: topCandidate.confidence,
                  mappedBy: 'auto',
                },
              });
            }
          }
          logger.info('autoMap:mapped', { 
            ingredientId, 
            foodId: topCandidate.candidate.food.id, 
            confidence: topCandidate.confidence, 
            originalName, 
            coreName,
            foodName: topCandidate.candidate.food.name
          });
          mappedCount++;
        } catch (err) {
          logger.warn('autoMap:error-map', { ingredientId, err: (err as Error).message });
        }
      } else {
        logger.info('autoMap:skipped-low-confidence', {
          ingredientId,
          confidence: topCandidate.confidence,
          minConfidence,
          foodName: topCandidate.candidate.food.name
        });
      }
    }
  }

  logger.info('autoMap:done', { recipeId, mappedCount, totalIngredients: ingredients.length, unmapped: unmappedIngredients.length });
  return mappedCount;
}
