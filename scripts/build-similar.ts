import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type View = { recipeId: string; sessionId: string; createdAt: Date };

function decay(d: Date) {
  const hours = (Date.now() - d.getTime()) / 36e5;
  return Math.exp(-hours / 96);
}

async function main() {
  console.log('Starting similarity build...');
  
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  console.log(`Processing views since: ${since.toISOString()}`);

  // Pull views (batch if needed)
  const views: View[] = await prisma.recipeView.findMany({
    where: { createdAt: { gte: since } },
    select: { recipeId: true, sessionId: true, createdAt: true },
    orderBy: [{ sessionId: 'asc' }, { createdAt: 'asc' }],
  });

  console.log(`Found ${views.length} views to process`);

  if (views.length === 0) {
    console.log('No views found, skipping similarity build');
    return;
  }

  // Counts
  const V = new Map<string, number>();              // views per recipe
  const C = new Map<string, number>();              // pair counts (unordered key "a|b")
  const S = new Map<string, number>();              // sum of decayed contributions per pair

  for (const v of views) V.set(v.recipeId, (V.get(v.recipeId) ?? 0) + 1);

  console.log(`Found ${V.size} unique recipes with views`);

  // Group by session and window to 60m
  let i = 0;
  let sessionCount = 0;
  let pairCount = 0;
  
  while (i < views.length) {
    const sid = views[i].sessionId;
    const start = i;
    while (i < views.length && views[i].sessionId === sid) i++;
    const session = views.slice(start, i);
    sessionCount++;
    
    // sliding window within 60m
    let l = 0;
    for (let r = 0; r < session.length; r++) {
      while (
        l < r &&
        session[r].createdAt.getTime() - session[l].createdAt.getTime() > 60 * 60 * 1000
      ) l++;
      for (let k = l; k < r; k++) {
        const a = session[k].recipeId;
        const b = session[r].recipeId;
        if (a === b) continue;
        const [x, y] = a < b ? [a, b] : [b, a];
        const key = `${x}|${y}`;
        C.set(key, (C.get(key) ?? 0) + 1);
        S.set(key, (S.get(key) ?? 0) + decay(session[r].createdAt));
        pairCount++;
      }
    }
  }

  console.log(`Processed ${sessionCount} sessions, found ${pairCount} co-view pairs`);

  // Compute lift-like score, keep per-recipe topK
  const byRecipe = new Map<string, Array<{ id: string; score: number; c: number }>>();
  let validPairs = 0;
  
  for (const [key, c] of C) {
    if (c < 3) continue; // noise filter
    validPairs++;
    
    const [a, b] = key.split('|');
    const va = V.get(a) ?? 1, vb = V.get(b) ?? 1;
    const lift = (S.get(key)! / Math.sqrt(va * vb)); // decayed co-views
    (byRecipe.get(a) ?? byRecipe.set(a, []).get(a)!).push({ id: b, score: lift, c });
    (byRecipe.get(b) ?? byRecipe.set(b, []).get(b)!).push({ id: a, score: lift, c });
  }

  console.log(`Found ${validPairs} valid pairs (co-occurrence >= 3)`);
  console.log(`Building similarities for ${byRecipe.size} recipes`);

  // Normalize and persist topK
  const K = 20;
  let processedRecipes = 0;
  
  for (const [rid, arr] of byRecipe) {
    if (!arr || arr.length === 0) continue;
    processedRecipes++;
    
    const max = Math.max(...arr.map(x => x.score));
    const top = arr
      .map(x => ({ ...x, score: x.score / (max || 1) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, K);

    // Upsert batch
    for (const s of top) {
      await prisma.recipeSimilar.upsert({
        where: { recipeId_similarId: { recipeId: rid, similarId: s.id } },
        update: { score: s.score },
        create: { recipeId: rid, similarId: s.id, score: s.score },
      });
    }

    // Cleanup: delete rows not in current top
    const keepIds = top.map(x => x.id);
    await prisma.recipeSimilar.deleteMany({
      where: { recipeId: rid, similarId: { notIn: keepIds } },
    });

    if (processedRecipes % 100 === 0) {
      console.log(`Processed ${processedRecipes}/${byRecipe.size} recipes`);
    }
  }

  console.log(`Similarities built for ${processedRecipes} recipes`);
  console.log('Build completed successfully');
}

main()
  .catch(e => { 
    console.error('Error building similarities:', e); 
    process.exit(1); 
  })
  .finally(() => prisma.$disconnect());
