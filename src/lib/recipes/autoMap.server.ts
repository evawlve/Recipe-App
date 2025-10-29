import 'server-only';
import { prisma } from '@/lib/db';

export async function getAutoMapSuggestions(recipeId: string) {
  // Read recipe data directly from DB
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    include: { 
      ingredients: true, 
      nutrition: true, 
      tags: { include: { tag: true } } 
    },
  });
  
  if (!recipe) {
    return { suggestions: [] };
  }

  // Import auto-map logic dynamically to avoid build-time issues
  const { autoMapIngredients } = await import('@/lib/nutrition/auto-map');
  
  // Run auto-mapping analysis
  const mappedCount = await autoMapIngredients(recipeId);
  
  return { 
    suggestions: [], // You can expand this to return actual suggestions
    mappedCount,
    recipe: {
      id: recipe.id,
      title: recipe.title,
      ingredientCount: recipe.ingredients.length
    }
  };
}
