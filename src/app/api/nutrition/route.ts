import { NextRequest, NextResponse } from 'next/server';
import { computeRecipeNutrition, getUnmappedIngredients } from '@/lib/nutrition/compute';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Compute nutrition for a recipe
 * POST /api/nutrition
 * Body: { recipeId: string, goal?: string }
 */
export async function POST(req: NextRequest) {
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
      const totals = await computeTotals(recipeId);
      const score = scoreV1(totals, existingNutrition.goal as any);
      
      nutritionData = {
        totals,
        score,
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
