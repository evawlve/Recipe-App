/**
 * off-parse.ts — shared Open Food Facts product filtering/parsing logic.
 *
 * Used by both the full-dump streaming ingest (ingest-off.ts) and the
 * incremental delta ingest (ingest-off-delta.ts) so the two paths can't
 * silently drift apart on what counts as a "qualifying" product.
 */

// Categories to skip — these aren't useful recipe ingredients
export const SKIP_CATEGORY_PATTERNS = [
  /beauty|cosmetic|pet food|dog food|cat food|baby formula|infant formula/i,
  /supplement|vitamins|dietary supplement/i,
];

// Name-based non-food/supplement skip. OFF's `categories` field is empty for a
// huge share of rows, so category patterns alone let supplements through. These
// match the product name as a backstop. Kept conservative to avoid dropping real
// foods (e.g. "calcium-fortified milk" won't match a bare "Calcium" pattern).
export const SKIP_NAME_PATTERNS = [
  /\b(dietary\s+)?supplement\b/i,
  /\b(multi)?vitamins?\b/i,
  /\bprebiotic\b/i,
  /\bcollagen\s+peptides?\b/i,
  /\bprotein\s+powder\b/i,
];

// Geographic filter: keep only products sold in these OFF country slugs.
// Set OFF_COUNTRIES="" to disable and ingest every country.
export const KEEP_COUNTRIES = (process.env.OFF_COUNTRIES ?? 'united-states')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

// Require core macros (kcal + protein + carbs + fat) present, else skip the row.
// Set OFF_REQUIRE_MACROS=false to keep the old permissive behavior (insert rows
// with null macros).
export const REQUIRE_MACROS = process.env.OFF_REQUIRE_MACROS !== 'false';

// Helper to parse float or default to -1
export function parseFloat0(v: any): number {
  if (typeof v === 'number') return v;
  const parsed = parseFloat(String(v));
  return isNaN(parsed) ? -1 : parsed;
}

// Parse a macro value, distinguishing a genuine 0 from a missing field.
// Returns -1 ONLY when the field is truly absent (undefined/null/'' /NaN).
// A present value of 0 (e.g. 0g fat in cola, 0g carbs in meat) returns 0.
export function parseMacro(v: any): number {
  if (v === undefined || v === null || v === '') return -1;
  if (typeof v === 'number') return isNaN(v) ? -1 : v;
  const parsed = parseFloat(String(v));
  return isNaN(parsed) ? -1 : parsed;
}

// Helper to parse default serving weight in grams
export function parseServingGrams(servingQuantity: any, servingSize: string): number | null {
  if (typeof servingQuantity === 'number' && servingQuantity > 0) return servingQuantity;
  const q = parseFloat(servingQuantity);
  if (!isNaN(q) && q > 0) return q;
  if (!servingSize) return null;
  const gMatch = servingSize.match(/(\d+(?:\.\d+)?)\s*g\b/i);
  if (gMatch) return parseFloat(gMatch[1]);
  const ozMatch = servingSize.match(/(\d+(?:\.\d+)?)\s*oz\b/i);
  if (ozMatch) return parseFloat(ozMatch[1]) * 28.3495;
  const mlMatch = servingSize.match(/(\d+(?:\.\d+)?)\s*ml\b/i);
  if (mlMatch) return parseFloat(mlMatch[1]);
  return null;
}

/** Atwater check: estimated kcal from macros should be within 30% of labeled kcal.
 *
 * Fiber's caloric density varies by type: fermentable fiber contributes ~2 kcal/g,
 * but the resistant/modified-starch fiber used in keto products (Mission Carb
 * Balance, Atkins bars, keto bread mixes) is labeled at ~0 kcal/g. A single
 * fiber factor rejects one class or the other, so accept the label if it's
 * consistent with EITHER factor. The fiber@0 leg only applies when the fiber
 * value is plausible (fiber <= carbs) so junk rows with impossible fiber
 * (e.g. 1200g/100g) can't sneak in through the more permissive formula.
 */
export function atwaterValid(kcal: number, protein: number, carbs: number, fat: number, fiber: number): boolean {
  if (kcal <= 0) return false;
  const netCarbs = Math.max(0, carbs - fiber);
  const base = protein * 4 + netCarbs * 4 + fat * 9;
  const estFiber2 = base + fiber * 2;
  if (estFiber2 > 0 && kcal >= estFiber2 * 0.7 && kcal <= estFiber2 * 1.3) return true;
  if (fiber > 0 && fiber <= carbs && base > 0 && kcal >= base * 0.7 && kcal <= base * 1.3) return true;
  return false;
}

// Back-calculate a per-100g value from a per-serving value + the serving's
// gram weight. Needed for products with count/volume-based servings (e.g.
// "13 tortilla chips (28g)") where OFF only ever has `_serving` nutrients
// entered and no `_100g` figure at all.
function backCalcPer100g(perServing: number, servingGrams: number | null): number {
  if (perServing < 0 || !servingGrams || servingGrams <= 0) return -1;
  return (perServing / servingGrams) * 100;
}

export type SkipReason = 'no_name' | 'not_us_or_en' | 'category' | 'no_macros' | 'atwater';

