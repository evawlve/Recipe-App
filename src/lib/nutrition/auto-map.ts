import { prisma } from '../db';
import { FOOD_MAPPING_V2 } from '../flags';
import { logger } from '../logger';
import { batchFetchAliases } from '../foods/alias-cache';

/**
 * Automatically map ingredients to foods based on name matching
 * Uses batched queries to avoid N+1 query issues
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

  // Batch query: search for all ingredient names at once
  // Build a combined OR query for all ingredient names
  const searchConditions = unmappedIngredients.flatMap(ingredient => [
    { name: { contains: ingredient.name, mode: 'insensitive' as const } },
    { name: { contains: ingredient.name.toLowerCase(), mode: 'insensitive' as const } }
  ]);

  // Query all potential matching foods in one go
  const allCandidateFoods = await prisma.food.findMany({
    where: {
      OR: searchConditions
    },
    take: unmappedIngredients.length * 10, // Get enough candidates for all ingredients
    select: {
      id: true,
      name: true,
      verification: true,
      categoryId: true,
      brand: true
    }
  });

  // Batch fetch aliases for all candidate foods
  const foodIds = allCandidateFoods.map(f => f.id);
  const aliasMap = await batchFetchAliases(foodIds);

  // Build a searchable index of foods with their aliases
  type FoodWithAliases = typeof allCandidateFoods[0] & { aliases: string[] };
  const foodsWithAliases: FoodWithAliases[] = allCandidateFoods.map(food => ({
    ...food,
    aliases: aliasMap.get(food.id) || []
  }));

  let mappedCount = 0;

  // Now match each ingredient against the batch-fetched foods
  for (const ingredient of unmappedIngredients) {
    // Filter foods that match this specific ingredient
    const matchingFoods = filterMatchingFoods(ingredient.name, foodsWithAliases);
    
    // Find the best match using fuzzy matching (now includes alias matching)
    const bestMatch = findBestMatch(ingredient.name, matchingFoods);
    
    if (bestMatch) {
      const confidence = calculateConfidence(ingredient.name, bestMatch.name, bestMatch.aliases);
      
      // Higher confidence thresholds for auto-mapping
      const minConfidence = bestMatch.verification === 'verified' ? 0.6 : 0.7;
      
      if (confidence >= minConfidence) {
        try {
          if (FOOD_MAPPING_V2) {
            await prisma.ingredientFoodMap.create({
              data: {
                ingredientId: ingredient.id,
                foodId: bestMatch.id,
                mappedBy: 'auto',
                confidence,
                useOnce: false,
                isActive: true,
              },
            });
          } else {
            // Check if mapping already exists
            const existingMapping = await prisma.ingredientFoodMap.findFirst({
              where: {
                ingredientId: ingredient.id,
                foodId: bestMatch.id,
              },
            });

            if (existingMapping) {
              // Update existing mapping
              await prisma.ingredientFoodMap.update({
                where: { id: existingMapping.id },
                data: { confidence },
              });
            } else {
              // Create new mapping
              await prisma.ingredientFoodMap.create({
                data: {
                  ingredientId: ingredient.id,
                  foodId: bestMatch.id,
                  confidence,
                  mappedBy: 'auto',
                },
              });
            }
          }
          logger.info('autoMap:mapped', { ingredientId: ingredient.id, foodId: bestMatch.id, confidence });
          mappedCount++;
        } catch (err) {
          logger.warn('autoMap:error-map', { ingredientId: ingredient.id, err: (err as Error).message });
        }
      }
    }
  }

  logger.info('autoMap:done', { recipeId, mappedCount, totalIngredients: ingredients.length, unmapped: unmappedIngredients.length });
  return mappedCount;
}

/**
 * Filter foods that match a given ingredient name
 * Considers both food name and aliases
 */
function filterMatchingFoods(ingredientName: string, foods: Array<{ name: string; aliases: string[]; id: string; verification: string; categoryId: string | null; brand: string | null }>): typeof foods {
  const ingredientLower = ingredientName.toLowerCase();
  
  return foods.filter(food => {
    // Check food name
    if (food.name.toLowerCase().includes(ingredientLower) || 
        ingredientLower.includes(food.name.toLowerCase())) {
      return true;
    }
    
    // Check aliases
    for (const alias of food.aliases) {
      if (alias.toLowerCase().includes(ingredientLower) || 
          ingredientLower.includes(alias.toLowerCase())) {
        return true;
      }
    }
    
    return false;
  }).slice(0, 5); // Limit to top 5 matches per ingredient
}

/**
 * Find the best matching food for an ingredient
 * Now checks both food name and aliases
 */
