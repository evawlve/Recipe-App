/**
 * serving-ai-tiers.ts — which `servingTier` values mean "an LLM MAY have run for
 * this line". `SERVING_AI_TIERS` is a maybeCalled predicate: membership means the
 * producer CAN reach a model, not that a model ran. Its event count is an UPPER
 * BOUND on model calls, and the overstatement is MEASURED, not derived: 42
 * allowlisted-tier events against 16 actual model responses per run — 2.6× —
 * over three bracketed box-served cold runs, 2026-08-05. That figure is owned by
 * sync-docs/reports/2026-08-05_ai-serving-spend-audit.md §3 (mobile repo; the §7
 * live-falsifier step 5 is the run transcript) — link, don't re-derive here.
 * Do NOT average in §3's derived 95.1%: it is a different population (the
 * historical corpus, not the cold golden set) and agrees on DIRECTION only —
 * it would predict ~2 calls per run where 16 were measured.
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
 *     enhancement".
 *
 *     REFUTED (2026-08-05) — this header used to conclude that bullet with "so
 *     every event is an unconditional live LLM round trip". The old claim stays
 *     stated here because deleting it silently would let it be re-derived: it
 *     reasoned uncached ⇒ model ran. Measured instead (three bracketed box-served
 *     cold runs, 2026-08-05, same owner doc §7): the four tiers off this producer
 *     (`fdc_size_estimate`, `fdc_medium_estimate`, `fdc_piece_ai`,
 *     `fdc_size_qualifier`) produced 41 events and ZERO model responses of any
 *     purpose. "No cache" is still true of the function; the false step was the
 *     inference from it.
 *
 *     RESOLVING MECHANISM — settled 2026-08-06 (the follow-up §7 left open).
 *     The two candidates were (a) `getFdcServingWeight()`'s non-LLM USDA lookup
 *     inside `estimateAmbiguousServing()`, or (b) persisted `FdcServing` rows
 *     making the "getOrCreate" name accurate. Measured: all 7 fdcIds behind the
 *     recent `fdc_size_*` events DO have persisted `FdcServing` rows (36 rows:
 *     30 `usda_fdc` + 6 `ai`; re-derive:
 *     `ssh owner@192.168.1.133 'docker exec mealspire-db psql -U postgres -d mealspire -c "SELECT count(*) FROM \"FdcServing\" WHERE \"fdcId\" IN (168917,170379,169640,167762,173944,171711,171545);"'`
 *     → 36, measured 2026-08-06), so row existence alone arbitrates nothing.
 *     What settles it is the code (reasoning, verified 2026-08-06): NOTHING on
 *     this path reads `FdcServing` — `getOrCreateFdcSizeServings()` calls
 *     `estimateAmbiguousServing()` directly, and its non-LLM first step
 *     (`fetchFdcServingOptions()` in src/lib/fdc/fdc-servings.ts) queries the
 *     LIVE USDA FDC API behind a 200-entry/24 h in-process cache, never the
 *     local table. A stamped `fdc_size_*` tier requires `status:'success'`, and
 *     success with zero counted model responses can only exit at the
 *     `getFdcServingWeight()` return — so (a) is the mechanism and (b) is
 *     eliminated by the absence of any read site. Corroborating measurement:
 *     the billed grams equal USDA portion values (banana 118 g = "medium",
 *     honey 21 g = "tbsp", strawberry 12 g = "medium"; box MappingEventLog vs
 *     FdcServing, 2026-08-06).
 *
 *     NARROWED (2026-08-17) — (a) is A mechanism, not THE mechanism, and the
 *     "ZERO model responses" figure above is a property of that 2026-08-05
 *     population, NOT of this producer. Measured on the box: six cold `honey`
 *     probes (`nocache=1&nosave=1`) inside 35 s on one process billed
 *     21/28/21/21/14 g and moved `/api/ok`'s `ambiguous` counter 101 → 106 —
 *     one model response per probe, `since`/`pid`/`buildId` identical either
 *     side, `FoodMapping` 4,756 before and after. So the LLM fallback IS
 *     reached, and `fdc_size_estimate` is unstable on 17 of 28 repeat-drawn
 *     lines within a single build against 0 of 335 on nine other tiers.
 *     Two traps this cost, both worth keeping stated:
 *       - The counter cannot attribute by itself. `estimateAmbiguousServing()`
 *         passes `purpose: 'ambiguous'`, the SAME purpose as
 *         `getOrCreateAmbiguousServing()`, so only a bracketed probe of a known
 *         line separates the two producers. A corpus-wide `ambiguous` total
 *         says nothing about which one spent it.
 *       - Do NOT reach for the `produce` counter to fix that. It reads 0 and
 *         always will: `produce` has zero call sites (claim
 *         `structured-llm-produce-purpose-has-no-call-site`), so its 0 is
 *         STRUCTURAL. The `ServingAiCallType` map below is a logger tag, not a
 *         `StructuredLlmPurpose`, and reading one as the other is how the
 *         attribution went wrong on first attempt.
 *     Owner, with the per-tier stability table and the control:
 *     sync-docs/reports/2026-08-17_one-producer-owns-the-serving-nondeterminism.md
 *     (mobile repo). Note the practical consequence is gate integrity, not user
 *     billing: cold traffic is unreachable from the client.
 *
 *   - `ai_generated_serving` does the opposite: it is stamped by the AI-nutrition
 *     backfill path, but its grams come from `getAiServingGrams()`, which only does
 *     `aiGeneratedServing.findUnique` reads plus deterministic unit/density maths.
 *     No model runs. Mapping it to `called: true` would INVENT calls that never
 *     happened, which is the same class of defect as the missing tag.
 *
 * TWO ERRORS IN OPPOSITE DIRECTIONS — AND THE MEASURED NET IS OVERSTATEMENT.
 * Under-inclusion: the legacy fatsecret/ai serving path stamps no `servingTier`
 * at all (the field is documented `undefined` there), so those lines read as
 * `called: false` whatever they did — 529 of 67,842 rows, 0.78% (re-derive:
 * `SELECT count(*) FROM "MappingEventLog" WHERE "servingTier" IS NULL;`, measured
 * 2026-08-04). Over-statement: within the allowlist, the maybeCalled semantics
 * above (2.6× on live traffic). An earlier version of this header weighed only
 * the first error and told readers to "quote `[AI:SERV]` as a floor, never as a
 * total"; the spend audit corrects that: quote `[AI:SERV]` as an UPPER BOUND on
 * model calls. The only per-process ground truth for "did a model actually run"
 * is the `/api/ok` `llm` block (#248), counted at the `makeRequest()` chokepoint.
 */

