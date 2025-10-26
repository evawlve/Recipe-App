import { prisma } from '@/lib/db';

function recencyDecay(d: Date) {
  const h = (Date.now() - d.getTime()) / 36e5;
  return Math.exp(-h / 96); // ~4-day half-life-ish
}

export async function getTrendingRecipes({ limit = 12 }: { limit?: number } = {}) {
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const rows = await prisma.recipe.findMany({
    where: { createdAt: { gte: since } },
    include: { 
      _count: { select: { likes: true, comments: true } }, 
      photos: { take: 1 }, 
      author: true, 
      tags: { include: { tag: true } },
      nutrition: true
    },
    orderBy: { createdAt: 'desc' }, // base order; we'll score in JS
    take: 150, // candidates window
  });

  const scored = rows
    .map(r => {
      const e = (r._count.likes ?? 0) + 2 * (r._count.comments ?? 0);
      const score = e * recencyDecay(r.createdAt);
      return { r, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.r);

  // fallback: newest from last 30 days if nothing
  if (scored.length > 0) return scored;

  const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  return prisma.recipe.findMany({
    where: { createdAt: { gte: since30 } },
    include: { 
      photos: { take: 1 }, 
      author: true, 
      tags: { include: { tag: true } },
      nutrition: true
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
