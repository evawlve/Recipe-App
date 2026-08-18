/**
 * OpenFoodFacts Serving Size Parser
 *
 * Converts the raw `serving_size` / `serving_quantity` fields from the OFF
 * API into a canonical (grams, description) pair used by hydration and
 * the serving cache.
 *
 * Priority order (from handoff §5):
 *   1. serving_quantity  — numeric field already in grams, most reliable
 *   2. Regex gram extract from serving_size string  — e.g. "1 container (170g)"
 *   3. null              — no gram anchor found, triggers AI backfill
 */

import { labelLeadingQuantity } from '../mapping/count-label';

// ============================================================
// Public API
// ============================================================

export interface OffServingResult {
    /** Gram weight of this serving, or null if it cannot be determined */
    grams: number | null;
    /** Human-readable serving description, e.g. "1 container" or "2 tbsp" */
    description: string;
    /**
     * Number of units the `grams`/`description` cover — e.g. "2 scoops (46g)"
     * yields unitCount=2 (so per-scoop = 23g). Defaults to 1. Consumers that
     * resolve a requested unit to grams MUST divide by this before multiplying
     * by the requested quantity, or multi-unit label servings double-count.
     */
    unitCount: number;
}

/**
 * Extract the leading quantity from a serving description ("2 scoops" → 2,
 * "1/2 cup (110 g)" → 0.5, "1 1/4 cup (40 g)" → 1.25); 1 when the label does
 * not lead with a number.
 *
 * THE FRACTION IS THE POINT. This was `^\s*(\d+(?:\.\d+)?)` — it read the
 * NUMERATOR of a fraction and stopped, so "1/2 cup (110 g)" reported one unit
 * and the consumer's `servingGrams / unitCount` called 110 g a whole cup.
 * 15,317 OffFood rows lead with a fraction and 1,196 with a mixed number
 * (measured on the box 2026-08-18); `off_0081312620001` "Cottage cheese" is
 * the worked case — 110 g per HALF cup, i.e. 220 g/cup against USDA's 226.
 *
 * The shape gate and the fraction arithmetic are `labelLeadingQuantity()`'s in
 * `mapping/count-label.ts`, which owns the other half of the same read
 * (`extractLabelServingUnit`) — the unit and the count must agree about where
 * the quantity ends or one of them is describing a different string.
 */
function leadingCount(description: string): number {
    return labelLeadingQuantity(description) ?? 1;
}

/**
 * Parse an OFF product's serving data into a gram weight.
 *
 * @param servingSize     - Raw string from the OFF label, e.g. "1 container (170g)"
 * @param servingQuantity - Numeric value from the OFF API (grams), e.g. 170
 */
export function parseOffServingSize(
    servingSize: string | undefined | null,
    servingQuantity: number | undefined | null,
): OffServingResult {
    // ── Priority 1: serving_quantity numeric field ──────────────────────────
    // Most reliable — already in grams, no parsing needed.
    if (servingQuantity && servingQuantity > 0) {
        const description = servingSize
            ? normalizeServingDescription(servingSize)
            : '1 serving';
        return { grams: servingQuantity, description, unitCount: leadingCount(description) };
    }

    // ── Priority 2: regex extract grams from serving_size string ───────────
    // Handles: "170g", "1 container (170g)", "2 tbsp (30g)"
    if (servingSize) {
        const gramMatch = servingSize.match(/(\d+(?:\.\d+)?)\s*g\b/i);
        if (gramMatch) {
            const grams = parseFloat(gramMatch[1]);
            const description = normalizeServingDescription(servingSize);
            return { grams, description, unitCount: leadingCount(description) };
        }
    }

    // ── Priority 3: no gram anchor found ───────────────────────────────────
    // Caller should trigger AI serving backfill.
    const description = servingSize ?? '1 serving';
    return { grams: null, description, unitCount: leadingCount(description) };
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Strip trailing gram annotations and reduce bare gram strings to "1 serving".
 *
 * Examples:
 *   "1 container (170g)"  → "1 container"
 *   "2 tbsp (30g)"        → "2 tbsp"
 *   "170g"                → "1 serving"
 *   "1 cup"               → "1 cup"
 */
function normalizeServingDescription(servingSize: string): string {
    // Strip trailing " (170g)" style annotation
    const withoutGrams = servingSize.replace(/\s*\(\d+(?:\.\d+)?g\)/gi, '').trim();

    // If what remains is just a gram measurement (e.g. "170g"), use generic label
    if (/^\d+(?:\.\d+)?g$/i.test(withoutGrams)) {
        return '1 serving';
    }

    return withoutGrams || '1 serving';
}
