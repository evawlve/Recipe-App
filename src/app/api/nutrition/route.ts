import { NextRequest, NextResponse } from 'next/server';
import { computeRecipeNutrition, getUnmappedIngredients } from '@/lib/nutrition/compute';
/**
 * Compute nutrition for a recipe
 * POST /api/nutrition
 * Body: { recipeId: string, goal?: string }
 */
export async function POST(req: NextRequest) {
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

    const { recipeId, goal = 'general' } = await req.json();
    
    if (!recipeId) {
      return NextResponse.json({ error: 'Recipe ID is required' }, { status: 400 });
    }

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
    console.error('Nutrition computation error:', error);
    return NextResponse.json(
      { error: 'Failed to compute nutrition' },
      { status: 500 }
    );
  }
}

/**
 * Get unmapped ingredients for a recipe
 * GET /api/nutrition?recipeId=...
 */
export async function GET(req: NextRequest) {
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

    const { searchParams } = new URL(req.url);
    const recipeId = searchParams.get('recipeId');
    
    if (!recipeId) {
      return NextResponse.json({ error: 'Recipe ID is required' }, { status: 400 });
    }

    // Verify user owns the recipe
    const recipe = await prisma.recipe.findFirst({
      where: { id: recipeId, authorId: user.id }
    });

    if (!recipe) {
      return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
    }

    const unmappedIngredients = await getUnmappedIngredients(recipeId);
    
    // Also get existing nutrition data if it exists
    const existingNutrition = await prisma.nutrition.findUnique({
      where: { recipeId }
    });
    
    let nutritionData = null;
    if (existingNutrition) {
      // If nutrition exists, compute the current totals and score
      const { computeTotals, scoreV1 } = await import('@/lib/nutrition/compute');
      const { HEALTH_SCORE_V2 } = await import('@/lib/flags');
      const { scoreV2 } = await import('@/lib/nutrition/score-v2');
      
      const result = await computeTotals(recipeId);
      const { provisional, ...totals } = result;
      
      let score;
      if (HEALTH_SCORE_V2) {
        const scoreV2Result = scoreV2({
          calories: totals.calories,
          protein: totals.proteinG,
          carbs: totals.carbsG,
          fat: totals.fatG,
          fiber: totals.fiberG,
          sugar: totals.sugarG
        }, existingNutrition.goal as any);
        score = scoreV2Result;
      } else {
        score = scoreV1(totals, existingNutrition.goal as any);
        // Add label for v1 compatibility
        score.label = score.value >= 80 ? 'great' : score.value >= 60 ? 'good' : score.value >= 40 ? 'ok' : 'poor';
      }
      
      nutritionData = {
        totals,
        score,
        provisional,
        unmappedIngredients
      };
    } else {
      nutritionData = {
        totals: null,
        score: null,
        unmappedIngredients
      };
    }
    
    return NextResponse.json({
      success: true,
      data: nutritionData
    });
  } catch (error) {
    console.error('Get unmapped ingredients error:', error);
    return NextResponse.json(
      { error: 'Failed to get unmapped ingredients' },
      { status: 500 }
    );
  }
}
