import { prisma } from '@/lib/db';

type BuildSimilarOptions = { lookbackDays: number; topK: number };

export async function buildSimilarities({ lookbackDays, topK }: BuildSimilarOptions) {
  const start = Date.now();
  const since = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);

  const views = await prisma.recipeView.findMany({
    where: { createdAt: { gte: since } },
    select: { recipeId: true, sessionId: true, createdAt: true },
    orderBy: [{ sessionId: 'asc' }, { createdAt: 'asc' }],
  });

  if (views.length === 0) {
    return { views: 0, sessions: 0, pairs: 0, updated: 0, ms: Date.now() - start };
  }

  const decay = (d: Date) => {
    const hours = (Date.now() - d.getTime()) / 36e5;
    return Math.exp(-hours / 96);
  };

  const viewsPerRecipe = new Map<string, number>();
  const pairCounts = new Map<string, number>();
  const pairScores = new Map<string, number>();

  for (const v of views) viewsPerRecipe.set(v.recipeId, (viewsPerRecipe.get(v.recipeId) ?? 0) + 1);

  let i = 0;
  let sessions = 0;
  let pairs = 0;
  while (i < views.length) {
    const sid = views[i].sessionId;
    const startIdx = i;
    while (i < views.length && views[i].sessionId === sid) i++;
    const session = views.slice(startIdx, i);
    sessions++;

    let l = 0;
    for (let r = 0; r < session.length; r++) {
      while (l < r && session[r].createdAt.getTime() - session[l].createdAt.getTime() > 60 * 60 * 1000) l++;
      for (let k = l; k < r; k++) {
        const a = session[k].recipeId;
        const b = session[r].recipeId;
        if (a === b) continue;
        const [x, y] = a < b ? [a, b] : [b, a];
        const key = `${x}|${y}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        pairScores.set(key, (pairScores.get(key) ?? 0) + decay(session[r].createdAt));
        pairs++;
      }
    }
  }

  const byRecipe = new Map<string, Array<{ id: string; score: number; c: number }>>();
  let validPairs = 0;
  for (const [key, c] of pairCounts) {
    if (c < 3) continue;
    validPairs++;
    const [a, b] = key.split('|');
    const va = viewsPerRecipe.get(a) ?? 1, vb = viewsPerRecipe.get(b) ?? 1;
    const lift = (pairScores.get(key)! / Math.sqrt(va * vb));
    (byRecipe.get(a) ?? byRecipe.set(a, []).get(a)!).push({ id: b, score: lift, c });
    (byRecipe.get(b) ?? byRecipe.set(b, []).get(b)!).push({ id: a, score: lift, c });
  }

  let updated = 0;
  for (const [rid, arr] of byRecipe) {
    if (!arr || arr.length === 0) continue;
    const max = Math.max(...arr.map(x => x.score));
    const top = arr
      .map(x => ({ ...x, score: x.score / (max || 1) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    for (const s of top) {
      await prisma.recipeSimilar.upsert({
        where: { recipeId_similarId: { recipeId: rid, similarId: s.id } },
        update: { score: s.score },
        create: { recipeId: rid, similarId: s.id, score: s.score },
      });
      updated++;
    }

    const keepIds = top.map(x => x.id);
    await prisma.recipeSimilar.deleteMany({ where: { recipeId: rid, similarId: { notIn: keepIds } } });
  }

  return { views: views.length, sessions, pairs, validPairs, updated, ms: Date.now() - start };
}


