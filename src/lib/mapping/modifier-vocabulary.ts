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
 * byte-identical on noCache=f and =t; the same predicate over 1,805 corpus names
 * hard-deleted 1,162 (64.4%) on sight (pm19 ROW 1, owner: KindaHealthyMobile
 * sync-docs/reports/2026-09-01_pm19-pm20-ultracode-lane-briefs.md).
 *
 * `modifier-constraints.ts` (the rerank PENALTY side) keeps reading the
 * gather-candidates const directly — it is a FROZEN_INPUT_PATHS file and is not
 * part of this change.
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
 * `light`/`lite` are in the retrieval group but must NOT trigger the low-calorie
 * admission check: they are handled by `LENIENT_LOW_FAT` in
 * hasCriticalModifierMismatch() and would otherwise fire on every `light mayo`-
 * class line (n-syn-04 `light corn syrup` is a golden sentinel on exactly that).
 */
const NOT_A_QUERY_TRIGGER: ReadonlySet<string> = new Set(['light', 'lite']);

/**
 * Explicit calorie claims the filter has always required (they are not in the
 * retrieval group because `buildQueryVariants()` never needed them).
 */
const CALORIE_CLAIM_SPELLINGS: readonly string[] = ['zero calorie', 'calorie free', 'calorie-free'];

/**
 * QUERY side: a line carrying any of these asks for a low-calorie / sugar-free
 * product, and a candidate must then carry a matching claim to be admitted.
 * Matched by `includes()` on the lowercased line, like the surrounding code, so
 * `no sugar` also covers `no sugar added`.
 *
 * Re-derive the membership: it is the sugar-free retrieval group minus
 * `light`/`lite`, plus the three calorie spellings — 12 entries on 2026-09-02.
 */
export const LOW_CAL_QUERY_TRIGGERS: readonly string[] = [
    ...SUGAR_FREE_SYNONYM_GROUP.filter(m => !NOT_A_QUERY_TRIGGER.has(m)),
    ...CALORIE_CLAIM_SPELLINGS,
];

/**
 * CANDIDATE side, the `includes()` half: every query trigger, plus the retrieval
 * group's `light`/`lite` (kept deliberately — dropping them newly hard-drops
 * 11,242 corpus records that satisfy the low-cal side only through them:
 * 10,898 OFF + 344 FS, measured 2026-09-01, pm19 ROW 1), `no added sugar`, and
 * `fat free`/`fat-free`, which frozen desserts use interchangeably with
 * `sugar free`.
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
 *       corpus rows end this way (measured 2026-09-01, pm19 ROW 1);
 *   (b) `zero` immediately followed by a sugar/calorie/carb word:
 *       "ZERO SUGAR", "Zero Calorie Sweetener", "Isopure Zero Carb".
 * Deliberately NOT a bare word-boundary `zero`: that rescues 581 rows of which
 * ~33 are non-sugar claims (zero proof 12, zero alcohol 8, zero lactose 8,
 * zero fat 5 — same measurement), so "White Claw Zero Proof Mango Passion
 * Fruit" and "White Claw Zero Lime Yuzu" stay rejected for a sugar-free query.
 * A trailing `zero` followed only by a parenthetical size ("Coke Zero (Can)")
 * is shape (a) as well.
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
