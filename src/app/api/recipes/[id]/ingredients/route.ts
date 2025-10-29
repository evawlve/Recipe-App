import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';


/**
 * Get all ingredients for a recipe (both mapped and unmapped)
 * GET /api/recipes/[id]/ingredients
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { getRecipeIngredients } = await import('@/lib/recipes/ingredients.server');
  const data = await getRecipeIngredients(params.id);
  if (!data) return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
  return Response.json({ ok: true, ingredients: data });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const { upsertRecipeIngredients } = await import('@/lib/recipes/ingredients.server');
  const updated = await upsertRecipeIngredients(params.id, body?.items ?? []);
  return Response.json({ ok: true, ingredients: updated });
}
