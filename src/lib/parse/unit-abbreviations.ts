/**
 * Unit-letter and container abbreviations: `3 c popcorn`, `2 T peanut butter`,
 * `1 cn black beans`, `1 btl water`.
 *
 * MECHANISM. normalizeUnitToken() (unit.ts) has no entry for `c`, `t`, `tbs`,
 * `tbl`, `cn` or `btl`, so after an explicit quantity the letter stayed in the
 * NAME (`c popcorn`, `T peanut butter`), the unit was null and the quantity was
 * read as a bare COUNT. This table rewrites that one token to the full unit word
 * BEFORE parseIngredientLine()'s unit branch runs, so the existing branch reads
 * it exactly as it reads the spelled-out twin.
 *
 * Why it is not inside normalizeUnitToken(): `T` (tablespoon) vs `t` (teaspoon)
 * is a CASE-SENSITIVE rule and normalizeUnitToken() lowercases first. The map
 * there is also shared by convertUnit() and every other caller; this table is
 * consulted at exactly one call site.
 *
 * Table (EXACT whole-token match, no regex over the line):
 *   case-SENSITIVE:   `T` `T.` -> tbsp ; `t` `t.` -> tsp
 *   case-insensitive: `c` `c.` -> cup ; `tbs` `tbs.` `tbl` `tbl.` `tbls` -> tbsp ;
 *                     `cn` `cns` -> can ; `btl` `btls` -> bottle
 * Every target is a non-`unknown` normalizeUnitToken() key (pinned in the test,
 * so the two lists cannot drift apart).
 *
 * GUARDS (the caller supplies the first two; this function owns the third):
 *   1. an explicit quantity precedes the token (`vitamin c gummies`, `c popcorn`)
 *   2. a WORD token follows it (`1 c` alone is unchanged; the name is never emptied)
 *   3. decline when the follower is `de`/`del` (Spanish `2 c de aceite` means
 *      cucharada, and `t` there would be taza) and, for `T`/`t` only, when it is
 *      `bone`/`bones` (`1 T bone steak`).
 * `1 t-bone steak`, `2 c4 energy drinks`, `1 C&H sugar`, `1 cnt eggs` never match
 * because the whole token must equal a table key.
 *
 * KNOWN COSTS (not fixed here):
 *   - ONE call site. These shapes stay unexpanded: `1/2 c and 1 T` (compound
 *     continuation), `a T of honey`, `half a c of rice`, `1 (15 oz) cn beans`,
 *     `2 c 2% milk` and `1 c (8 oz) milk` (the next token is not a word),
 *     `1/2c`, `½c`.
 *   - Case is authoritative on the solo path and on a cold segmented split. The
 *     SegmentationCache key is lowercased (canonicalizeSegLine), so on a CACHED
 *     multi-item line `T` vs `t` follows the first writer's rawText (0 of 443
 *     cached rows have the shape today).
 *   - Twin equivalence, not correctness: the spelled-out twins have their own
 *     gaps (`a bottle of water` serves 237 g, `2 tbsp pb` serves 15 g).
 *   - `t` = teaspoon is the cookbook convention; Spanish `t` (taza) is not read.
 */

const CASE_SENSITIVE: Readonly<Record<string, string>> = {
  T: 'tbsp',
  'T.': 'tbsp',
  t: 'tsp',
  't.': 'tsp',
};

const CASE_INSENSITIVE: Readonly<Record<string, string>> = {
  c: 'cup',
  'c.': 'cup',
  tbs: 'tbsp',
  'tbs.': 'tbsp',
  tbl: 'tbsp',
  'tbl.': 'tbsp',
  tbls: 'tbsp',
  cn: 'can',
  cns: 'can',
  btl: 'bottle',
  btls: 'bottle',
};

const SPANISH_DE = new Set(['de', 'del']);
const BONE = new Set(['bone', 'bones']);

/** Every value the table can return; the test pins each as a known unit. */
export const UNIT_ABBREVIATION_TARGETS: readonly string[] = Array.from(
  new Set([...Object.values(CASE_SENSITIVE), ...Object.values(CASE_INSENSITIVE)]),
);

export function expandUnitAbbreviation(token: string, nextToken: string): string | null {
  const next = (nextToken ?? '').toLowerCase();
  if (SPANISH_DE.has(next)) return null;

  const cased = Object.prototype.hasOwnProperty.call(CASE_SENSITIVE, token)
    ? CASE_SENSITIVE[token]
    : null;
  if (cased) return BONE.has(next) ? null : cased;

  const lower = token.toLowerCase();
  return Object.prototype.hasOwnProperty.call(CASE_INSENSITIVE, lower)
    ? CASE_INSENSITIVE[lower]
    : null;
}
