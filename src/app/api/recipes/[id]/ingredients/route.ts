import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Upper bound on one POST's `items`. The write is delete-all-then-createMany, so the
 * array length is the row count one request can write.
 */
const MAX_INGREDIENT_ITEMS = 200;

/**
 * Get all ingredients for a recipe (both mapped and unmapped)
 * GET /api/recipes/[id]/ingredients
 */
export async function GET(req: Request, { params }: any) {
  const resolvedParams = await params;
  const { getRecipeIngredients } = await import('@/lib/recipes/ingredients.server');
  const data = await getRecipeIngredients(resolvedParams.id);
  if (!data) return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
  return NextResponse.json({ success: true, data });
}

/**
 * Replace a recipe's ingredients. DESTRUCTIVE (deletes every existing row first), so it
 * needs the web session of the recipe's author. It was anonymous until the 2026-09-24
 * security review: any caller could wipe any recipe's ingredients.
 */
export async function POST(req: Request, { params }: any) {
  const { getCurrentUser } = await import('@/lib/auth');
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  const resolvedParams = await params;
  const recipeId = resolvedParams?.id;
  if (typeof recipeId !== 'string' || recipeId.length === 0) {
    return NextResponse.json({ success: false, error: 'missing_id' }, { status: 400 });
  }

  const { prisma } = await import('@/lib/db');
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    select: { authorId: true },
  });
  if (!recipe) return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
  if (recipe.authorId !== user.id) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const items = body?.items ?? [];
  if (!Array.isArray(items) || items.length > MAX_INGREDIENT_ITEMS) {
    return NextResponse.json({ success: false, error: 'invalid_items' }, { status: 400 });
  }

  const { upsertRecipeIngredients } = await import('@/lib/recipes/ingredients.server');
  const updated = await upsertRecipeIngredients(recipeId, items);
  return NextResponse.json({ success: true, data: updated });
}
