import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

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
	const { getCurrentUser } = await import("@/lib/auth");
	const { computeNutritionForRecipe } = await import("@/lib/recipes/nutrition.server");
	
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { goal = 'general' } = await req.json();
    const resolvedParams = await params;
    const recipeId = resolvedParams.id;

    // Use server lib to compute nutrition
    const result = await computeNutritionForRecipe(recipeId, goal);
    
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 500;
      return NextResponse.json({ error: result.error }, { status });
    }
    
    return NextResponse.json({
      success: true,
      data: result.nutrition
    });
  } catch (error) {
    console.error('Recipe nutrition computation error:', error);
    return NextResponse.json(
      { error: 'Failed to compute recipe nutrition' },
      { status: 500 }
    );
  }
}
