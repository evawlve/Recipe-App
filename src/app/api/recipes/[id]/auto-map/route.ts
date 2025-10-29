import { NextRequest, NextResponse } from 'next/server';
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
