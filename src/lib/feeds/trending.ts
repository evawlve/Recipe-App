import { prisma } from '@/lib/db';

function recencyDecay(d: Date) {
  const h = (Date.now() - d.getTime()) / 36e5;
  return Math.exp(-h / 96); // ~4-day half-life-ish
}

/**
 * Optimized trending recipes query
 * 
 * Strategy:
 * 1. First fetch lightweight data (just IDs, counts, dates) for scoring
 * 2. Score and rank candidates in-memory
 * 3. Then fetch full details only for the top N recipes
 * 
 * This reduces the amount of data transferred from DB significantly
 */
export async function getTrendingRecipes({ limit = 12 }: { limit?: number } = {}) {
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  
  // Step 1: Fetch lightweight data for scoring (no heavy relations)
  const candidates = await prisma.recipe.findMany({
    where: { createdAt: { gte: since } },
    select: { 
      id: true,
      createdAt: true,
      _count: { select: { likes: true, comments: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 150, // scoring candidates window
  });

  // Step 2: Score and rank
  const scored = candidates
    .map(r => {
      const e = (r._count.likes ?? 0) + 2 * (r._count.comments ?? 0);
      const score = e * recencyDecay(r.createdAt);
      return { id: r.id, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Step 3: Fetch full details only for top recipes (in same order)
  if (scored.length > 0) {
    const topIds = scored.map(x => x.id);
    const recipes = await prisma.recipe.findMany({
      where: { id: { in: topIds } },
      select: {
        id: true,
        title: true,
        authorId: true,
        bodyMd: true,
        servings: true,
        prepTime: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
        photos: { 
          take: 1,
          select: {
            id: true,
            s3Key: true,
            width: true,
            height: true
          }
        },
        author: {
          select: {
            id: true,
            name: true,
            username: true,
            displayName: true,
            avatarKey: true
          }
        },
        nutrition: {
          select: {
            calories: true,
            proteinG: true,
            carbsG: true,
            fatG: true,
            healthScore: true
          }
        },
        tags: { 
          include: { tag: true }
        },
        _count: { 
          select: { likes: true, comments: true } 
        }
      }
    });

    // Restore original scoring order
    const recipeMap = new Map(recipes.map(r => [r.id, r]));
    return topIds.map(id => recipeMap.get(id)!).filter(Boolean);
  }

  // Fallback: newest from last 30 days if nothing scored well
  const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  return prisma.recipe.findMany({
    where: { createdAt: { gte: since30 } },
    select: {
      id: true,
      title: true,
      authorId: true,
      bodyMd: true,
      servings: true,
      prepTime: true,
      parentId: true,
      createdAt: true,
      updatedAt: true,
      photos: { 
        take: 1,
        select: {
          id: true,
          s3Key: true,
          width: true,
          height: true
        }
      },
      author: {
        select: {
          id: true,
          name: true,
          username: true,
          displayName: true,
          avatarKey: true
        }
      },
      nutrition: {
        select: {
          calories: true,
          proteinG: true,
          carbsG: true,
          fatG: true,
          healthScore: true
        }
      },
      tags: { 
        include: { tag: true }
      },
      _count: { 
        select: { likes: true, comments: true } 
      }
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
