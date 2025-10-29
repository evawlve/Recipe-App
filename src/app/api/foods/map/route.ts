import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
/**
 * Map an ingredient to a food
 * POST /api/foods/map
 * Body: { ingredientId: string, foodId: string, confidence?: number, useOnce?: boolean }
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

    const { ingredientId, foodId, confidence = 0.5, useOnce = false } = await req.json();
    
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

    // Deactivate any existing mappings for this ingredient
    await prisma.ingredientFoodMap.updateMany({
      where: {
        ingredientId,
        isActive: true
      },
      data: {
        isActive: false
      }
    });

    // Create the new mapping
    const mapping = await prisma.ingredientFoodMap.create({
      data: {
        ingredientId,
        foodId,
        mappedBy: user.id,
        confidence,
        useOnce,
        isActive: true,
      }
    });

    console.log('Created mapping:', {
      ingredientId,
      foodId,
      mappedBy: user.id,
      mappingId: mapping.id
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
