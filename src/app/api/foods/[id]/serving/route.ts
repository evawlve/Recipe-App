import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

async function findCachedServing(foodId: string, unit: string) {
  const { prisma } = await import('@/lib/db');
  const normalizedUnit = unit.toLowerCase().trim();

  if (foodId.startsWith('fdc_')) {
    const fdcId = parseInt(foodId.replace('fdc_', ''), 10);
    const servings = await prisma.fdcServingCache.findMany({
      where: { fdcId }
    });
    return servings.find(s => s.description.toLowerCase().includes(normalizedUnit)) || null;
  } else if (foodId.startsWith('off_')) {
    const servings = await prisma.openFoodFactsServingCache.findMany({
      where: { offId: foodId }
    });
    return servings.find(s => s.description.toLowerCase().includes(normalizedUnit)) || null;
  } else {
    const servings = await prisma.fatSecretServingCache.findMany({
      where: { foodId }
    });
    return servings.find(s => s.measurementDescription?.toLowerCase().includes(normalizedUnit)) || null;
  }
}

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

  // Check API Key
  const apiKey = req.headers.get('x-api-key') || req.nextUrl.searchParams.get('api_key');
  const expectedApiKey = process.env.DEV_API_KEY || 'adminAPI_dev_key_bypass';
  if (!apiKey || apiKey !== expectedApiKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const unit = searchParams.get('unit');
    const source = searchParams.get('source') || 'fatsecret';

    if (!id) {
      return NextResponse.json({ success: false, error: 'foodId is required' }, { status: 400 });
    }
    if (!unit) {
      return NextResponse.json({ success: false, error: 'unit query parameter is required' }, { status: 400 });
    }

    const { getServingType } = await import('@/lib/nlp/resolve-payload');
    const { insertAiServing } = await import('@/lib/fatsecret/ai-backfill');

    // 1. Try to find cached serving first
    let serving = await findCachedServing(id, unit);

    if (!serving) {
      // Determine gapType
      const servingType = getServingType(unit);
      const gapType = servingType === 'weight' ? 'weight' : 'volume';

      // 2. Perform AI backfill to estimate and cache the serving
      const backfillResult = await insertAiServing(id, gapType, {
        targetServingUnit: unit,
        isOnDemandBackfill: true,
      });

      if (backfillResult.success) {
        // Query again to get the newly created serving
        serving = await findCachedServing(id, unit);
      }
    }

    if (!serving) {
      return NextResponse.json({
        success: false,
        error: `Could not resolve serving for unit "${unit}"`
      }, { status: 404 });
    }

    // Map fields depending on source model
    const label = 'measurementDescription' in serving ? serving.measurementDescription : serving.description;
    const grams = 'servingWeightGrams' in serving ? serving.servingWeightGrams : serving.grams;

    return NextResponse.json({
      success: true,
      serving: {
        label: label || unit,
        grams: grams || 0,
        type: getServingType(label || unit),
        confidence: serving.confidence ?? 0.85,
        warning: serving.note ?? null
      }
    });
  } catch (error) {
    console.error('Serving resolution error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
