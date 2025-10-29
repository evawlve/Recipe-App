import { NextRequest, NextResponse } from 'next/server';
export async function GET(req: NextRequest) {
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
    const cursor = searchParams.get('cursor');
    const limit = parseInt(searchParams.get('limit') || '12');

    // Get current user (required for Following feed)
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get users that the current user follows
    const following = await prisma.follow.findMany({
      where: { followerId: user.id },
      select: { followingId: true }
    });

    const followingIds = following.map(f => f.followingId);

    if (followingIds.length === 0) {
      // User is not following anyone, return empty feed
      return NextResponse.json({
        items: [],
        nextCursor: null
      });
    }

    // Following feed: Show recipes from users they follow
    const whereClause: any = {
      authorId: { in: followingIds }
    };
    
    if (cursor) {
      whereClause.id = { lt: cursor };
    }

    const recipes = await prisma.recipe.findMany({
      where: whereClause,
      select: {
        id: true,
        title: true,
        authorId: true,
        bodyMd: true,
        servings: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
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
        nutrition: {
          select: {
            calories: true,
            proteinG: true,
            carbsG: true,
            fatG: true,
          }
        },
        _count: {
          select: {
            likes: true,
            comments: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // Take one extra to check if there are more
    });

    const hasMore = recipes.length > limit;
    const items = hasMore ? recipes.slice(0, limit) : recipes;
    const nextCursor = hasMore ? items[items.length - 1]?.id : null;

    return NextResponse.json({
      items: items.map(recipe => ({
        id: recipe.id,
        title: recipe.title,
        authorId: recipe.authorId,
        bodyMd: recipe.bodyMd,
        servings: recipe.servings,
        parentId: recipe.parentId,
        createdAt: recipe.createdAt,
        updatedAt: recipe.updatedAt,
        photos: recipe.photos,
        author: recipe.author,
        _count: recipe._count,
        nutrition: recipe.nutrition,
        savedByMe: false, // Will be handled by SaveButton component
        likedByMe: false  // Will be handled by RecipeCard component
      })),
      nextCursor
    });

  } catch (error) {
    console.error('Following feed error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
