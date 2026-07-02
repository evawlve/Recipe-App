import { prisma } from '@/lib/db';

export async function rollupInteractions(dateOrToday?: Date | string) {
  const start = Date.now();

  // Resolve target day window [dayStart, nextDayStart)
  let dayStart: Date;
  if (dateOrToday instanceof Date) {
    dayStart = new Date(dateOrToday);
  } else if (typeof dateOrToday === 'string') {
    dayStart = new Date(dateOrToday);
  } else {
    // default to yesterday UTC
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    d.setUTCHours(0, 0, 0, 0);
    dayStart = d;
  }
  // Normalize to UTC day start
  dayStart.setUTCHours(0, 0, 0, 0);
  const nextDayStart = new Date(dayStart);
  nextDayStart.setUTCDate(nextDayStart.getUTCDate() + 1);

  // Find all recipes with any activity in the window
  const recipesWithViews = await prisma.recipeView.groupBy({
    by: ['recipeId'],
    where: { createdAt: { gte: dayStart, lt: nextDayStart } },
  });

  for (const { recipeId } of recipesWithViews) {
    const [viewCount, likeCount, commentCount, saveCount] = await Promise.all([
      prisma.recipeView.count({ where: { recipeId, createdAt: { gte: dayStart, lt: nextDayStart } } }),
      prisma.like.count({ where: { recipeId, createdAt: { gte: dayStart, lt: nextDayStart } } }),
      prisma.comment.count({ where: { recipeId, createdAt: { gte: dayStart, lt: nextDayStart } } }),
      prisma.collectionRecipe.count({ where: { recipeId, addedAt: { gte: dayStart, lt: nextDayStart } } }),
    ]);

    const score = (0.2 * viewCount) + (1.0 * likeCount) + (2.0 * commentCount) + (0.6 * saveCount);

    await prisma.recipeInteractionDaily.upsert({
      where: { recipeId_day: { recipeId, day: dayStart } },
      update: { views: viewCount, likes: likeCount, comments: commentCount, saves: saveCount, score },
      create: { recipeId, day: dayStart, views: viewCount, likes: likeCount, comments: commentCount, saves: saveCount, score },
    });
  }

  return { processedRecipes: recipesWithViews.length, ms: Date.now() - start, day: dayStart.toISOString().slice(0, 10) };
}


