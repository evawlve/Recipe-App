import { prisma } from '@/lib/db';

export async function getForYouRecipes({ 
  limit = 12, 
  recentViewedIds = [] 
}: { 
  limit?: number; 
  recentViewedIds?: string[] 
} = {}) {
  // Get tags from recently viewed recipes for personalization
  let recentTags = new Set<string>();
  if (recentViewedIds.length > 0) {
    const recentRecipes = await prisma.recipe.findMany({
      where: { id: { in: recentViewedIds } },
      include: {
        tags: {
          include: { tag: true }
        }
      },
      take: 10 // Limit to last 10 viewed recipes
    });
    
    recentRecipes.forEach(recipe => {
      recipe.tags.forEach(rt => {
        recentTags.add(rt.tag.id);
      });
    });
  }
  
  // Get candidate recipes (last 30 days)
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const candidates = await prisma.recipe.findMany({
    where: { 
      createdAt: { gte: since },
      // Exclude recently viewed recipes to avoid repetition
      ...(recentViewedIds.length > 0 ? { id: { notIn: recentViewedIds } } : {})
    },
    include: {
      _count: { select: { likes: true, comments: true } },
      photos: { take: 1 },
      author: {
        select: {
          id: true,
          name: true,
          username: true,
          displayName: true,
          avatarKey: true,
        }
      },
      tags: { 
        include: { 
          tag: {
            select: {
              id: true,
              slug: true,
              label: true,
            }
          } 
        } 
      },
      nutrition: {
        select: {
          calories: true,
          proteinG: true,
          carbsG: true,
          fatG: true,
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 200 // Large candidate window
  });
  
  // Score and rank candidates
  const scored = candidates.map(recipe => {
    let score = 0;
    
    // Base score from engagement
    const engagement = (recipe._count.likes || 0) + 2 * (recipe._count.comments || 0);
    score += engagement;
    
    // Recency boost (newer recipes get higher scores)
    const hoursSinceCreated = (Date.now() - recipe.createdAt.getTime()) / (1000 * 60 * 60);
    const recencyBoost = Math.exp(-hoursSinceCreated / 48); // 2-day half-life
    score += recencyBoost * 10;
    
    // Personalization boost based on recent views
    if (recentTags.size > 0) {
      const recipeTagIds = new Set(recipe.tags.map(rt => rt.tag.id));
      const overlappingTags = [...recentTags].filter(tagId => recipeTagIds.has(tagId));
      const personalizationBoost = Math.min(overlappingTags.length * 0.1, 0.5); // Cap at 0.5
      score += personalizationBoost;
    }
    
    return { recipe, score };
  });
  
  // Sort by score and take the requested limit
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.recipe);
}
