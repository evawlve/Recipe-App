import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Debug route for food normalization (development only)
 * GET /api/debug/foods?q=olive%20oil
 */
export async function GET(req: NextRequest) {
  // Skip execution during build time
  if (process.env.NEXT_PHASE === 'phase-production-build' || 
      process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
      process.env.BUILD_TIME === 'true') {
    return NextResponse.json({ error: "Not available during build" }, { status: 503 });
  }

  // Only allow in development
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Debug route not available in production' }, { status: 404 });
  }

  // Import only when not in build mode
  const { searchFoods } = await import('@/lib/usda');

  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q');
    
    if (!query) {
      return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
    }

    console.log(`🔍 [DEBUG] Searching for: "${query}"`);
    
    // Search foods with debug logging enabled
    const foods = await searchFoods(query);
    
    return NextResponse.json({
      success: true,
      query,
      count: foods.length,
      foods: foods.map(food => ({
        name: food.name,
        brand: food.brand,
        source: food.source,
        fdcId: food.fdcId,
        per100g: food.per100g
      }))
    });
  } catch (error) {
    console.error('Debug search error:', error);
    return NextResponse.json(
      { error: 'Debug search failed' },
      { status: 500 }
    );
  }
}
