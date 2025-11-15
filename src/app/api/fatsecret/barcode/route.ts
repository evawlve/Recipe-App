import { NextRequest, NextResponse } from 'next/server';
import { lookupFatSecretBarcode } from '@/lib/fatsecret/barcode';
import { FATSECRET_ENABLED } from '@/lib/fatsecret/config';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Look up a food item by barcode using FatSecret API
 * GET /api/fatsecret/barcode?barcode=...
 * 
 * Returns food data with servings and macros, or 404 if not found.
 * Returns 503 if FatSecret is disabled.
 */
export async function GET(req: NextRequest) {
  if (!FATSECRET_ENABLED) {
    return NextResponse.json(
      { error: 'FatSecret barcode lookup is disabled' },
      { status: 503 }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const barcode = searchParams.get('barcode');

    if (!barcode || !barcode.trim()) {
      return NextResponse.json(
        { error: 'barcode query parameter is required' },
        { status: 400 }
      );
    }

    const result = await lookupFatSecretBarcode(barcode.trim());

    if (!result) {
      return NextResponse.json(
        { error: 'Food not found for barcode' },
        { status: 404 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    logger.error('fatsecret.barcode.api_error', {
      message: (error as Error).message,
      stack: (error as Error).stack,
    });

    return NextResponse.json(
      { error: 'Internal server error', message: (error as Error).message },
      { status: 500 }
    );
  }
}