function findBestMatch(ingredientName: string, foods: Array<{ name: string; aliases?: string[]; id: string; verification: string }>): typeof foods[0] | null {
  if (foods.length === 0) return null;

  const ingredientLower = ingredientName.toLowerCase();
  
  // 1. Exact match on food name (case-insensitive)
  const exactMatch = foods.find(food => 
    food.name.toLowerCase() === ingredientLower
  );
  if (exactMatch) return exactMatch;

  // 2. Exact match on aliases
  const exactAliasMatch = foods.find(food => 
    (food.aliases || []).some(alias => alias.toLowerCase() === ingredientLower)
  );
  if (exactAliasMatch) return exactAliasMatch;

  // 3. Handle common variations and synonyms
  const variations = getIngredientVariations(ingredientName);
  
  for (const variation of variations) {
    const match = foods.find(food => {
      const nameLower = food.name.toLowerCase();
      const varLower = variation.toLowerCase();
      
      // Check name
      if (nameLower.includes(varLower) || varLower.includes(nameLower)) {
        return true;
      }
      
      // Check aliases
      return (food.aliases || []).some(alias => {
        const aliasLower = alias.toLowerCase();
        return aliasLower.includes(varLower) || varLower.includes(aliasLower);
      });
    });
    if (match) return match;
  }

  // 4. Partial match on name (contains)
  const partialMatch = foods.find(food => 
    food.name.toLowerCase().includes(ingredientLower) ||
    ingredientLower.includes(food.name.toLowerCase())
  );
  if (partialMatch) return partialMatch;

  // 5. Partial match on aliases
  const partialAliasMatch = foods.find(food =>
    (food.aliases || []).some(alias => {
      const aliasLower = alias.toLowerCase();
      return aliasLower.includes(ingredientLower) || ingredientLower.includes(aliasLower);
    })
  );
  
  return partialAliasMatch || null;
}

/**
 * Get common variations and synonyms for ingredient names
 */
function getIngredientVariations(name: string): string[] {
  const variations: string[] = [];
  const lower = name.toLowerCase();
  
  // Common food variations
  const synonyms: Record<string, string[]> = {
    'greek yogurt': ['greek yoghurt', 'yogurt', 'yoghurt'],
    'almonds': ['almond'],
    'oats': ['oat', 'rolled oats', 'oatmeal'],
    'banana': ['bananas'],
    'chicken breast': ['chicken', 'chicken breast meat'],
    'ground turkey': ['turkey', 'ground turkey meat'],
    'salmon': ['salmon fillet', 'salmon fish'],
    'eggs': ['egg'],
    'cottage cheese': ['cottage'],
    'whey protein': ['protein powder', 'whey'],
    'brown rice': ['rice'],
    'white rice': ['rice'],
    'sweet potato': ['sweet potatoes', 'yam'],
    'quinoa': ['quinoa grain'],
    'avocado': ['avocados'],
    'olive oil': ['olive'],
    'coconut oil': ['coconut'],
    'broccoli': ['broccoli florets'],
    'spinach': ['spinach leaves'],
    'carrots': ['carrot'],
    'milk': ['dairy milk'],
    'cheddar cheese': ['cheddar', 'cheese']
  };

  // Add the original name
  variations.push(name);
  
  // Add synonyms
  for (const [key, values] of Object.entries(synonyms)) {
    if (lower.includes(key) || key.includes(lower)) {
      variations.push(...values);
    }
  }

  return [...new Set(variations)]; // Remove duplicates
}

/**
 * Calculate confidence score for a match
 * Now considers aliases for better matching
 */
function calculateConfidence(ingredientName: string, foodName: string, aliases: string[] = []): number {
  const ingredient = ingredientName.toLowerCase();
  const food = foodName.toLowerCase();
  
  // Exact match on food name
  if (ingredient === food) return 1.0;
  
  // Exact match on alias
  if (aliases.some(alias => alias.toLowerCase() === ingredient)) return 0.95;
  
  // Contains match on food name
  if (food.includes(ingredient) || ingredient.includes(food)) return 0.9;
  
  // Contains match on alias
  if (aliases.some(alias => {
    const aliasLower = alias.toLowerCase();
    return aliasLower.includes(ingredient) || ingredient.includes(aliasLower);
  })) {
    return 0.85;
  }
  
  // Partial match based on common words
  const commonWords = ingredient.split(' ').filter(word => 
    food.includes(word) && word.length > 2
  );
  
  // Check for common words in aliases too
  const aliasCommonWords = aliases.flatMap(alias => 
    ingredient.split(' ').filter(word => 
      alias.toLowerCase().includes(word) && word.length > 2
    )
  );
  
  const totalCommonWords = commonWords.length + aliasCommonWords.length;
  
  if (totalCommonWords > 0) {
    return Math.min(0.8, 0.5 + (totalCommonWords * 0.1));
  }
  
  return 0.5; // Default confidence for any match
}
