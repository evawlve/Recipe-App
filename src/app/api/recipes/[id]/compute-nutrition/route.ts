import { NextRequest, NextResponse } from 'next/server';
import { computeRecipeNutrition } from '@/lib/nutrition/compute';
/**
 * Compute nutrition for a specific recipe
 * POST /api/recipes/[id]/compute-nutrition
 * Body: { goal?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
	// Skip execution during build time
	if (process.env.NEXT_PHASE === 'phase-production-build' || 
	    process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
	    process.env.BUILD_TIME === 'true') {
		return NextResponse.json({ error: "Not available during build" }, { status: 503 });
	}

	// Import only when not in build mode
	const { prisma } = await import("@/lib/db");
	const { getCurrentUser } = await import("@/lib/auth");
	
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
