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

    const { ingredientId, foodId, servingGrams, confidence = 0.5, useOnce = false } = await req.json();

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

    // NUTRITION FIX: Check both FatSecret cache AND legacy Food table
    const { FATSECRET_CACHE_MODE } = await import('@/lib/fatsecret/config');
    const { getCachedFoodWithRelations } = await import('@/lib/fatsecret/cache-search');

    let foodExists = false;

    // Check FatSecret cache first
    if (FATSECRET_CACHE_MODE !== 'legacy') {
      const cachedFood = await getCachedFoodWithRelations(foodId);
      if (cachedFood) {
        foodExists = true;
      }
    }

    // Fallback to legacy Food table
    if (!foodExists) {
      const food = await prisma.food.findUnique({
        where: { id: foodId }
      });
      if (food) {
        foodExists = true;
      }
    }

    if (!foodExists) {
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

    // NUTRITION FIX: Determine if FatSecret or legacy Food
    const isFatsecretId = /^\d+$/.test(foodId);

    let mappingData: any = {
      ingredientId,
      mappedBy: user.id,
      confidence,
      useOnce,
      isActive: true,
    };

    if (isFatsecretId) {
      // FatSecret cache food - store grams for nutrition calculation
      mappingData.fatsecretFoodId = foodId;
      mappingData.fatsecretGrams = servingGrams || null;
    } else {
      // Legacy Food table
      mappingData.foodId = foodId;
    }

    // Create the new mapping
    const mapping = await prisma.ingredientFoodMap.create({
      data: mappingData
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
