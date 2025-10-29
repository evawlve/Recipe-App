import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
import { convertUnit } from '@/lib/nutrition/compute';


/**
 * Get all ingredients for a recipe (both mapped and unmapped)
 * GET /api/recipes/[id]/ingredients
 */
export async function GET(
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

    const resolvedParams = await params;
    const recipeId = resolvedParams.id;
    
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

    // Get all ingredients with their current mappings
    const ingredients = await prisma.ingredient.findMany({
      where: { recipeId },
      include: {
        foodMaps: {
          include: {
            food: true
          }
        }
      }
    });

    // Transform the data to include mapping status and nutrition
    const ingredientsWithMapping = ingredients.map(ingredient => {
      // Get the best mapping (highest confidence, active)
      const bestMapping = ingredient.foodMaps
        .filter(m => m.isActive)
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
      
      // Calculate nutrition if mapped
      let nutrition = null;
      if (bestMapping?.food) {
        const grams = convertUnit(ingredient.qty, ingredient.unit, ingredient.name);
        const multiplier = grams / 100; // Convert to per-100g basis
        
        nutrition = {
          calories: Math.round(bestMapping.food.kcal100 * multiplier),
          proteinG: bestMapping.food.protein100 * multiplier,
          carbsG: bestMapping.food.carbs100 * multiplier,
          fatG: bestMapping.food.fat100 * multiplier,
          fiberG: (bestMapping.food.fiber100 || 0) * multiplier,
          sugarG: (bestMapping.food.sugar100 || 0) * multiplier,
        };
      }
      
      return {
        id: ingredient.id,
        name: ingredient.name,
        qty: ingredient.qty,
        unit: ingredient.unit,
        currentMapping: bestMapping ? {
          foodId: bestMapping.foodId,
          foodName: bestMapping.food.name,
          foodBrand: bestMapping.food.brand,
          confidence: bestMapping.confidence
        } : null,
        nutrition
      };
    });
    
    return NextResponse.json({
      success: true,
      data: ingredientsWithMapping
    });
  } catch (error) {
    console.error('Get ingredients error:', error);
    return NextResponse.json(
      { error: 'Failed to get ingredients' },
      { status: 500 }
    );
  }
}
