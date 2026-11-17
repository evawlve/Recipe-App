/**
 * Count tags: `toast x2`, `chicken (x2 thighs)`, `2x string cheese`.
 *
 * MECHANISM. No code read an `x<N>` tag, so `toast x2` parsed as `{qty: 1, name: 'toast x2'}`:
 * the mapper keyed and retrieved on the tag and the bill was ONE unit. A leading glued `2x toast`
 * counted right (qty 2) but left the `x` in the name (`x string cheese`). resolveCountTag() rewrites
 * the tag into a LEADING COUNT, the shape the rest of the parser already reads:
 *   - leading `<N>x <word>` / `<N> x <word>`        -> `<N> <word>`        (`2x toast` -> `2 toast`)
 *   - `<head> (x<N> <noun...>)` at the end          -> `<N> <head> <noun...>`
 *   - `<head> (x<N>) [rest]`                        -> `<N> <head> [rest]`
 *   - `<head> x<N> [rest]` (standalone token)       -> `<N> <head> [rest]`  (`toast x2 w/ butter` -> `2 toast w/ butter`)
 * N is 1-2 digits and >= 1; `x`, `X` and `×` all match.
 *
 * It runs right after stripClockTime() (s453), the INNERMOST step of parseIngredientLine()'s first statement, so every strip after it
 * (hedge, approximator, definite frame, package multiplier, loose pour) sees an already-normal line.
 * That is safe only because the guards below decline every line those strips own.
 *
 * GUARDS (the line is returned unchanged). A first draft guarded "the line already opens with a
 * quantity" with a hand-written regex, which is a second number-word list ("the bug, not the design",
 * see QUANTITY_WORD_NUMBERS) and regressed 12 lines master parsed right or better: `⅓ bagel x2`
 * (q 2.333), `⅛ pizza x2`, `dozen eggs x2` (q 12 -> 2), `couple eggs x2`, `third/quarter bagel x2`,
 * `quarter pounder x2`, `about 2 eggs x2`, `the last 2 slices of pizza x2`, `the last 2 slices x2`,
 * and on the approximator stack `at least 2 wings x2`, `upwards of 3 beers x2`,
 * `at least a dozen wings x2`. So the OWNER decides what a quantity is:
 *   (a) the line opens with `a` / `an`, a digit, or a unicode fraction character;
 *   (b) parseQuantityTokens() reads the line's opening (couple, dozen, half, quarter, third, ...,
 *       and any word added there later, so the two cannot drift apart);
 *   (c) the first token is in HEDGE_OR_FRAME_LEAD (hedges, approximators, definite frames);
 *   (d) the text AFTER the tag holds a digit (`chicken x2 12 oz`, `eggs x2 and toast x2`);
 *   (e) the character before the tag is not a letter, `.` or `)` (so `ihop 2 x 2 x 2` stays);
 *   (f) a mass/volume unit follows N (`x2 cups`, `x2 oz`);
 *   (g) a pack/container word follows N (`coke x12 pack`, `water (x24 case)`): N is the PACK SIZE, not a
 *       count of the food (deploy-3 integration finding, MGR 2026-10-20T00:33Z); and a DRINKWARE/container word
 *       follows N (`wine x2 glasses`, `beer x2 cans`, `water x2 bottles`): rewriting would make the container the
 *       head noun (`2 wine glasses`), so the line keeps master's parse (cloud-40 F4, backend #587).
 * The leading `<N>x` rule is checked first and never matches when a digit follows the `x`, so
 * `2 x 200g`, `2x200g`, `2 x 15 oz cans`, `5x5 workout bar`, `9x13 pan` and `2 x 4` are untouched.
 * Collisions pinned as declined: `xbox`, `xo sauce`, `x2o water`, `2xl shirt`, `x2 cups`.
 * Pinned as ACCEPTED: `x2 daily` counts 2 (a diary line is one day), `2x protein` -> qty 2 name
 * `protein` (master already billed qty 2; only the stray `x` leaves the name).
 *
 * CALLERS. parseIngredientLine() has three callers, not two: the route's `items` loop,
 * preflightIngredientLine(), and computeNormalizedKey() in mapping/validated-mapping-helpers.ts,
 * which builds the AiNormalizeCache key. Raw tag lines keyed there (`avo toast x2`) become
 * unreachable and those keys move. That file's RULES_VERSION header says no bump is needed when a
 * change only MOVES keys away, so there is NO RULES_VERSION bump. FoodMapping is identity-only and
 * no key carries a tag (evict-keys: none).
 *
 * KNOWN MISSES (declined on purpose, no population): a trailing or parenthesised `<N>x` (`(2x)`,
 * `eggs (2x)`, `red bull 2x`); a tag followed by punctuation (`tacos x3!`); a leading-`x2` count (`at least x2 wings`).
 *
 * A LEADING DIGIT COUNT plus a TRAILING tag multiplies (multiplyLeadingCount(), 2026-10-25, Diego's default
 * 2026-10-21 item 12: `2 eggs x2` = 4 eggs). Before it, guard (a) declined the line and the tag reached the name:
 * `2 wings x2` -> qty 2, name `wings x2`; `3 eggs x2` -> qty 3, name `x2`. Live probe 2026-10-25T02:05Z (nosave, box
 * build 4-JWjeuJzQ1eMODVc-qA1): `2 eggs x2` billed ONE item `quantity 2, unit egg, 100 g`, foodName "Strong X2"
 * (off_8935024159965, an energy-drink packet, 440 kcal), because on the short-line path the mapper keys and searches
 * on parsed.name = `x2`. The branch runs AHEAD of guard (a) and fires only when ALL hold: the line opens with a DIGIT
 * integer count and a space (`^\s*\d+\s+`), the next token starts with a letter and is not a mass/volume unit
 * (`2 cups rice x2`, `12 oz steak x2`, `2 1/2 bagels x2` and `2 7up x2` decline), TAIL_X matches with NOTHING after
 * the tag, and N is 1-99. It rewrites the LEADING COUNT itself (`2 eggs x2` -> `4 eggs`), the representation every
 * other branch here uses, so the wire reads `quantity 4`; `multiplier` is never touched (the route's wire takes
 * parsed.qty, and a multiplier set this early disables unit parsing). Population (MEL "rawLine", 90 d, measured
 * 2026-10-25 with `~* '^\s*\d+\s.*\s[x×]\s?\d{1,2}\s*$'`): 2 events, 1 line, both the probe.
 *
 * s459 X2 replaced that string rewrite with splitTrailingCountTag(): parseIngredientLine() parses the HEAD and
 * multiplies its PARSED qty by N. s459 X2c widened its trigger from "a digit integer count, not a mass/volume unit"
 * to EVERY line opensWithOwnedQuantity() owns, plus the glued `<N>x` lead. Every line the owner parses keeps that
 * parse for its head, so the old reason to decline (a string rewrite mangling `dozen` or `⅓`; the 2026-10-19 draft's
 * 12 regressions) no longer applies. Before X2c these lines kept the tag in the NAME, and a name of `x2` retrieved
 * the energy drink "Strong X2" (off_8935024159965): `dozen eggs x2` billed 600 g / 2,640 kcal, `three eggs x2`
 * 660 kcal, `2x eggs x2` 440 kcal (cold probes, s459 rf-x2). A `<food> x2` name billed ONE portion (`200g chicken
 * x2` 200 g, `a banana x2` 118 g; s459 pd-x2c). Now `dozen eggs x2` = 24 eggs, `⅓ bagel x2` = ⅔ bagel,
 * `a banana x2` = 2 bananas, `at least 2 wings x2` = 4 wings, `200g chicken x2` = 400 g, `2 cups rice x2` = 4 cups.
 * The head parses on its own row: `quarter pounder x2` = 2 × `quarter pounder` (a fraction-word name, s461 QP-LEAD).
 *
 * STILL DECLINED: text after the tag (`2 toast x2 w/ butter`, `chicken x2 12 oz`); a fractional or 3-digit tag
 * (`2 eggs x2.5`, `toast x100`); N = 0.
 */