export interface ParsedOffProduct {
  barcode: string;
  name: string;
  brandName: string | null;
  servingSize: string | null;
  servingGrams: number | null;
  kcal: number;
  fat: number;
  carbs: number;
  protein: number;
  fiber: number;
  sugar: number;
  sodium: number;
  /** true if per-100g macros were back-calculated from `_serving` fields */
  derivedFromServing: boolean;
}

export type ParseResult =
  | { skip: true; reason: SkipReason }
  | { skip: false; data: ParsedOffProduct };

/**
 * Extract + filter a single raw OFF product JSON object (one line of the
 * JSONL dump or a delta file — same schema either way).
 */
export function parseOffProduct(product: any): ParseResult {
  const barcode = product.code || product._id || '';
  const rawName = product.product_name || product.product_name_en || '';
  const brand = product.brands ? String(product.brands).split(',')[0].trim() : '';
  const categories = product.categories || product.categories_en || '';
  const servingSize = product.serving_size || '';
  const servingQuantity = product.serving_quantity || '';
  const countriesTags: string[] = Array.isArray(product.countries_tags) ? product.countries_tags : [];

  if (!barcode || !rawName || rawName.length < 2) {
    return { skip: true, reason: 'no_name' };
  }

  // Geographic filter. When OFF has no country data for the row, fall back to
  // the US/CA UPC range (barcodes starting 0) so we don't drop US products
  // that simply lack the tag.
  if (KEEP_COUNTRIES.length > 0) {
    const inCountry = countriesTags.some(t =>
      KEEP_COUNTRIES.some(c => t === `en:${c}` || t.endsWith(`:${c}`)));
    const usBarcodeFallback = countriesTags.length === 0 && /^0/.test(String(barcode));
    if (!inCountry && !usBarcodeFallback) {
      return { skip: true, reason: 'not_us_or_en' };
    }
  }

  const skipCat = SKIP_CATEGORY_PATTERNS.some(p => p.test(categories))
    || SKIP_NAME_PATTERNS.some(p => p.test(rawName));
  if (skipCat) {
    return { skip: true, reason: 'category' };
  }

  const servingGrams = parseServingGrams(servingQuantity, servingSize);
  const nutriments = product.nutriments || {};

  let kcal = parseMacro(nutriments['energy-kcal_100g'] ?? nutriments['energy_100g']);
  let fat = parseMacro(nutriments['fat_100g']);
  let carbs = parseMacro(nutriments['carbohydrates_100g']);
  let protein = parseMacro(nutriments['proteins_100g']);
  let fiber = parseFloat0(nutriments['fiber_100g'] === undefined ? 0 : nutriments['fiber_100g']);
  let sugar = parseFloat0(nutriments['sugars_100g'] === undefined ? 0 : nutriments['sugars_100g']);
  let sodium = parseFloat0(nutriments['sodium_100g'] === undefined ? 0 : nutriments['sodium_100g']);

  let derivedFromServing = false;
  if (kcal < 0 && fat < 0 && carbs < 0 && protein < 0 && servingGrams) {
    const kcalServing = parseMacro(nutriments['energy-kcal_serving'] ?? nutriments['energy_serving']);
    const fatServing = parseMacro(nutriments['fat_serving']);
    const carbsServing = parseMacro(nutriments['carbohydrates_serving']);
    const proteinServing = parseMacro(nutriments['proteins_serving']);
    if (kcalServing >= 0 && fatServing >= 0 && carbsServing >= 0 && proteinServing >= 0) {
      kcal = backCalcPer100g(kcalServing, servingGrams);
      fat = backCalcPer100g(fatServing, servingGrams);
      carbs = backCalcPer100g(carbsServing, servingGrams);
      protein = backCalcPer100g(proteinServing, servingGrams);
      const fiberServing = parseFloat0(nutriments['fiber_serving'] === undefined ? 0 : nutriments['fiber_serving']);
      const sugarServing = parseFloat0(nutriments['sugars_serving'] === undefined ? 0 : nutriments['sugars_serving']);
      const sodiumServing = parseFloat0(nutriments['sodium_serving'] === undefined ? 0 : nutriments['sodium_serving']);
      fiber = fiberServing >= 0 ? backCalcPer100g(fiberServing, servingGrams) : fiber;
      sugar = sugarServing >= 0 ? backCalcPer100g(sugarServing, servingGrams) : sugar;
      sodium = sodiumServing >= 0 ? backCalcPer100g(sodiumServing, servingGrams) : sodium;
      derivedFromServing = true;
    }
  }

  if (REQUIRE_MACROS && !(kcal >= 0 && protein >= 0 && carbs >= 0 && fat >= 0)) {
    return { skip: true, reason: 'no_macros' };
  }

  if (kcal >= 0 && fat >= 0 && carbs >= 0 && protein >= 0) {
    if (!atwaterValid(kcal, protein, carbs, fat, fiber >= 0 ? fiber : 0)) {
      return { skip: true, reason: 'atwater' };
    }
  }

  return {
    skip: false,
    data: {
      barcode: String(barcode),
      name: rawName,
      brandName: brand || null,
      servingSize: servingSize || null,
      servingGrams,
      kcal, fat, carbs, protein, fiber, sugar, sodium,
      derivedFromServing,
    },
  };
}
