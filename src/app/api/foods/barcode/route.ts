import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
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
    const { lookupFatSecretBarcode } = await import('@/lib/fatsecret/barcode');
    const { ensureFoodCached } = await import('@/lib/fatsecret/cache');
    const { getOffProductByBarcode } = await import('@/lib/openfoodfacts/client');
    const { hydrateOffCandidate } = await import('@/lib/openfoodfacts/hydrate');
    const { resolveFoodDetails } = await import('@/lib/nlp/resolve-payload');

    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');

    if (!code || !code.trim()) {
      return NextResponse.json({ error: 'code query parameter is required' }, { status: 400 });
    }

    const trimmedCode = code.trim();
    let foodId: string | null = null;

    // 1. Try FatSecret first
    const fsResult = await lookupFatSecretBarcode(trimmedCode);
    if (fsResult && fsResult.foodId) {
      foodId = fsResult.foodId;
      await ensureFoodCached(foodId);
    } else {
      // 2. Try OpenFoodFacts
      const offProduct = await getOffProductByBarcode(trimmedCode);
      if (offProduct) {
        const offId = `off_${offProduct.code}`;
        await hydrateOffCandidate({
          id: offId,
          name: offProduct.product_name || 'OpenFoodFacts Product',
          rawData: offProduct,
        });
        foodId = offId;
      }
    }

    if (!foodId) {
      return NextResponse.json({ error: 'Food not found for barcode' }, { status: 404 });
    }

    const details = await resolveFoodDetails(foodId);
    
    const responsePayload = {
      id: foodId,
      name: details.name,
      brand: details.brandName,
      source: details.source,
      nutritionPer100g: details.nutritionPer100g,
      servingOptions: details.servingOptions,
    };

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('Barcode lookup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
