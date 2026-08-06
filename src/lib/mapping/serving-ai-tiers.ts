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

/**
 * REPLAY NONDETERMINISM — a DIFFERENT predicate from `SERVING_AI_TIERS`, and the
 * reason this is a second export rather than a reuse of the first.
 *
 * `SERVING_AI_TIERS` answers "was a model BILLED for this line" (spend). The two
 * offline instruments need a different question: **"can this tier's grams differ
 * between two replays of the same frozen pool"** (attribution). Their own comments
 * already say so — winner-diff's `aiTouched` exists because such rows "do not
 * replay deterministically, so they are flagged... rather than counted as movement
 * the change under test caused", and correctness-screen abstains because the anchor
 * "is a fresh model guess that can differ on the next request".
 *
 * The two predicates are close but NOT equal, in both directions:
 *   - `ai_generated_serving` bills NOTHING (`getAiServingGrams()` is a findUnique
 *     plus density maths) so it is absent from `SERVING_AI_TIERS` — but the row it
 *     reads is written by the model-backed nutrition backfill, so replay 1 can
 *     create what replay 2 then reads. It is nondeterministic and belongs here.
 *   - `discrete_unit_backfill` is the mirror image: it is nondeterministic, but it
 *     is deliberately NOT added to `SERVING_AI_TIERS`, because that allowlist forks
 *     hit-from-miss by tier NAME (`count_unit_cached` vs `count_unit_ai`) and this
 *     tier collapses both — see the note on its entry below.
 *
 * WHY AN ALLOWLIST AND NOT A REGEX. Until 2026-08-05 each instrument carried its
 * own private pattern — `/(^|_)ai(_|$)|estimate/i` in winner-diff.ts and
 * `/(^|_)ai(_|$)|estimat/i` in correctness-screen.ts. The `estimate`/`estimat`
 * divergence was inert on the live tier set (only `fdc_size_estimate` contains
 * either), so the visible symptom was harmless. **The real defect was the half they
 * AGREED on**: a name pattern silently returns false for a tier it has never heard
 * of, and two tiers stamped directly on an AI producer's result matched neither —
 * `discrete_unit_backfill` (1,269 events) and `fdc_size_qualifier` (345), 1,614 of
 * 69,529 (2.3%), measured on the box 2026-08-05. Both instruments were therefore
 * charging that movement to the change under test.
 *
 * Every entry was settled by reading the branch that CONSUMES the producer's
 * result, not by proximity. An adjacency scan over the same call sites also
 * nominated `volume_unit` (5,379), `bare_plural_serving` (2,268),
 * `bare_sibling_serving` (2,230) and `bare_query_default` (463); all four sit in
 * sibling `else` branches that never read the AI result and are REFUTED — they are
 * pinned as non-members in the test so the adjacency mistake cannot be re-made.
 *
 * Re-derive the population:
 * `ssh owner@192.168.1.133 'docker exec mealspire-db psql -U postgres -d mealspire
 *  -c "SELECT \"servingTier\", count(*) FROM \"MappingEventLog\" GROUP BY 1 ORDER BY 2 DESC;"'`
 *
 * EXPORTED AS A FROZEN ARRAY, NOT A FROZEN SET, AND THAT IS DELIBERATE.
 * `Object.freeze(new Set([...]))` is a no-op protection: `Object.isFrozen()` returns
 * true while `.add()` still mutates, because a Set's contents are internal slots and
 * not own properties. The first cut of this module did exactly that, and its test
 * asserted `isFrozen` — a green assertion for a guard that does not hold. A frozen
 * ARRAY throws on push in strict mode, so the freeze here is real and the sibling
 * `SERVING_AI_TIERS` (a plain object, where freeze does work) keeps its own pattern.
 */
export const REPLAY_NONDETERMINISTIC_SERVING_TIERS: readonly string[] = Object.freeze(
    ([
        // --- getOrCreateAmbiguousServing() ---
        // Cache MISS. Its cached sibling `count_unit_cached` is deterministic and absent.
        'count_unit_ai',
        // Same producer, but this call site stamps ONE name for `success` AND `cached`
        // (serving/hydration-lane.ts, the discrete-unit backfill branch), so no
        // name-based rule can ever separate them. That is why it is here and not in
        // SERVING_AI_TIERS: as a nondeterminism flag it is correct on both statuses,
        // whereas as a BILLING flag it would count every cache hit as a model call.
        // The durable fix is a provenance field at the producer, not a longer list —
        // owner: sync-docs/reports/2026-08-05_ai-serving-spend-audit.md.
        'discrete_unit_backfill',

        // --- getOrCreateFdcSizeServings() -> estimateAmbiguousServing() ---
        // Uncached by construction (its own docstring says caching is "a future
        // enhancement"), so every one of these is a live round trip.
        'fdc_size_estimate',
        'fdc_medium_estimate',
        // Third tier off that same producer, stamped on the size-qualifier branch.
        // Already recorded as a known omission from SERVING_AI_TIERS; it is not
        // silently added there here, because that allowlist has its own owner doc
        // and doc-check claims that quote its totals.
        'fdc_size_qualifier',

        // --- estimateAmbiguousServing(), unitless piece estimation for produce ---
        'fdc_piece_ai',

        // --- insertFdcAiServing('volume') --- sibling `fdc_volume_cached` is a hit.
        'fdc_volume_ai',

        // --- ai-nutrition backfill --- bills nothing itself (see header), but the
        // AiGeneratedServing row it reads is model-written, so it is replay-unstable.
        // Both retired regexes matched this, so keeping it is the status quo.
        'ai_generated_serving',
    ] as const),
);

/** Lookup index. Module-private so the exported constant stays genuinely frozen. */
const REPLAY_NONDETERMINISTIC_INDEX = new Set<string>(REPLAY_NONDETERMINISTIC_SERVING_TIERS);

/**
 * True when `tier`'s grams may differ between two replays of the same frozen pool.
 *
 * Returns false for an unclassified tier — the same reading both retired regexes
 * gave, and deliberately not changed here: flipping the default would mark all ~35
 * tiers nondeterministic and silence both instruments on the whole corpus, which is
 * the expensive direction. The guard against a silent miss is instead the producer
 * call-site census in `serving-ai-tiers.test.ts`: a NEW AI producer cannot be added
 * without a test failure forcing a decision here. That census is the durable half of
 * this fix; the two-tier correction is the one-off half.
 */
export function isReplayNondeterministicTier(tier: string | null | undefined): boolean {
    return tier != null && REPLAY_NONDETERMINISTIC_INDEX.has(tier);
}
