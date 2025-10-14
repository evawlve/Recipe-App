import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Map an ingredient to a food
 * POST /api/foods/map
 * Body: { ingredientId: string, foodId: string, confidence?: number }
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { ingredientId, foodId, confidence = 1.0 } = await req.json();
    
    if (!ingredientId || !foodId) {
      return NextResponse.json({ error: 'Ingredient ID and Food ID are required' }, { status: 400 });
    }

    // Verify the ingredient belongs to a recipe owned by the user
    const ingredient = await prisma.ingredient.findFirst({
      where: { 
        id: ingredientId,
        recipe: { authorId: user.id }
      }
    });

    if (!ingredient) {
      return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 });
    }

    // Verify the food exists
    const food = await prisma.food.findUnique({
      where: { id: foodId }
    });

    if (!food) {
      return NextResponse.json({ error: 'Food not found' }, { status: 404 });
    }

    // Upsert the mapping
    const mapping = await prisma.ingredientFoodMap.upsert({
      where: {
        ingredientId_foodId: {
          ingredientId,
          foodId
        }
      },
      update: {
        confidence,
        createdAt: new Date()
      },
      create: {
        ingredientId,
        foodId,
        confidence
      }
    });
    
    return NextResponse.json({
      success: true,
      data: mapping
    });
  } catch (error) {
    console.error('Food mapping error:', error);
    return NextResponse.json(
      { error: 'Failed to map ingredient to food' },
      { status: 500 }
    );
  }
}
