/**
 * OpenFoodFacts API Client
 *
 * Free REST API — no API key required.
 * Rate-limit: treat as 1 req/sec sustained.
 *
 * ID convention: off_<barcode>  e.g. "off_036632022417"
 */

// ============================================================
// Types
// ============================================================

export interface OFFNutriments {
  'energy-kcal_100g'?: number;
  'proteins_100g'?: number;
  'carbohydrates_100g'?: number;
  'fat_100g'?: number;
  'fiber_100g'?: number;
  'sugars_100g'?: number;
  'sodium_100g'?: number;
}

export interface OFFProduct {
  /** Barcode — used as the unique ID (prefix with "off_" in our system) */
  code: string;
  product_name: string;
  /** Comma-separated brand list, e.g. "Dannon,Oikos" */
  brands?: string;
  /** Raw serving size string, e.g. "1 container (170g)" or "2 tbsp (30g)" */
  serving_size?: string;
  /** Serving weight in grams — most reliable when present */
  serving_quantity?: number;
  nutriments: OFFNutriments;
}

// ============================================================
// Internal fetch with retry + backoff
// ============================================================

const OFF_BASE_URL = 'https://world.openfoodfacts.org';
const OFF_USER_AGENT = 'RecipeApp/1.0 (contact@yourapp.com)';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500; // exponential: 500 → 1000 → 2000

/**
 * Fetch wrapper with exponential backoff on 429 / 503.
 * Throws on any other non-OK status (callers guard with res.ok checks).
 */
async function offFetch(url: string, attempt = 0): Promise<Response> {
    const res = await fetch(url, {
        headers: { 'User-Agent': OFF_USER_AGENT },
        signal: AbortSignal.timeout(10_000), // 10 s hard timeout
    });

    if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
        return offFetch(url, attempt + 1);
    }

    return res;
}

// ============================================================
// Public API
// ============================================================

/**
 * Search OFF products by name.
 * Returns an empty array on any network or parse error (caller is fault-tolerant).
 */
export async function searchOff(query: string, pageSize = 10): Promise<OFFProduct[]> {
    const url =
        `${OFF_BASE_URL}/cgi/search.pl` +
        `?search_terms=${encodeURIComponent(query)}` +
        `&fields=code,product_name,brands,nutriments,serving_size,serving_quantity` +
        `&json=1&page_size=${pageSize}`;

    try {
        const res = await offFetch(url);
        if (!res.ok) return [];
        const data = await res.json() as { products?: OFFProduct[] };
        return (data.products ?? []).filter(
            (p): p is OFFProduct => Boolean(p.code && p.product_name)
        );
    } catch {
        return [];
    }
}

/**
 * Look up a single OFF product by barcode.
 * Returns null if not found or on error.
 */
export async function getOffProductByBarcode(barcode: string): Promise<OFFProduct | null> {
    const url =
        `${OFF_BASE_URL}/api/v2/product/${encodeURIComponent(barcode)}.json` +
        `?fields=code,product_name,brands,nutriments,serving_size,serving_quantity`;

    try {
        const res = await offFetch(url);
        if (!res.ok) return null;
        const data = await res.json() as { status?: number; product?: OFFProduct };
        return data.status === 1 ? (data.product ?? null) : null;
    } catch {
        return null;
    }
}
