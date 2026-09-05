/**
 * The modifier vocabulary the mapping pipeline shares between RETRIEVAL and ADMISSION.
 *
 * ## Why this is its own file
 *
 * This module must import NOTHING. `filter-candidates.ts` reads it, and
 * `filter-candidates.ts` is itself imported by `gather-candidates.ts` (for
 * `detectGrainCookingContext()`), so a VALUE import of `MODIFIER_SYNONYM_GROUPS`
 * from gather-candidates into filter-candidates would close a require cycle:
 *
 *   gather-candidates -> filter-candidates -> gather-candidates
 *
 * on top of the one `declined-confidence.ts` already documents
 * (gather-candidates -> sub-threshold-admission -> simple-rerank ->
 * modifier-constraints -> gather-candidates). In that shape the const is
 * `undefined` on the module that has not finished evaluating and the first
 * `.find()`/`.some()` over it throws "Cannot read properties of undefined
 * (reading 'find')" at runtime. Typecheck and lint both pass through a require
 * cycle; only the tests catch it. Keep this file import-free.
 *
 * ## What it owns
 *
 * `MODIFIER_SYNONYM_GROUPS` below is a COPY of the const of the same name in
 * `gather-candidates.ts`, which `buildQueryVariants()` reads to expand a query
 * ("sugar free" -> also search "zero sugar", "diet", ...). `gather-candidates.ts`
 * is a RETRIEVAL_PATHS file for the winner gate (`scripts/eval/winner-gate.sh`),
 * so it is deliberately untouched by the change that introduced this file; a
 * follow-up may make it re-export from here. Until then
 * `__tests__/modifier-vocabulary-shared-class.test.ts` asserts the two are deep
 * equal, so the copy cannot drift silently.
 *
 * The filter-side sets are DERIVED from the sugar-free group here, not restated.
 * Before 2026-09-02 `hasCriticalModifierMismatch()` in `filter-candidates.ts`
 * carried its own list — `CALORIE_MODIFIERS`, eight spellings with no
 * `zero sugar`, `no sugar` or `unsweetened` — so the retrieval side searched for
 * spellings the admission side hard-deleted on arrival: `sugar free coke`
 * deleted fs_43580 "Coke Zero" (name carries only a trailing `Zero`), emptied
 * the strict pool, and the relaxed retry, which skips the modifier check, handed
 * back fs_644459 "Caffeine Free Coke" at 100 kcal. Measured live 2026-09-01,
 * byte-identical on noCache=f and =t.
 *
 * The same predicate over 1,805 corpus names hard-deleted 1,162 (64.4%) on sight
 * (pm19 ROW 1, owner: KindaHealthyMobile
 * sync-docs/reports/2026-09-01_pm19-pm20-ultracode-lane-briefs.md).
 * UNVERIFIED — those 1,805 names are the candidate names a GATHER returned for
 * the sugar-free seed lines (the `row1-fix-seeds.txt` block preserved on PR
 * #413), not a table, so no SQL re-derives them; and replaying the gather is not
 * read-only (the FatSecret lane persists hits), so it was not re-run on
 * 2026-09-03 when every other number in this header was. Re-derive shape:
 * `ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register`
 * over `gatherCandidates()` per seed, counting names for which
 * `hasCriticalModifierMismatch(seed, name, source)` is true — under a
 * DB-write-suppressing harness, or the count costs `FatSecretFood` rows.
 *
 * ## The corpus numbers below, and how to re-derive them
 *
 * "The corpus" throughout this file means the union of product NAMES in the two
 * ingested tables, and every count is over rows, not distinct names:
 *
 *   WITH corpus AS (
 *     SELECT lower(name) AS n FROM "OffFood"
 *     UNION ALL SELECT lower(name) FROM "FatSecretFood"
 *   )
 *
 * — 1,109,670 rows on 2026-09-03. Run each query below on the box, over stdin:
 *   cat q.sql | ssh owner@192.168.1.133 \
 *     'docker exec -i mealspire-db psql -U postgres -d mealspire'
 * (an inline escaped string loses the `\y` word boundaries inside the nested
 * quote layers and silently matches nothing — that misread cost pm19 a headline).
 *
 * Where a figure below carries two values, the first was measured 2026-09-01 with
 * no command recorded and does NOT reproduce from the query now printed beside it;
 * the second is what that query returns. The direction of every gap is small and
 * the corpus grows, so treat the 09-03 value as the number and the 09-01 one as
 * history, not as two measurements of the same thing.
 *
 * `modifier-constraints.ts` (the rerank PENALTY side) keeps reading the
 * gather-candidates const directly — it is a FROZEN_INPUT_PATHS file and is not
 * part of this change.
 *
 * ## What this vocabulary reaches that the admission pass does not
 *
 * `hasCriticalModifierMismatch()` has six non-test call sites and only two are in
 * `filterCandidatesByTokens()`. The all-drop restore lives in that function, so it
 * protects a candidate ONLY during strict admission — it is not a property of the
 * predicate and cannot be relied on anywhere else:
 *
 * - LATE BINDING, `hydrateAndSelectServing()` in `serving/hydration-lane.ts`, is
 *   OUTSIDE the restore. A winner the restore admitted can still be rejected there
 *   (`hydrate.late_critical_modifier_mismatch_rejected` → `return null`), because
 *   that call re-runs the predicate with computed per-100 g fat after the pick.
 *   Its reach is narrow: the FDC, OFF and FatSecret branches all `return` earlier
 *   in that function, so it is reached only by legacy `cache` / `ai_generated`
 *   (name-keyed `AiGeneratedFood`) winners.
 * - THE CACHE-READ SITES are exempt for human-triage rows at three of four.
 *   `HUMAN_TRUST_SKIPPABLE_ESCAPES` in `validated-mapping-helpers.ts` contains
 *   `modifier_mismatch`, which covers the two mapper-side reads (the early-cache
 *   escape and the `normalizedCache` re-check in `map-ingredient-with-fallback.ts`);
 *   `getValidatedMappingByNormalizedName()` is exempt through its own
 *   `humanRowTrusted` flag and records a `trustSkippedRejection` instead of
 *   returning null. The fourth — the token-set-equal candidate walk in the same
 *   helpers file — has NO exemption and skips the candidate outright. So widening
 *   this vocabulary cannot distrust a human-repointed row on three of the four
 *   paths, which bounds the read-side blast radius further.
 * - THE READ-SIDE BOUND IS A TOKEN-SET BOUND, not a substring one.
 *   `FoodMapping.normalizedForm` is token-SORTED (`bar quest` is the key for
 *   `1 bar of quest`), so walking it for a multi-word trigger like `zero sugar`
 *   is blind — 4 of the 5 keys whose token set is {zero, sugar} do not contain
 *   the bigram (`dew mountain sugar zero`, `chobani extract sugar vanilla zero`).
 *   On the 2026-08-28 `FoodMapping` snapshot: a naive key walk finds 17 keys
 *   (usedCount 420) and the token-set bound 21 (425). Either way, 2 rows become
 *   DISTRUSTED on read and 0 become newly trusted — `black gold peak tea
 *   unsweetened` and `black pure tea unsweetened`, both `validatedBy: 'ai'`,
 *   both pointing at a sweetened record. Live on 2026-09-03 (4,810 rows) the same
 *   two are still the only ones, at 22 (481) naive / 32 (492) token-set:
 *
 *     WITH k AS (SELECT "normalizedForm" n, "usedCount" u FROM "FoodMapping")
 *     SELECT count(*), coalesce(sum(u),0) FROM k
 *      WHERE n ~ '\yunsweetened\y' OR n ~ '\ydiet\y'
 *         OR (n ~ '\ysugar\y' AND n ~ '\yfree\y')
 *         OR (n ~ '\ysugar\y' AND n ~ '\yzero\y')
 *         OR (n ~ '\ysugar\y' AND n ~ '\yno\y')
 *         OR (n ~ '\ycalorie\y' AND n ~ '\ylow\y')
 *         OR (n ~ '\ycalorie\y' AND n ~ '\yzero\y')
 *         OR (n ~ '\ycalorie\y' AND n ~ '\yfree\y')
 *         OR n ~ '\ysugar-free\y' OR n ~ '\ylow-calorie\y' OR n ~ '\ycalorie-free\y';
 *
 *   Inspect the hits with `SELECT "normalizedForm","foodName","usedCount",
 *   "validatedBy" FROM "FoodMapping" WHERE …` — the count alone cannot tell you
 *   which rows flip, and only the flips matter.
 */