/** The logger's `aiCalls.serving.type` union, kept in sync with mapping-logger.ts. */
export type ServingAiCallType = 'ambiguous' | 'produce' | 'weight';

/**
 * Tiers whose producer MAY make a live LLM call (maybeCalled), mapped to the
 * call's purpose. An UPPER BOUND, never a call count — see the header: the
 * LLM/non-LLM fork sits BELOW the tier stamp, measured at 2.6× overstatement
 * (owner: sync-docs/reports/2026-08-05_ai-serving-spend-audit.md §3).
 *
 * Deliberately an ALLOWLIST rather than a name pattern: `count_unit_cached` and
 * `fdc_volume_cached` are the cached siblings of members here, and a substring
 * rule on "ai" would take `ai_generated_serving` (no model) while missing
 * `fdc_size_estimate` (a model at most — 41 events / 0 responses in the
 * 2026-08-05 measurement).
 */
export const SERVING_AI_TIERS: Readonly<Record<string, ServingAiCallType>> = Object.freeze({
    // getOrCreateAmbiguousServing(), cache miss — the sibling `count_unit_cached` is a hit.
    // maybeCalled even so: 77.3% of events bill a `default-count-grams` seed value
    // or an integer multiple (owner doc §3).
    count_unit_ai: 'ambiguous',
    // getOrCreateFdcSizeServings() -> estimateAmbiguousServing(). Uncached by
    // construction, but the estimator's USDA first step resolves without a model
    // (see header: REFUTED / RESOLVING MECHANISM).
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
 * Read `called: true` as maybeCalled — "this tier's producer can reach a model",
 * an upper bound per the header, not "a model ran". (The field name predates the
 * 2026-08-05 measurement and is kept for wire stability; renaming it is a
 * behaviour change this module deliberately does not make.)
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
        // enhancement"). NOT "always a live round trip" — that claim is refuted
        // in the header (41 events / 0 model responses, 2026-08-05); the USDA
        // first step usually resolves these. They stay HERE because the LLM
        // fallback remains reachable, and the USDA path itself sits behind a
        // live API + 24 h in-process cache — neither replays deterministically
        // from a frozen pool.
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

/**
 * SYNTHETIC GRAMS — a THIRD predicate, and again a different question from the two
 * above. They ask "was a model billed" (spend) and "can this replay differ"
 * (attribution). This one asks: **is the `grams` this tier reports a real weight at
 * all, or a placeholder the pipeline invented so the row could have a number?**
 *
 * It exists because the answer leaves the backend and is multiplied. `/api/nlp/parse`
 * emits `nutritionPer100g`, and for these rows it can only derive it as
 * `billed_kcal x 100 / billed_grams` (`per100gFromBilledMacros()` in
 * ../nlp/resolve-payload.ts, reached because the record's own panel is degenerate).
 * With invented grams that quotient is not a density — it is the invention read back.
 *
 * THE ONE MEMBER, AND WHY THE SIBLING NAME IS NOT ONE.
 * `fs_serving_macros_only_est` is stamped in build-fatsecret-result.ts when a
 * FatSecret "1 serving" restaurant record carries per-serving macros, NO gram weight
 * and NO per-100g panel. The macros are real and are billed directly and correctly;
 * the weight is `estimateServingGrams()`, i.e. `kcal / PREPARED_FOOD_KCAL_PER_GRAM`
 * with `PREPARED_FOOD_KCAL_PER_GRAM = 2.0`. So `grams x 2 == kcal` identically, and
 * the derived panel is a flat 200 kcal/100 g for EVERY such row whatever the food.
 *
 * `fs_serving_macros_only` — same branch, same code, one line apart — is NOT a
 * member: it fires when the record does have a panel, so the weight came from
 * `gramsFromPer100gPanel()`, which is arithmetic on the record's own numbers
 * (median ratio 1.000 against the 24,579 servings whose weight IS recorded). That
 * near-collision is exactly why the tier was split rather than pattern-matched: the
 * two halves were one string until 2026-08-14 and no consumer could tell them apart.
 *
 * MEASURED (2026-08-14, box `MappingEventLog` joined to `FatSecretFood`):
 *   - 777 events / 147 records / ONE tier, `grams / totalKcal` exactly 0.500 on
 *     777 of 777 — the `Math.max(macroMass, ...)` floor never binds, because
 *     Atwater factors make `kcal/2 >= protein+carbs+fat` for any self-consistent panel.
 *   - On the 76 tier-firing records that DO carry a panel (so the true weight is
 *     recoverable by inversion), the estimate's median est/true is 0.273 —
 *     3.7x too light — with p10 0.033, p90 1.105, and only 11 of 76 within +-25%.
 *   - `FatSecretFood` partitions cleanly: 20,651 rows have a panel AND a weighted
 *     serving row; 3,472 have NEITHER and nothing in between. `OffFood` has 0 of
 *     1,085,525 panel-less rows, so this shape is FatSecret-only.
 * Re-derive and owner: sync-docs/reports/2026-08-14_the-empty-panel-serving-is-synthetic.md
 * (mobile repo), which also owns the consumer half.
 *
 * WHAT A CONSUMER SHOULD DO WITH A TRUE. Decline to offer gram- or volume-denominated
 * portions, and say the weight is an estimate. NOT "substitute a better constant":
 * the true densities behind this population run 0-494 kcal/100 g (p10 6.2, median
 * 63.0), so no constant can serve a brewed coffee and a fried chicken thigh, and a
 * plausible-but-wrong weight is worse than declining to state one — it is
 * indistinguishable from a measured one at the point of use.
 */
/**
 * The one member's name, exported so its PRODUCERS reference the registry rather
 * than a bare literal.
 *
 * There are two producers as of 2026-08-14 and they are in different lanes:
 * build-fatsecret-result.ts's macro-only branch (`fromPanel == null` leg, the
 * mapper) and `runLocalSearch()` in app/api/foods/search/route.ts (the browse
 * list, which recovers the same servings after `derivePer100gFromServings()`
 * refuses them). Both must stamp THIS constant and gate their
 * `portionEstimated` on `isSyntheticGramsTier()`, so removing the tier from the
 * frozen list below stops both lanes claiming the flag at once.
 */
export const FS_SERVING_MACROS_ONLY_EST_TIER = 'fs_serving_macros_only_est';

export const SYNTHETIC_GRAMS_SERVING_TIERS: readonly string[] = Object.freeze(
    ([
        // build-fatsecret-result.ts, macro-only branch, `fromPanel == null` leg;
        // and runLocalSearch()'s recovery of the same shape in the search route.
        FS_SERVING_MACROS_ONLY_EST_TIER,
    ] as const),
);

/** Lookup index. Module-private so the exported constant stays genuinely frozen. */
const SYNTHETIC_GRAMS_INDEX = new Set<string>(SYNTHETIC_GRAMS_SERVING_TIERS);

/**
 * True when `tier`'s reported grams are a placeholder rather than a measured or
 * derived weight — so anything computed by dividing BY them is fabricated too.
 *
 * Returns false for an unclassified tier, matching the two siblings above: a new
 * tier is assumed honest until someone reads its producer and says otherwise. The
 * guard against a silent miss is the producer census in `serving-ai-tiers.test.ts`.
 */
export function isSyntheticGramsTier(tier: string | null | undefined): boolean {
    return tier != null && SYNTHETIC_GRAMS_INDEX.has(tier);
}
