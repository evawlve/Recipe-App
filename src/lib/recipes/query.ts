import { prisma } from '@/lib/db';

export function parseQuery(sp: Record<string, string | undefined>) {
  const ns = (sp.ns ?? '').split(',').filter(Boolean);
  const tags = (sp.tags ?? '').split(',').filter(Boolean);
  const sort = sp.sort ?? 'new';
  const kcalMax = sp.kcalMax ? Number(sp.kcalMax) : undefined;
  const prepTime = sp.prepTime ?? undefined;
  const cursor = sp.cursor ?? undefined;
  // Support both 'q' and 'search' parameters, with 'q' taking precedence
  const search = sp.q ?? sp.search ?? undefined;
  return { ns, tags, sort, kcalMax, prepTime, cursor, search };
}

export async function getTagIdsByNsAndSlug(ns: string[], slugs: string[]) {
  if (!slugs.length) return [];
  const where: any = { slug: { in: slugs } };
  if (ns.length > 0) {
    where.namespace = { in: ns as any };
  }
  const tags = await prisma.tag.findMany({
    where,
    select: { id: true }
  });
  return tags.map(t => t.id);
}

export async function topByInteractions(lastDays = 14, take = 200) {
  const since = new Date(Date.now() - lastDays * 24 * 3600 * 1000);
  const rows = await prisma.recipeInteractionDaily.groupBy({
    by: ['recipeId'],
    where: { day: { gte: since } },
    _sum: { score: true },
    orderBy: { _sum: { score: 'desc' } },
    take,
  });
  return rows.map(r => r.recipeId);
}

export async function fetchRecipePage({ 
  tagIds, 
  kcalMax, 
  prepTime,
  sort, 
  take = 24, 
  cursor,
  search
}: {
  tagIds: string[]; 
  kcalMax?: number; 
  prepTime?: string;
  sort: string; 
  take?: number; 
  cursor?: string;
  search?: string;
}) {
  // A) Pre-filter/sort via RecipeFeatureLite or interactions
  const whereRfl: any = {};
  if (kcalMax) whereRfl.kcalPerServing = { lte: kcalMax };
  const orderByRfl =
    sort === 'proteinDensity' ? { proteinPer100kcal: 'desc' } :
    sort === 'kcalAsc'        ? { kcalPerServing: 'asc' } : undefined;

  let inIds: string[] | undefined;
  
  // Handle interactions sort
  if (sort === 'interactions') {
    const topRecipeIds = await topByInteractions(14, take * 3);
    inIds = topRecipeIds;
    
    // If no recipes have interactions, return empty results
    if (inIds.length === 0) {
      return { items: [], nextCursor: null };
    }
  } else if (orderByRfl || kcalMax) {
    const rfl = await prisma.recipeFeatureLite.findMany({
      where: whereRfl,
      ...(orderByRfl ? { orderBy: orderByRfl as any } : {}),
      take: take * 3,
      select: { recipeId: true }
    });
    inIds = rfl.map(x => x.recipeId);
    
    // If no recipes match the RecipeFeatureLite criteria, return empty results
    if (inIds.length === 0) {
      return { items: [], nextCursor: null };
    }
  }

  // B) AND tag filter on Recipe
  const andTags = tagIds.map(id => ({ tags: { some: { tagId: id }}}));
  const where: any = { AND: andTags.length ? andTags : undefined };
  if (inIds) where.id = { in: inIds };
  
  // C) Add prepTime filter
  if (prepTime) {
    where.prepTime = prepTime;
  }
  
  // D) Add search functionality
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { bodyMd: { contains: search, mode: 'insensitive' } },
      { ingredients: { some: { name: { contains: search, mode: 'insensitive' } } } }
    ];
  }

  const orderBy = !orderByRfl && sort !== 'interactions' ? { createdAt: 'desc' as const } : undefined;

  const items = await prisma.recipe.findMany({
    where,
    orderBy,
    take,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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
      photos: {
        select: {
          id: true,
          s3Key: true,
          width: true,
          height: true,
          isMainPhoto: true,
        },
        take: 1,
        orderBy: [{ isMainPhoto: 'desc' }, { id: 'asc' }]
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
          healthScore: true,
        }
      },
      _count: {
        select: { likes: true, comments: true },
      },
    }
  });
  const nextCursor = items.length === take ? items[items.length - 1].id : null;
  return { items, nextCursor };
}