/**
 * Copy of `MODIFIER_SYNONYM_GROUPS` in gather-candidates.ts — one group per line,
 * same order, same spellings. The doc-check claim
 * `critical-modifier-filter-reads-the-shared-class` greps the sugar-free line
 * for `'zero sugar'`, so keep each group on ONE line.
 */
export const MODIFIER_SYNONYM_GROUPS: string[][] = [
    // Fat-free group (NOT the same as reduced-fat)
    ['fat free', 'fat-free', 'nonfat', 'non-fat', 'skim', '0%', 'zero fat'],
    // Reduced-fat group (separate from fat-free)
    ['reduced fat', 'low fat', 'lowfat', 'low-fat', 'light', 'lite', '2%', '1%'],
    // Sugar-free/unsweetened group - includes low-calorie equivalents
    // "sugar free cherry pie filling" should also find "low calorie cherry pie filling"
    ['unsweetened', 'no sugar added', 'sugar free', 'sugar-free', 'no sugar', 'zero sugar', 'low calorie', 'low-calorie', 'lite', 'light', 'diet'],
    // Whole grain group
    ['whole grain', 'whole wheat', 'wholegrain', 'wholewheat', 'whole-grain', 'whole-wheat'],
    // Extra lean group (ground meats)
    ['extra lean', 'extra-lean', '95%', '93%', '95% lean', '93% lean'],
    // Lean group (ground meats)
    ['lean', '90%', '85%', '90% lean', '85% lean', '90/10', '85/15'],
    // Organic group
    ['organic', 'certified organic'],
    // Regular/whole dairy
    ['whole', 'full fat', 'regular', 'full-fat'],
];