import { normalizeUnitToken } from './unit';
import { parseQuantityTokens } from './quantity';

/** `2x toast`, `2 x toast`: glued/spaced leading multiplier. A digit after the x never matches. */
const LEADING_GLUED_X = /^(\s*)(\d{1,2})\s*[x×]\s+(?=\p{L})/iu;
/** `chicken (x2 thighs)` */
const PAREN_X_NOUN = /^(\s*)(\S.*?[a-z])\s*\(\s*[x×]\s?(\d{1,2})\s+([a-z][^()]*?)\s*\)\s*$/i;
/** `eggs (x2)` / `eggs (x2) rest` */
const PAREN_X = /^(\s*)(\S.*?[a-z.)])\s*\(\s*[x×]\s?(\d{1,2})\s*\)\s*(.*)$/i;
/** `toast x2` / `toast x2 w/ butter` */
const TAIL_X = /^(\s*)(\S.*?[a-z.)])\s+[x×]\s?(\d{1,2})(?=\s|$)\s*(.*)$/i;

/** Fixed hedge / approximator / definite-frame openers: the strips downstream own these lines. */
const HEDGE_OR_FRAME_LEAD = new Set([
  'about', 'around', 'roughly', 'approximately', 'approx', 'nearly', 'almost', 'like', 'maybe',
  'some', 'just', 'only', 'over', 'under', 'at', 'upwards', 'close', 'slightly', 'the', 'my',
  'our', 'last', 'remaining', 'final', 'other',
]);

