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
 *   case-SENSITIVE:   `T` `T.` -> tbsp ; `t` `t.` `ts` `ts.` -> tsp ;
 *                     s461 ABBREV: `pt` `pt.` -> pint (lowercase only: `1 PT bar` stays)
 *   case-insensitive: `c` `c.` -> cup ; `tbs` `tbs.` `tbl` `tbl.` `tbls` -> tbsp ;
 *                     `cn` `cns` -> can ; `btl` `btls` -> bottle ;
 *                     `svg` `svg.` `svgs` -> serving ; `slc` `slc.` `slcs` -> slice ;
 *                     `bx` `bxs` -> box ; `pkg` `pkg.` `pkgs` -> package ;
 *                     `pkt` `pkts` -> packet ; `ctn` `ctns` -> carton ;
 *                     `pc` `pc.` `pcs` `pcs.` -> piece (s459 QW) ;
 *                     s461 ABBREV: `tb` `tb.` `tblsp` `tblsp.` -> tbsp ; `ozs` -> oz ;
 *                     `floz.` (`fl oz.` after the compound merge) -> floz ;
 *                     `qt.` `qts` -> quart (NOT bare `qt`: QT is QuikTrip) ; `gal` `gal.` `gals` -> gallon
 * Every target is a non-`unknown` normalizeUnitToken() key (pinned in the test,
 * so the two lists cannot drift apart).
 *
 * GUARDS (the caller supplies the first two; this function owns the third):
 *   1. an explicit quantity precedes the token (`vitamin c gummies`, `c popcorn`),
 *      or (s461 ABBREV, expandLeadingAbbreviation() below) the line opens with
 *      only article / fraction words before it (`half a t butter`), and after a
 *      bare article only when `of` follows the token (`a T of honey`; `a T shirt` stays)
 *   2. a WORD token follows it (`1 c` alone is unchanged; the name is never emptied)
 *   3. decline when the follower is `de`/`del` (Spanish `2 c de aceite` means
 *      cucharada, and `t` there would be taza) and, for `T`/`t` only, when it is
 *      `bone`/`bones` (`1 T bone steak`).
 * `1 t-bone steak`, `2 c4 energy drinks`, `1 C&H sugar`, `1 cnt eggs` never match
 * because the whole token must equal a table key.
 *
 * KNOWN COSTS (not fixed here):
 *   - TWO call sites (the explicit quantity, and the leading article / fraction
 *     words). These shapes stay unexpanded: `1/2 c and 1 T` (compound
 *     continuation), `about a T of honey` (a hedge before the article), `1 (15 oz) cn beans`,
 *     `2 c 2% milk` and `1 c (8 oz) milk` (the next token is not a word),
 *     `1/2c`, `½c`.
 *   - After a FRACTION word no `of` is needed (`half a t butter`), so `half a c note`,
 *     `half a gal pal`, `half a c and h sugar` and `half a pt bar` read the letter as a
 *     unit, and `pt` after any quantity is a pint (`1 pt ww bar`, `1 pt reyes blue cheese`).
 *     0 corpus lines each (s461 rf-abbrev).
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
  ts: 'tsp',
  'ts.': 'tsp',
  pt: 'pint',
  'pt.': 'pint',
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
  svg: 'serving',
  'svg.': 'serving',
  svgs: 'serving',
  slc: 'slice',
  'slc.': 'slice',
  slcs: 'slice',
  bx: 'box',
  bxs: 'box',
  pkg: 'package',
  'pkg.': 'package',
  pkgs: 'package',
  pkt: 'packet',
  pkts: 'packet',
  ctn: 'carton',
  ctns: 'carton',
  // s459 QW: `10 pc chicken mcnuggets`, `3 pcs fried chicken`, `8pc wings`. Without this the token
  // stayed in the NAME and the search query, where it pulled records whose name carries a piece
  // count (`3 pcs fried chicken` -> "Fried Chicken 4 Pcs Our Choice", 2,325 g / 4,650 kcal cold).
  pc: 'piece',
  'pc.': 'piece',
  pcs: 'piece',
  'pcs.': 'piece',
  // s461 ABBREV. NOT `pts` (points: `under 5 pts`), NOT `pk` (`12 pk coke` is a 12-pack, not 12 packages),
  // NOT `ea` (each: no unit), NOT `sm`/`med`/`lg` (size words: `1 med rare steak`), NOT `sl` (`2 sl cheddar` would bill
  // its twin `2 slices cheddar`, 34 g cold, where today's label hit bills 56 g: s461 pd-abbrev O02), NOT bare `qt` (QT is
  // QuikTrip, and brand initialisms are typed lowercase (`kfc`): `1 QT hot dog` bills one 57 g hot dog today, its twin
  // `1 quart hot dog` 473 g / 1,136 kcal, `2 QT taquitos` 204 g -> 946 g: s461 rf-abbrev). `qt.` and `qts` are not the brand.
  tb: 'tbsp',
  'tb.': 'tbsp',
  tblsp: 'tbsp',
  'tblsp.': 'tbsp',
  ozs: 'oz',
  'floz.': 'floz',
  'qt.': 'quart',
  qts: 'quart',
  gal: 'gallon',
  'gal.': 'gallon',
  gals: 'gallon',
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

/**
 * s461 ABBREV: the second call site. `half a t butter`, `a T of honey`, `a quarter c walnuts` carry no
 * explicit quantity token (parseQuantityTokens() never consumed one), so guard 1 at the first call site
 * declined and the letter stayed in the name. When the line opens with ONLY article / fraction words
 * (LEAD_WORDS) and the next token is a table key followed by a word, rewrite that token in place, before
 * parseIngredientLine()'s fraction and article rewrites run, so they read the line as its spelled-out twin
 * (`half a tsp butter`). Guards 2 and 3 are the first call site's (a word follows; de/del, T/t bone). When
 * the prefix holds no fraction word (a bare `a`/`an`), the follower must be `of`, the same rule the article
 * strip applies to a count measure (`a c of milk` moves; `a c note`, `a T shirt`, `a gal pal`, `a c and h
 * sugar`, `a c rice` stay). `a t bone steak` and `a c4 drink` stay.
 */
const LEAD_WORDS = new Set(['a', 'an', 'half', 'quarter']);
const FRACTION_WORDS = new Set(['half', 'quarter']);

export function expandLeadingAbbreviation(tokens: string[]): void {
  let k = 0;
  let fraction = false;
  while (k < tokens.length && LEAD_WORDS.has(tokens[k].toLowerCase())) fraction = FRACTION_WORDS.has(tokens[k++].toLowerCase()) || fraction;
  if (k === 0 || k + 1 >= tokens.length || !/^[a-z]/i.test(tokens[k + 1])) return;
  if (!fraction && tokens[k + 1].toLowerCase() !== 'of') return;
  const expanded = expandUnitAbbreviation(tokens[k], tokens[k + 1]);
  if (expanded) tokens[k] = expanded;
}