/** The group `buildQueryVariants()` expands a sugar-free/low-calorie query into. */
export const SUGAR_FREE_SYNONYM_GROUP: readonly string[] = (() => {
    const group = MODIFIER_SYNONYM_GROUPS.find(g => g.includes('sugar free'));
    if (!group) throw new Error('modifier-vocabulary: no synonym group contains "sugar free"');
    return group;
})();

/**
 * Explicit calorie claims the filter has always required (they are not in the
 * retrieval group because `buildQueryVariants()` never needed them).
 */
const CALORIE_CLAIM_SPELLINGS: readonly string[] = ['zero calorie', 'calorie free', 'calorie-free'];

/**
 * QUERY side: a line carrying any of these asks for a low-calorie / sugar-free
 * product, and a candidate must then carry a matching claim to be admitted.
 * Matched by `includes()` on the lowercased line, like the surrounding code.
 *
 * THIS IS MASTER'S EXACT EIGHT, DELIBERATELY. It is the former private
 * `CALORIE_MODIFIERS` list in filter-candidates.ts, character for character, so
 * `queryCarriesLowCalClaim()` is a byte-equivalent replacement for the predicate
 * it replaced and this PR changes NOTHING on the query side.
 *
 * WHY IT IS NOT THE RETRIEVAL GROUP. An earlier revision of this branch derived
 * the set as `SUGAR_FREE_SYNONYM_GROUP` minus `light`/`lite` plus the calorie
 * spellings — 12 entries, adding `unsweetened`, `no sugar`, `no sugar added` and
 * `zero sugar`. That is a HARD-GATE widening: a query trigger makes admission
 * stricter (more hard deletes), which is the BOTTOM of the preference order in
 * the backend CLAUDE.md (admit-only relaxation -> relative demotion -> confidence
 * suppression -> absolute gate). Its arms found it turns `pure leaf unsweetened
 * black tea` into an HTTP 500 (1 of 32 newly-narrowed lines; the trigger
 * `unsweetened` IS the mechanism), its headline case `sugar free coke` was
 * byte-identical on both arms because that pool empties one stage later at
 * `hasCoreTokenMismatch`, and 2 of its 4 winner moves were costs. Diego ruled
 * admit-only on 2026-09-03.
 *
 * The vocabulary DISAGREEMENT that motivated the widening is real and is NOT
 * fixed here: `buildQueryVariants()` still searches for `zero sugar`, `no sugar`
 * and `unsweetened`, and this check still does not treat them as claims on the
 * query side. The admit-only half addresses the other direction only — a
 * candidate that STATES one of those claims is no longer hard-dropped. Closing
 * the query side needs the step-3b design that also fixes `hasCoreTokenMismatch`
 * (punch #65), not a longer list here.
 *
 * Re-derive: this list must equal master's `CALORIE_MODIFIERS`; the shared-class
 * test pins all eight literally.
 */
export const LOW_CAL_QUERY_TRIGGERS: readonly string[] = [
    'low calorie', 'low-calorie', 'diet',
    'zero calorie', 'calorie free', 'calorie-free',
    'sugar free', 'sugar-free',
];

