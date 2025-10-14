import { NextRequest, NextResponse } from 'next/server';
import { computeRecipeNutrition } from '@/lib/nutrition/compute';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Compute nutrition for a specific recipe
 * POST /api/recipes/[id]/compute-nutrition
 * Body: { goal?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { goal = 'general' } = await req.json();
    const resolvedParams = await params;
    const recipeId = resolvedParams.id;

    // Verify user owns the recipe
    const recipe = await prisma.recipe.findFirst({
      where: { id: recipeId, authorId: user.id }
    });

    if (!recipe) {
      return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
    }

    const result = await computeRecipeNutrition(recipeId, goal as any);
    
    return NextResponse.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Recipe nutrition computation error:', error);
    return NextResponse.json(
      { error: 'Failed to compute recipe nutrition' },
      { status: 500 }
    );
  }
}
