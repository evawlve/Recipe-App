import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  const since = new Date(Date.now() - 30*24*3600*1000);
  const rows = await prisma.recipe.findMany({
    where: { createdAt: { gte: since } },
    include: { 
      _count: { select: { likes: true, comments: true } }, 
      photos: { take: 1 }, 
      author: {
        select: {
          id: true,
          name: true,
          username: true,
          avatarUrl: true,
        }
      }, 
      tags: { include: { tag: true } } 
    },
    orderBy: { createdAt: 'desc' },
    take: 200 // candidate window
  });

  const scored = rows
    .map(r => ({ r, s: (r._count.likes||0) + 2*(r._count.comments||0) }))
    .sort((a,b)=>b.s-a.s || +b.r.createdAt - +a.r.createdAt)
    .slice(0, 12)
    .map(x => x.r);

  return Response.json({ items: scored });
}