function massOrVolumeFollows(rest: string): boolean {
  const kind = normalizeUnitToken(rest.trim().split(/\s+/)[0] ?? '').kind;
  return kind === 'mass' || kind === 'volume';
}

/**
 * Guard (g): the word after N names a pack size (`x12 pack`), so N is not a count of the food; or it names the
 * drinkware/container the food came in (`wine x2 glasses`), which a rewrite would turn into the head noun.
 */
const PACK_WORD =
  /^(?:pack|packs|pk|pks|multipack|ct|count|case|cases|carton|cartons|box|boxes|tray|trays|glass|glasses|can|cans|bottle|bottles|mug|mugs|jar|jars|tin|tins)\b/i;
function packWordFollows(rest: string): boolean {
  return PACK_WORD.test(rest.trim());
}

/** True when the line already opens with a quantity, a hedge or a frame that another owner reads. */
function opensWithOwnedQuantity(line: string): boolean {
  if (/^\s*(?:a|an)\b/i.test(line)) return true;
  if (/^\s*[\d¼-¾⅐-⅞]/.test(line)) return true;
  const tokens = line.trim().split(/\s+/).map((t) => t.toLowerCase());
  if (HEDGE_OR_FRAME_LEAD.has(tokens[0] ?? '')) return true;
  return parseQuantityTokens(tokens) !== null;
}

/**
 * `<Q> <food> x<N>` with nothing after the tag -> `{ head: '<Q> <food>', n: N }` (header: "s459 X2 replaced that
 * string rewrite"). parseIngredientLine() parses the HEAD and multiplies the PARSED qty by N, so the parser, not this
 * file, decides what the leading quantity is (s459 X2): `2 shot latte x2` -> 2 x (`2 shot latte` = one 2-shot drink),
 * `7 up x2` -> 2 x (`7 up`), `2 eggs x2` -> 2 x (2 eggs) = 4 eggs as before. Folding N into the leading DIGIT string
 * (`4 shot latte`, `14 up`) let a downstream rule read the product as a size or a brand digit. Q is any lead
 * opensWithOwnedQuantity() owns (digits, units, fractions, `a`/`an`, quantity words, hedges and frames) or a glued
 * `<N>x` (s459 X2c): `dozen eggs x2` -> 2 x (`dozen eggs`), `200g chicken x2` -> 2 x (`200g chicken`). Returns null
 * when the line is not that shape, so the line falls through to resolveCountTag().
 */
export function splitTrailingCountTag(line: string): { head: string; n: number } | null {
  if (!LEADING_GLUED_X.test(line) && !opensWithOwnedQuantity(line)) return null;
  const m = TAIL_X.exec(line);
  if (!m || m[4] !== '') return null;
  const n = Number(m[3]);
  if (n < 1) return null;
  return { head: `${m[1]}${m[2]}`, n };
}

export function resolveCountTag(line: string): string {
  if (LEADING_GLUED_X.test(line)) return line.replace(LEADING_GLUED_X, '$1$2 ');
  if (opensWithOwnedQuantity(line)) return line;

  let m = PAREN_X_NOUN.exec(line);
  if (m) return Number(m[3]) >= 1 && !packWordFollows(m[4]) ? `${m[1]}${m[3]} ${m[2]} ${m[4]}` : line;

  m = PAREN_X.exec(line);
  if (m) {
    if (Number(m[3]) < 1 || /\d/.test(m[4]) || packWordFollows(m[4])) return line;
    return `${m[1]}${m[3]} ${m[2]}${m[4] ? ' ' + m[4] : ''}`;
  }

  m = TAIL_X.exec(line);
  if (m) {
    if (Number(m[3]) < 1 || /\d/.test(m[4]) || massOrVolumeFollows(m[4]) || packWordFollows(m[4])) return line;
    return `${m[1]}${m[3]} ${m[2]}${m[4] ? ' ' + m[4] : ''}`;
  }
  return line;
}
