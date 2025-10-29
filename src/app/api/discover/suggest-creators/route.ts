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
	
  let userId: string | null = null;
  try { 
    const user = await getCurrentUser();
    userId = user?.id || null;
  } catch {}

  const since = new Date(Date.now() - 60*24*3600*1000);

  // Who I already follow
  const following = userId
    ? await prisma.follow.findMany({ where: { followerId: userId }, select: { followingId: true }})
    : [];
  const excludeIds = new Set([...(following.map(f=>f.followingId)), userId ?? '']);

  // Pull active creators window
  const creators = await prisma.user.findMany({
    where: {
      id: { notIn: Array.from(excludeIds) },
      recipes: { some: { createdAt: { gte: since } } }
    },
    select: {
      id: true, 
      name: true, 
      username: true, 
      avatarUrl: true,
      recipes: {
        where: { createdAt: { gte: since } },
        select: {
          id: true, 
          createdAt: true,
          photos: { take: 1, select: { s3Key: true } },
          _count: { select: { likes: true, comments: true } }
        },
        take: 8,
        orderBy: { createdAt: 'desc' }
      }
    },
    take: 100
  });

  // Get mutual followers for each creator first
  const creatorsWithMutualFollowers = await Promise.all(creators.map(async (c) => {
    // Get mutual followers (users who follow both the current user and this creator)
    const mutualFollowers = userId ? await prisma.follow.findMany({
      where: {
        followingId: c.id,
        followerId: {
          in: (await prisma.follow.findMany({
            where: { followerId: userId },
            select: { followingId: true }
          })).map(f => f.followingId)
        }
      },
      include: {
        follower: {
          select: {
            id: true,
            username: true,
            name: true
          }
        }
      },
      take: 3 // Get up to 3 mutual followers for display
    }) : [];

    return {
      ...c,
      mutualFollowers: mutualFollowers.map(mf => ({
        id: mf.follower.id,
        username: mf.follower.username,
        name: mf.follower.name
      })),
      totalMutualFollowers: mutualFollowers.length
    };
  }));

  // Calculate ranking scores
  const scored = creatorsWithMutualFollowers.map(c => {
    const rCount = c.recipes.length;
    const likes = c.recipes.reduce((a,r)=>a+(r._count.likes||0),0);
    const comments = c.recipes.reduce((a,r)=>a+(r._count.comments||0),0);
    
    // Ranking system (higher score = more impactful):
    // 1. Mutual followings (most important) - weight: 1000
    // 2. Number of followers/likes on their recipes - weight: 1
    // 3. Number of recipes - weight: 0.1
    const mutualScore = c.totalMutualFollowers * 1000;
    const engagementScore = likes + (comments * 2); // comments worth 2x likes
    const recipeScore = rCount * 0.1;
    
    const totalScore = mutualScore + engagementScore + recipeScore;
    
    return { c, score: totalScore };
  }).sort((a,b)=>b.score-a.score).slice(0, 12);

  // Return the top 12 creators with their data
  const items = scored.map(({c}) => ({
    id: c.id,
    name: c.name,
    username: c.username,
    image: c.avatarUrl,
    mutualFollowers: c.mutualFollowers,
    totalMutualFollowers: c.totalMutualFollowers
  }));

  return Response.json({ items });
}
