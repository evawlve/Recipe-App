import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Get all ingredients for a recipe (both mapped and unmapped)
 * GET /api/recipes/[id]/ingredients
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    // Transform the data to include mapping status
    const ingredientsWithMapping = ingredients.map(ingredient => ({
      id: ingredient.id,
      name: ingredient.name,
      qty: ingredient.qty,
      unit: ingredient.unit,
      currentMapping: ingredient.foodMaps.length > 0 ? {
        foodId: ingredient.foodMaps[0].foodId,
        foodName: ingredient.foodMaps[0].food.name,
        foodBrand: ingredient.foodMaps[0].food.brand,
        confidence: ingredient.foodMaps[0].confidence
      } : null
    }));
    
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
