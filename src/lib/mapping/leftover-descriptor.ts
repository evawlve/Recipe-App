/**
 * `leftover` is a provenance descriptor, not an identity (C70 / S239).
 *
 * Mechanism (measured by S239): when the singular adjective `leftover` survives into the
 * mapper's baseName or parsed.name, retrieval and rerank treat it as a scoring / required token
 * and pick a wrong `rice ...` / `chinese ...` record ("leftover rice" -> Rice Paper 6 g). When
 * the segmenter happens to drop it, the same line resolves right (White Rice 158 g). Same shape
 * as #499's stripHomemadeDescriptor(), which nobody extended to `leftover`.
 *
 * Strips the SINGULAR adjective `leftover` / `left-over` (case-insensitive) when at least one
 * word follows it; collapses spaces and trims.
 *
 * Exemptions (never stripped):
 *   - plural `leftovers` (a noun: the TJ's seasoning blend, the Tesco curry kit);
 *   - two-word `left over` (a verb phrase: "rice left over from dinner");
 *   - possessive `leftover's` / `leftover’s`;
 *   - a result that would be empty (bare `leftover`, `the leftover`);
 *   - a brand containing `leftover`.
 *
 * Where it runs: preflightIngredientLine() in map-ingredient-with-fallback.ts, at TWO seats that
 * move together. (b) parsed.name, because searchQuery / confidenceGate / assessConfidence /
 * rerank read it; (a) baseName, last, because it is the retrieval query AND the cache key.
 *
 * Pure: no I/O. The caller supplies the brand
 * (`options.brand?.trim() || detectBrandInQuery(rawLine).matchedBrand`).
 */

const LEFTOVER = /\bleft-?over\b(?!['’]s\b)(?=\s+\S)/i;

export function stripLeftoverDescriptor(
    baseName: string,
    rawLine: string,
    brand: string | null | undefined,
): { baseName: string; stripped: boolean; reason?: string } {
    void rawLine;
    if (!LEFTOVER.test(baseName)) return { baseName, stripped: false };
    if (/left-?over/i.test(brand ?? '')) return { baseName, stripped: false, reason: 'brand-owns' };
    const out = baseName.replace(new RegExp(LEFTOVER.source, 'gi'), ' ').replace(/\s+/g, ' ').trim();
    if (!out) return { baseName, stripped: false };
    return { baseName: out, stripped: true };
}
