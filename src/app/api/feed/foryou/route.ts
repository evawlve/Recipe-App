import { NextRequest, NextResponse } from 'next/server';
// Sentry disabled - can be re-enabled in the future
// import * as Sentry from '@sentry/nextjs';
import { withSpan } from '@/lib/obs/withSpan';
import { capture } from '@/lib/obs/capture';
import { shouldSkipCache, setCacheHeaders } from '@/lib/cache';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
export async function GET(req: NextRequest) {
	// Sentry disabled
	// Sentry.setTag('endpoint', 'feed-foryou');
	// Skip execution during build time
	if (process.env.NEXT_PHASE === 'phase-production-build' || 
	    process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
	    process.env.BUILD_TIME === 'true') {
		return NextResponse.json({ error: "Not available during build" }, { status: 503 });
	}

	// Import only when not in build mode
	const { prisma } = await import("@/lib/db");
	const { getCurrentUser } = await import("@/lib/auth");
	
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '12');
    const cursor = searchParams.get('cursor');
    
    // Check if we should skip caching
    const skipCache = shouldSkipCache(req);
    
    // Get current user (optional for anonymous users)
    const user = await getCurrentUser().catch(() => null);
    
    // Build cache key: user-scoped, so include userId + page params
    const userId = user?.id || 'anonymous';
    const cacheKey = `foryou:${userId}:${limit}:${cursor || ''}`;
    
    // Get recently viewed recipe IDs from cookie
    const recentViewedIds = getRecentViewedIds(req);
    
    // Get tags from recently viewed recipes for personalization
    let recentTags = new Set<string>();
    if (recentViewedIds.length > 0) {
      const recentRecipes = await withSpan('db.recipe.findMany.recentViewed', async () => prisma.recipe.findMany({
        where: { id: { in: recentViewedIds } },
        include: {
          tags: {
            include: { tag: true }
          }
        },
        take: 10 // Limit to last 10 viewed recipes
      }));
      
      recentRecipes.forEach(recipe => {
        recipe.tags.forEach(rt => {
          recentTags.add(rt.tag.id);
        });
      });
    }
    
    // Get candidate recipes (last 30 days)
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const candidates = await withSpan('db.recipe.findMany.candidates', async () => prisma.recipe.findMany({
      where: { 
        createdAt: { gte: since },
        // Exclude recently viewed recipes to avoid repetition
        ...(recentViewedIds.length > 0 ? { id: { notIn: recentViewedIds } } : {})
      },
      include: {
        _count: { select: { likes: true, comments: true } },
        photos: { 
          take: 1,
          orderBy: [{ isMainPhoto: 'desc' }, { id: 'asc' }]
        },
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
    }));
    
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
    const ranked = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(x => x.recipe);
    
    // Generate next cursor
    const nextCursor = ranked.length === limit ? ranked[ranked.length - 1].id : null;
    
    // Create response
    const response = NextResponse.json({
      items: ranked,
      nextCursor
    });
    
    // Add cache headers if not skipped (user-scoped, so use Vary: Cookie)
    if (!skipCache) {
      // Sentry disabled
      // Sentry.addBreadcrumb({
      //   category: 'cache',
      //   message: 'Cache enabled for foryou feed',
      //   level: 'info',
      //   data: { cacheKey, 'cache.hit': false } // We can't determine HTTP cache hits from server
      // });
      setCacheHeaders(response, true); // isUserScoped = true
    } else {
      // Sentry disabled
      // Sentry.addBreadcrumb({
      //   category: 'cache',
      //   message: 'Cache skipped for foryou feed',
      //   level: 'info',
      //   data: { cacheKey, 'cache.hit': false }
      // });
    }
    
    return response;
    
  } catch (error) {
    capture(error, { endpoint: 'foryou' });
    return NextResponse.json(
      { error: 'Failed to load For-You feed' },
      { status: 500 }
    );
  }
}

function getRecentViewedIds(req: NextRequest): string[] {
  const cookie = req.cookies.get('ms_recent');
  if (!cookie?.value) return [];
  
  try {
    return cookie.value.split(',').filter(Boolean);
  } catch {
    return [];
  }
}