/**
 * CANDIDATE side, the `includes()` half: every query trigger, plus the retrieval
 * group's `light`/`lite` (kept deliberately — dropping them newly hard-drops the
 * corpus records that satisfy the low-cal side ONLY through them: 11,242 =
 * 10,898 OFF + 344 FS on 2026-09-01 (pm19 ROW 1, no command recorded), and
 * 11,211 = 10,871 OFF + 340 FS on 2026-09-03 from the query below), plus
 * `no added sugar` and `fat free`/`fat-free`, which frozen desserts use
 * interchangeably with `sugar free`.
 *
 *   -- corpus CTE + `\y` caveat: see the header. Run per table to split OFF/FS.
 *   SELECT count(*) FROM corpus
 *    WHERE n ~ '(light|lite)'
 *      AND n !~ '(unsweetened|no sugar added|sugar free|sugar-free|no sugar|zero sugar|low calorie|low-calorie|diet|zero calorie|calorie free|calorie-free|no added sugar|fat free|fat-free)'
 *      AND n !~ '\yzero\s*(\([^)]*\)\s*)?$|\yzero[\s-]+(sugar|sugars|calorie|calories|cal|carb|carbs|net|added)\y';
 */
export const LOW_CAL_CANDIDATE_SATISFIERS: readonly string[] = [
    ...SUGAR_FREE_SYNONYM_GROUP,
    ...CALORIE_CLAIM_SPELLINGS,
    'no added sugar',
    'fat free', 'fat-free',
];

/**
 * CANDIDATE side, the regex half — the two shapes in which a record states a
 * sugar/calorie claim with a bare `zero`:
 *   (a) a TRAILING `zero`: "Coke Zero", "Sprite Zero", "Gatorade Zero" — 153
 *       corpus rows on 2026-09-01 (pm19 ROW 1, no command recorded), 176 on
 *       2026-09-03:
 *         SELECT count(*) FROM corpus WHERE n ~ '\yzero\s*(\([^)]*\)\s*)?$';
 *   (b) `zero` immediately followed by a sugar/calorie/carb word:
 *       "ZERO SUGAR", "Zero Calorie Sweetener", "Isopure Zero Carb".
 * Deliberately NOT a bare word-boundary `zero`. That widening admits the rows
 * this regex and the substring satisfiers both miss — 581 on 2026-09-01 (no
 * command recorded), 354 on 2026-09-03:
 *
 *   SELECT count(*) FROM corpus
 *    WHERE n ~ '\yzero\y'
 *      AND n !~ '\yzero\s*(\([^)]*\)\s*)?$|\yzero[\s-]+(sugar|sugars|calorie|calories|cal|carb|carbs|net|added)\y'
 *      AND n !~ '(unsweetened|no sugar added|sugar free|sugar-free|no sugar|zero sugar|low calorie|low-calorie|diet|zero calorie|calorie free|calorie-free|no added sugar|fat free|fat-free|light|lite)';
 *
 * — of which the ones that are NOT a sugar claim are what make the widening
 * wrong rather than merely wide: ~33 on 2026-09-01 (zero proof 12, zero alcohol
 * 8, zero lactose 8, zero fat 5), 36 on 2026-09-03 (14 / 8 / 9 / 5), from the
 * same query with `AND n ~ '\yzero[\s-]+(proof|alcohol|lactose|fat)\y'`. That
 * is why "White Claw Zero Proof Mango Passion Fruit" and "White Claw Zero Lime
 * Yuzu" stay rejected for a sugar-free query. A trailing `zero` followed only by
 * a parenthetical size ("Coke Zero (Can)") is shape (a) as well.
 */
export const BARE_ZERO_CLAIM_RE =
    /\bzero\s*(?:\([^)]*\)\s*)?$|\bzero[\s-]+(?:sugar|sugars|calorie|calories|cal|carb|carbs|net|added)\b/;

/** Does a lowercased query line ask for a low-calorie / sugar-free product? */
export function queryCarriesLowCalClaim(queryLower: string): boolean {
    return LOW_CAL_QUERY_TRIGGERS.some(m => queryLower.includes(m));
}

/** Does a lowercased candidate name state a low-calorie / sugar-free claim? */
export function candidateCarriesLowCalClaim(nameLower: string): boolean {
    return LOW_CAL_CANDIDATE_SATISFIERS.some(m => nameLower.includes(m))
        || BARE_ZERO_CLAIM_RE.test(nameLower);
}
