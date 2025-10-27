import { prisma } from '@/lib/db';

export async function getFollowingRecipes({ 
  userId, 
  limit = 12 
}: { 
  userId: string; 
  limit?: number; 
}) {
  // who I follow
  const following = await prisma.follow.findMany({
    where: { followerId: userId },
    select: { followingId: true }
  });
  
  const ids = following.map(f => f.followingId);
  if (ids.length === 0) {
    return [];
  }

  const items = await prisma.recipe.findMany({
    where: { authorId: { in: ids } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      author: {
        select: {
          id: true,
          name: true,
          username: true,
          displayName: true,
          avatarKey: true,
        }
      },
      photos: { take: 1 },
      tags: { include: { tag: true } },
      nutrition: true,
      _count: { select: { likes: true, comments: true } },
    }
  });

  return items;
}
