import { FatSecretClient, FatSecretError, type FatSecretServing } from './client';
import { logger } from '../logger';
import { FATSECRET_ENABLED } from './config';

export type FatSecretBarcodeFood = {
  foodId: string;
  name: string;
  brandName?: string | null;
  source: 'fatsecret';
  servings: Array<{
    id?: string | null;
    description?: string | null;
    grams?: number | null;
    calories?: number | null;
    protein?: number | null;
    carbs?: number | null;
    fat?: number | null;
  }>;
};

// One client for the whole process. The OAuth token is cached PER INSTANCE, so a
// fresh client per scan paid token + find_id + food.get every time (s450a2 measured
// the token hop at about 0.1 s of a ~309 ms FatSecret leg). A 401 still forces one
// refresh inside request(). Credentials are read at construction, so a credential
// change needs a recipe-api restart (it always did).
let barcodeClient: FatSecretClient | undefined;

function getBarcodeClient(): FatSecretClient {
  if (!barcodeClient) barcodeClient = new FatSecretClient();
  return barcodeClient;
}

/** Test seam: inject a client, or pass undefined to reset the singleton. */
export function __setFatSecretBarcodeClientForTests(client: FatSecretClient | undefined): void {
  barcodeClient = client;
}

/**
 * Look up a food item by barcode using FatSecret API.
 * 
 * TODO: UI integration - Mobile scanner can call the API route /api/fatsecret/barcode?barcode=...
 * 
 * @param barcode - The barcode (GTIN/EAN/UPC) to look up
 * @param opts - Optional client instance
 * @returns Normalized food data with servings, or null if not found
 */
export async function lookupFatSecretBarcode(
  barcode: string,
  opts?: { client?: FatSecretClient }
): Promise<FatSecretBarcodeFood | null> {
  const trimmed = barcode.trim();
  if (!trimmed) return null;

  if (!FATSECRET_ENABLED) {
    logger.warn('fatsecret.barcode.lookup_failed', {
      barcode: trimmed,
      message: 'FatSecret is disabled',
    });
    return null;
  }

  const client = opts?.client ?? getBarcodeClient();

  try {
    const foodDetails = await client.getFoodByBarcode(trimmed);
    
    if (!foodDetails) {
      return null;
    }

    // Normalize servings: map FatSecret servings to simplified structure
    const servings = foodDetails.servings.map((serving: FatSecretServing) => ({
      id: serving.id ?? null,
      description: serving.description ?? null,
      grams: serving.servingWeightGrams ?? serving.metricServingAmount ?? null,
      calories: serving.calories ?? null,
      protein: serving.protein ?? null,
      carbs: serving.carbohydrate ?? null,
      fat: serving.fat ?? null,
    }));

    return {
      foodId: foodDetails.id,
      name: foodDetails.name,
      brandName: foodDetails.brandName ?? null,
      source: 'fatsecret',
      servings,
    };
  } catch (error) {
    if (error instanceof FatSecretError) {
      logger.warn('fatsecret.barcode.lookup_failed', {
        barcode: trimmed,
        message: error.message,
      });
      return null;
    }
    // Re-throw unexpected errors
    throw error;
  }
}

