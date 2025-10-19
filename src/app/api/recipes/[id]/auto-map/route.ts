import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { autoMapIngredients } from '@/lib/nutrition/auto-map';
import { computeRecipeNutrition } from '@/lib/nutrition/compute';

/**
 * Manually trigger auto-mapping for a recipe
 * POST /api/recipes/[id]/auto-map
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Get the authenticated user
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user owns the recipe
    const recipe = await prisma.recipe.findFirst({
      where: { id, authorId: user.id }
    });

    if (!recipe) {
      return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
    }

    // Run auto-mapping
    const mappedCount = await autoMapIngredients(id);
    
    // Compute nutrition after mapping
    await computeRecipeNutrition(id, 'general');

    return NextResponse.json({
      success: true,
      mappedCount,
      message: `Auto-mapped ${mappedCount} ingredients`
    });
  } catch (error) {
    console.error('Auto-mapping error:', error);
    return NextResponse.json(
      { error: 'Failed to auto-map ingredients' },
      { status: 500 }
    );
  }
}
