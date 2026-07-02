import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';


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

export async function POST(req: Request, { params }: any) {
  const resolvedParams = await params;
  const body = await req.json();
  const { upsertRecipeIngredients } = await import('@/lib/recipes/ingredients.server');
  const updated = await upsertRecipeIngredients(resolvedParams.id, body?.items ?? []);
  return NextResponse.json({ success: true, data: updated });
}
