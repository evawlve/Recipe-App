import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET(req: NextRequest) {
  let userId: string | null = null;
  try {
    const user = await getCurrentUser();
    userId = user?.id || null;
  } catch { 
    // unauthenticated 
  }
  
  if (!userId) {
    return Response.json({ items: [], nextCursor: null }, { status: 200 });
  }

  const url = new URL(req.url);
  const cursor = url.searchParams.get('cursor') || undefined;
  const take = Math.min(24, Math.max(6, Number(url.searchParams.get('take') || 12)));

  // who I follow
  const following = await prisma.follow.findMany({
    where: { followerId: userId },
    select: { followingId: true }
  });
  
  const ids = following.map(f => f.followingId);
  if (ids.length === 0) {
    return Response.json({ items: [], nextCursor: null });
  }

  const items = await prisma.recipe.findMany({
    where: { authorId: { in: ids } },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      author: {
        select: {
          id: true,
          name: true,
          username: true,
          avatarUrl: true,
        }
      },
      photos: { take: 1 },
      tags: { include: { tag: true } },
      nutrition: true,
      _count: { select: { likes: true, comments: true } },
    }
  });

  const nextCursor = items.length > take ? items.pop()!.id : null;
  return Response.json({ items, nextCursor });
}
