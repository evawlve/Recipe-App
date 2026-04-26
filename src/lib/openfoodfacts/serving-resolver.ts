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

// ============================================================
// Public API
// ============================================================

export interface OffServingResult {
    /** Gram weight of this serving, or null if it cannot be determined */
    grams: number | null;
    /** Human-readable serving description, e.g. "1 container" or "2 tbsp" */
    description: string;
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
        return { grams: servingQuantity, description };
    }

    // ── Priority 2: regex extract grams from serving_size string ───────────
    // Handles: "170g", "1 container (170g)", "2 tbsp (30g)"
    if (servingSize) {
        const gramMatch = servingSize.match(/(\d+(?:\.\d+)?)\s*g\b/i);
        if (gramMatch) {
            const grams = parseFloat(gramMatch[1]);
            const description = normalizeServingDescription(servingSize);
            return { grams, description };
        }
    }

    // ── Priority 3: no gram anchor found ───────────────────────────────────
    // Caller should trigger AI serving backfill.
    return { grams: null, description: servingSize ?? '1 serving' };
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
