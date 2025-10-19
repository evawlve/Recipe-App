import { prisma } from '../db';
import { FOOD_MAPPING_V2 } from '../flags';
import { logger } from '../logger';

/**
 * Automatically map ingredients to foods based on name matching
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

  let mappedCount = 0;

  for (const ingredient of ingredients) {
    // Skip if ingredient already has a mapping
    if (ingredient.foodMaps.length > 0) {
      continue;
    }
    // Search for matching foods
    const matchingFoods = await prisma.food.findMany({
      where: {
        OR: [
          { name: { contains: ingredient.name, mode: 'insensitive' } },
          { name: { contains: ingredient.name.toLowerCase(), mode: 'insensitive' } }
        ]
      },
      take: 5 // Limit to top 5 matches
    });

    // Find the best match using fuzzy matching
    const bestMatch = findBestMatch(ingredient.name, matchingFoods);
    
    if (bestMatch) {
      const confidence = calculateConfidence(ingredient.name, bestMatch.name);
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

  logger.info('autoMap:done', { recipeId, mappedCount });
  return mappedCount;
}

/**
 * Find the best matching food for an ingredient
 */
function findBestMatch(ingredientName: string, foods: any[]): any | null {
  if (foods.length === 0) return null;

  const ingredientLower = ingredientName.toLowerCase();
  
  // Exact match (case-insensitive)
  const exactMatch = foods.find(food => 
    food.name.toLowerCase() === ingredientLower
  );
  if (exactMatch) return exactMatch;

  // Handle common variations and synonyms
  const variations = getIngredientVariations(ingredientName);
  
  for (const variation of variations) {
    const match = foods.find(food => 
      food.name.toLowerCase().includes(variation.toLowerCase()) ||
      variation.toLowerCase().includes(food.name.toLowerCase())
    );
    if (match) return match;
  }

  // Partial match (contains)
  const partialMatch = foods.find(food => 
    food.name.toLowerCase().includes(ingredientLower) ||
    ingredientLower.includes(food.name.toLowerCase())
  );
  
  return partialMatch || null;
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
 */
function calculateConfidence(ingredientName: string, foodName: string): number {
  const ingredient = ingredientName.toLowerCase();
  const food = foodName.toLowerCase();
  
  // Exact match
  if (ingredient === food) return 1.0;
  
  // Contains match
  if (food.includes(ingredient) || ingredient.includes(food)) return 0.9;
  
  // Partial match
  const commonWords = ingredient.split(' ').filter(word => 
    food.includes(word) && word.length > 2
  );
  
  if (commonWords.length > 0) {
    return Math.min(0.8, 0.5 + (commonWords.length * 0.1));
  }
  
  return 0.5; // Default confidence for any match
}
