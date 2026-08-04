/**
 * serving-ai-tiers.ts — which `servingTier` values mean "an LLM ran for this line".
 *
 * WHY THIS EXISTS
 * ---------------
 * `MappingAnalysisLog.aiCalls.serving` was declared in mapping-logger.ts and never
 * written by anyone, so the `[AI:SERV]` tag in `logs/mapping-summary-*.txt` is
 * structurally unreachable and reads 0 — which is Phase 0.5(b), not evidence that
 * no serving AI calls happen. The fix belongs at the WRITE sites; this module is
 * the shared derivation they call.
 *
 * THE TIER NAMES ARE NOT A RELIABLE GUIDE, IN BOTH DIRECTIONS.
 * Each entry below was settled by reading the producer, not by pattern-matching
 * the string (2026-08-04):
 *
 *   - `fdc_size_estimate` is the LARGEST live AI-serving tier (3,450 of 67,842
 *     MappingEventLog rows) and has no "ai" in its name at all. It and
 *     `fdc_medium_estimate` both come from `getOrCreateFdcSizeServings()`
 *     (src/lib/usda/fdc-ai-backfill.ts), which despite the "getOrCreate" name has
 *     NO CACHE — its own docstring says results "should be cached in a future
 *     enhancement" — so every event is an unconditional live LLM round trip.
 *
 *   - `ai_generated_serving` does the opposite: it is stamped by the AI-nutrition
 *     backfill path, but its grams come from `getAiServingGrams()`, which only does
 *     `aiGeneratedServing.findUnique` reads plus deterministic unit/density maths.
 *     No model runs. Mapping it to `called: true` would INVENT calls that never
 *     happened, which is the same class of defect as the missing tag.
 *
 * KNOWN BLIND SPOT — the count this produces is a LOWER BOUND.
 * The legacy fatsecret/ai serving path stamps no `servingTier` at all (the field is
 * documented `undefined` there), so those lines read as `called: false` whatever
 * they did. That is 529 of 67,842 rows, 0.78% (re-derive:
 * `SELECT count(*) FROM "MappingEventLog" WHERE "servingTier" IS NULL;`, measured
 * 2026-08-04). Quote `[AI:SERV]` as a floor, never as a total.
 */

/** The logger's `aiCalls.serving.type` union, kept in sync with mapping-logger.ts. */
export type ServingAiCallType = 'ambiguous' | 'produce' | 'weight';

/**
 * Tiers whose producer makes a live LLM call, mapped to the call's purpose.
 *
 * Deliberately an ALLOWLIST rather than a name pattern: `count_unit_cached` and
 * `fdc_volume_cached` are the cached siblings of members here, and a substring
 * rule on "ai" would take `ai_generated_serving` (no model) while missing
 * `fdc_size_estimate` (always a model).
 */
export const SERVING_AI_TIERS: Readonly<Record<string, ServingAiCallType>> = Object.freeze({
    // getOrCreateAmbiguousServing(), cache miss — the sibling `count_unit_cached` is a hit.
    count_unit_ai: 'ambiguous',
    // getOrCreateFdcSizeServings() -> estimateAmbiguousServing(). Uncached by construction.
    fdc_size_estimate: 'produce',
    fdc_medium_estimate: 'produce',
    // Unitless piece estimation for produce.
    fdc_piece_ai: 'produce',
    // insertFdcAiServing(volume) — the sibling `fdc_volume_cached` is a hit.
    fdc_volume_ai: 'weight',
});

/**
 * Derive the `aiCalls.serving` record from the tier that billed this line.
 *
 * Returns `called: false` for an absent tier rather than `undefined`, so the
 * analysis log distinguishes "resolved without a model" from "never populated" —
 * telling those two apart is the whole point of 0.5(b).
 */
export function servingAiCallForTier(
    tier: string | null | undefined,
): { called: boolean; type?: ServingAiCallType } {
    const type = tier ? SERVING_AI_TIERS[tier] : undefined;
    return type ? { called: true, type } : { called: false };
}
