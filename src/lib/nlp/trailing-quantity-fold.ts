/**
 * trailing-quantity-fold.ts - a trailing quantity clause folds into the item it quantifies.
 *
 * MECHANISM. A user writes the quantity of a food AFTER the food, in its own clause
 * ("the leftover tuna salad, maybe a cup"). The segmenter then either
 *   A. emits the clause as its OWN segment (`maybe a cup`, `half`, `two bowls`) - the mapper
 *      mints a nonsense food (or an AI-nutrition guess) for the clause text;
 *   B. emits a RESTATING segment (a count plus a food token already named: `two eggs` after
 *      `scrambled eggs`, `two muffins` after `a muffin`) - a second, duplicate item; or
 *   C. DROPS the clause (`maybe four`, `two of them`) - the food is billed at its default
 *      quantity and the user's number vanishes.
 * Shapes A and B are folded by the SEGMENT fold, shape C by the GAP fold (the clause is
 * found in the text between two items' spans). Either way the quantity is written onto the
 * item it belongs to as a canonical prefix (`1 cup of leftover tuna salad`, `1/2 chicken tikka
 * masala`), which parseIngredientLine() already understands.
 *
 * FALSE-POSITIVE CLASS. `half and half` is a real food: the grammar never parses it (a half
 * NUM is not followed by FRAC, and a FOOD may not start with a conjunction). Every other
 * guard (the target has no quantity of its own, shares a head noun with the clause, or is
 * alone in its comma piece) exists to keep `two cookies` after `a turkey sandwich` apart.
 *
 * PARTIAL EAT (S240, MGR route 4, default taken). The segmenter also DROPS a partial-eat clause
 * (`a sandwich, i gave half to my friend` -> [a sandwich]) and the item bills in full. MGR's five
 * phrases scale the item they follow: `gave half` / `shared half` x1/2, `left most` x1/4, `left some`
 * x3/4, `ate the top only` x1/2 (leads i/we/and/but/then/so/just/also skipped). The target must read
 * `a|an|one X` with no stated amount, and the scaled text (`1/2 sandwich`) must parse to the SAME unit
 * at exactly factor x the original quantity, else nothing fires. A clause that names a food must
 * covers() the owner; a clause naming none fires only on a ONE-item line. Fold kind `partial`.
 * Named misses: phrases outside the table, multi-item lines with an unnamed clause, a clause the
 * segmenter emits as its own item, stated-amount targets (`two slices of pizza, i gave half away`),
 * short comma-less lines (fast path).
 *
 * STOCK (S240, MGR reserve R1+R3). A consumption clause after a STOCK item - one that states its own amount and so
 * fails isValidTarget() - bills what was consumed, not the stock. Two shapes: scaleStock() (a pure fraction scales the
 * stock: `a 2 lb bag of baby carrots, i ate about a quarter` -> 0.5 lb) and replaceStock() (a consumed COUNT replaces
 * it: `1 doz eggs for the week, ate 2` -> `2 eggs`). scaleStock() fires only for STOCK_UNITS (measures and single
 * containers, not pack / case / carton / dozen / size words), and the scaled text must parse to the SAME unit at exactly
 * f x the original qty; never an addition (`and a half`). replaceStock() guards: a user-subject consumption verb
 * (ate / had / drank / eaten / finished), a COUNT stock for a unitless count (never a size or weight stock), the count
 * capped by a known stock count, normalizedForm free of digits / units / containers, the result parsing back to the
 * count, and `left` / `remaining` / `over` leftovers refused. The fraction words (quarter / third / fourth, three
 * quarters, two thirds) parse only under the opt-in `parseClause(t, { fractions: true })`, as a PURE fraction; no other
 * caller passes it, so self-correction is byte-unchanged. Fold kind `stock`. Named misses: food-named counts
 * (`ate 20 chips` in some shapes), `the kids ate 4`, word-number stocks (`two bags`), size stocks.
 * On a one-item line a stock whose clause the plain reader cannot parse (`drank half`, `finished 2`, `eaten 2`) is still
 * re-counted / scaled through the consumed-count reading; a valid target is never rewritten that way (S240, cloud-38 D7).
 * Named misses: `i've eaten 2`, a trailing time word (`drank half last night`).
 *
 * DOSE (S240, MGR 16:36Z). The segmenter emits the food-less dose of a protein shake (`two scoops`, `2 scoops`, or
 * `two scoops in milk`) as its own item and the mapper invents a food for `scoops` (a phantom strawberry record). Only a
 * PROTEIN shake (protein / whey / casein + shake|shakes; smoothies are out, their fruit would vanish) directly followed by
 * `with <count> scoop(s)` fires, and it becomes `<n> scoop(s) of protein powder` with normalizedForm `protein powder`:
 * the ready-to-drink shake record that `2 scoops of protein shake` retrieves bills 18-36 kcal where powder bills ~260.
 * LIQUID REMAINDER: an `in <liquid>` tail (milk / water / juice, with milk modifiers, bare or measured `8 oz of milk`)
 * stays its own item (rawText = the remainder, normalizedForm = the liquid's own words, never `scoops in milk`) and later
 * folds read it; a non-food tail (`it`, `total`, `a shaker bottle`, `the morning`) is removed with the dose; any other tail
 * (`my oatmeal`, `milk and a banana`) means no fire. NON-FIRES: every other host (sundae, coffee + packets, rice +
 * servings, a plain shake), a host that already states a quantity, a host that is itself a `with` part (`a protein shake
 * with milk with 2 scoops`), a dose naming a food. Fold kind `dose`. Named miss: `... in milk, 1 cup` leaves `1 cup`
 * (the milk shares the shake's comma piece).
 *
 * NO prompt edit, NO version bump: the SegmentationCache stores the UNFOLDED split; the fold
 * reads `lineKey` (canonicalizeSegLine(text)) so one cached split folds one way for every
 * case/punctuation variant that shares its key. Pure; imports only parseIngredientLine;
 * never mutates its input.
 */

import { parseIngredientLine } from '@/lib/parse/ingredient-line';
import { splitLeadingPour } from '@/lib/parse/loose-measures';

export interface TrailingQuantityFold {
  kind: 'segment' | 'gap' | 'partial' | 'stock' | 'dose';
  /** Index of the folded-into item in the ORIGINAL input array. */
  targetIndex: number;
  /** The clause text (a segment's rawText, or the gap piece's tokens). */
  clause: string;
  before: string;
  after: string;
}

interface Item {
  rawText: string;
  normalizedForm?: string;
  brand?: string;
}

export interface Clause {
  value: number;
  unit: string | null;
  food: string[];
  /** S240 R3: set when the value came from a fraction WORD (quarter / third / fourth) read under `fractions`. */
  fractionWord?: string;
}

const LEAD = new Set([
  'and', 'then', 'plus', 'but', 'i', 'we', 'had', 'ate', 'only', 'just', 'maybe', 'about', 'around', 'like',
  'roughly', 'approximately', 'approx', 'probably', 'almost', 'nearly', 'more', 'less', 'at', 'least', 'most',
]);
const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const SIZE = new Set(['big', 'small', 'large', 'little', 'full', 'whole', 'heaping', 'level', 'medium', 'generous', 'huge']);
const UNITS = new Set([
  'cup', 'bowl', 'piece', 'slice', 'serving', 'helping', 'plate', 'plateful', 'handful', 'scoop', 'tbsp', 'tsp',
  'tablespoon', 'teaspoon', 'oz', 'ounce', 'gram', 'g', 'ml', 'container', 'portion', 'glass', 'mug', 'can',
  'bottle', 'bag', 'box', 'packet', 'spoonful', 'pint', 'quart', 'liter',
]);
const TAILOF_WORDS = new Set(['them', 'those', 'these', 'it', 'that']);
const TAIL_SINGLE = new Set(['too', 'total', 'ish', 'worth']);
const NEGATION = new Set(['no', 'not', 'nope', 'wait', 'sorry', 'actually', 'scratch', 'that', 'instead']);
const PROTEIN_WORDS = new Set(['protein', 'whey', 'casein']);
// A liquid a protein shake is mixed IN (the `in <liquid>` remainder survives only as one of these).
const LIQUID_MODS = new Set(['almond', 'oat', 'skim', 'whole', 'soy', 'coconut', 'cashew', 'lactose', 'free', 'fat', 'nonfat', '2', '1', 'percent', 'low', 'unsweetened', 'vanilla', 'chocolate']);
const REST_NONFOOD = new Set(['it', 'total', 'a', 'an', 'one', 'shaker', 'bottle', 'cup', 'glass', 'blender', 'morning', 'afternoon', 'evening', 'night', 'gym', 'car', 'all']);
function isLiquid(w: string[]): boolean {
  const last = w[w.length - 1];
  if (!['milk', 'water', 'juice'].includes(last) || w.length > 3) return false;
  return w.slice(0, -1).every(x => LIQUID_MODS.has(x) || (last === 'juice' && ['orange', 'apple'].includes(x)));
}
const FRACTION_WORDS: Record<string, number> = { quarter: 0.25, fourth: 0.25, third: 1 / 3 };
const QTY_WORDS = new Set([...Object.keys(NUM_WORDS), 'half', 'couple', 'dozen', 'few', 'several']);
const HEAD_STOP = new Set(['with', 'and', 'in', 'on', 'over', 'topped', 'plus']);
const FOOD_BAD_START = new Set(['and', 'or', 'with', 'plus', 'then', 'but', 'of']);
const CONNECTORS = new Set(['and', 'then', 'plus', 'but']);
const MEAL_WORDS = new Set(['breakfast', 'brunch', 'lunch', 'dinner', 'supper', 'snack', 'snacks']);
const FRAME_WORDS = new Set(['for', 'at', 'as']);

function isUnit(tok: string | undefined): boolean {
  if (!tok) return false;
  if (UNITS.has(tok)) return true;
  if (tok.endsWith('es') && UNITS.has(tok.slice(0, -2))) return true;
  return tok.endsWith('s') && UNITS.has(tok.slice(0, -1));
}

/** Words that carry no food identity: used for the "has a content token" rule. */
function isGrammarWord(tok: string): boolean {
  return (
    LEAD.has(tok) || NEGATION.has(tok) || SIZE.has(tok) || isUnit(tok) || QTY_WORDS.has(tok) ||
    TAIL_SINGLE.has(tok) || TAILOF_WORDS.has(tok) ||
    ['a', 'an', 'the', 'of', 'or', 'so', 'in', 'some'].includes(tok) || /^[\d./]+$/.test(tok)
  );
}

/** Lowercase words; `.!?` and all punctuation dropped except `/` and `.` inside numbers and `'` inside words. */
export function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/(?<!\d)\/|\/(?!\d)/g, ' ')
    .replace(/[^a-z0-9'/.\s]/g, ' ')
    .replace(/(?<![a-z0-9])'|'(?![a-z0-9])/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export interface Tok { w: string; piece: number }

export function tokenizeWithPieces(s: string): Tok[] {
  const out: Tok[] = [];
  s.split(/[,;]/).forEach((piece, p) => {
    for (const w of words(piece)) out.push({ w, piece: p });
  });
  return out;
}

export function sameWord(x: string, y: string): boolean {
  return x === y || x + 's' === y || y + 's' === x || x + 'es' === y || y + 'es' === x;
}

function parseNumeric(w: string): number | null {
  if (/^\d+(\.\d+)?$/.test(w)) return Number(w);
  const m = /^(\d+)\/(\d+)$/.exec(w);
  if (m && Number(m[2]) > 0) return Number(m[1]) / Number(m[2]);
  return null;
}

/** Parses a whole token list as a clause, or returns null. */
/**
 * `opts.fractions` (S240, MGR reserve R3; only the fold's stock path passes it): also read `a|one quarter|fourth|third`,
 * `three quarters|fourths`, `two thirds` - as a PURE fraction only (nothing after it but `of it|them|that|this`), never with a
 * unit or a food, so `a quarter pounder` / `a third glass` stay what they were. Every other caller (self-correction) is unchanged.
 */
export function parseClause(t: string[], opts: { fractions?: boolean } = {}): Clause | null {
  const n = t.length;
  let i = 0;
  while (i < n && LEAD.has(t[i])) i++;
  if (i >= n) return null;

  let value: number;
  let half = false;
  const w = t[i];
  const numeric = parseNumeric(w);
  if (opts.fractions) {
    let fv: number | undefined;
    let fw: string | undefined;
    let k = i;
    if ((w === 'a' || w === 'one') && FRACTION_WORDS[t[i + 1]] !== undefined) { fv = FRACTION_WORDS[t[i + 1]]; fw = t[i + 1]; k = i + 2; }
    else if (w === 'three' && (t[i + 1] === 'quarters' || t[i + 1] === 'fourths')) { fv = 0.75; fw = t[i + 1]; k = i + 2; }
    else if (w === 'two' && t[i + 1] === 'thirds') { fv = 2 / 3; fw = 'thirds'; k = i + 2; }
    if (fv !== undefined) {
      const rest = t.slice(k);
      const pure = rest.length === 0 || (rest.length === 2 && rest[0] === 'of' && TAILOF_WORDS.has(rest[1]));
      return pure ? { value: fv, unit: null, food: [], fractionWord: fw } : null;
    }
  }
  if (numeric !== null) { value = numeric; i++; }
  else if (NUM_WORDS[w] !== undefined) { value = NUM_WORDS[w]; i++; }
  else if (w === 'half') { value = 0.5; half = true; i++; }
  else if (w === 'a' && t[i + 1] === 'half') { value = 0.5; half = true; i += 2; }
  else if (w === 'a' && t[i + 1] === 'couple') { value = 2; i += 2; }
  else if (w === 'a' && t[i + 1] === 'dozen') { value = 12; i += 2; }
  else if (w === 'dozen') { value = 12; i++; }
  else if (w === 'a' || w === 'an') {
    let k = i + 1;
    if (SIZE.has(t[k])) k++;
    if (!isUnit(t[k])) return null;
    value = 1;
    i++;
  } else return null;

  if (!half) {
    if (t[i] === 'and' && t[i + 1] === 'a' && t[i + 2] === 'half') { value += 0.5; i += 3; }
    else if (t[i] === 'and' && t[i + 1] === 'half') { value += 0.5; i += 2; }
    else if (t[i] === 'or' && (t[i + 1] === 'two' || t[i + 1] === 'so')) i += 2;
    else if (t[i] === 'ish') i++;
  } else {
    if (t[i] === 'of' && t[i + 1] === 'the') i += 2;
    else if (t[i] === 'the' || t[i] === 'a' || t[i] === 'an') i++;
  }

  if (SIZE.has(t[i]) && isUnit(t[i + 1])) i++;
  let unit: string | null = null;
  if (isUnit(t[i])) {
    unit = t[i];
    i++;
    if (!half && t[i] === 'and' && t[i + 1] === 'a' && t[i + 2] === 'half') { value += 0.5; i += 3; }
  }

  // TAIL* is stripped from the end of what is left.
  let rest = t.slice(i);
  for (;;) {
    const L = rest.length;
    if (L >= 2 && rest[L - 2] === 'in' && rest[L - 1] === 'total') rest = rest.slice(0, L - 2);
    else if (L >= 2 && rest[L - 2] === 'or' && rest[L - 1] === 'so') rest = rest.slice(0, L - 2);
    else if (L >= 1 && TAIL_SINGLE.has(rest[L - 1])) rest = rest.slice(0, L - 1);
    else break;
  }

  let food: string[];
  if (rest[0] === 'of' && TAILOF_WORDS.has(rest[1])) {
    if (rest.length !== 2) return null;
    food = [];
  } else if (rest[0] === 'of') {
    food = rest.slice(rest[1] === 'the' ? 2 : 1);
    if (food.length === 0) return null;
  } else {
    food = rest;
  }
  if (food.length > 0 && FOOD_BAD_START.has(food[0])) return null;
  if (food.includes('each')) return null;
  return { value, unit, food };
}

function formatValue(v: number): string {
  return FRACTION_TEXT.find(([x]) => Math.abs(x - v) < 1e-9)?.[1] ?? String(v);
}
const FRACTION_TEXT: Array<[number, string]> = [[0.5, '1/2'], [0.25, '1/4'], [0.75, '3/4'], [1 / 3, '1/3'], [2 / 3, '2/3']];

function headOf(item: Item): string | null {
  const src = item.normalizedForm && item.normalizedForm.trim()
    ? item.normalizedForm
    : item.rawText.replace(/^\s*(the|a|an|some)\s+/i, '');
  const phrase: string[] = [];
  for (const w of words(src.split(/[,;]/)[0])) {
    if (HEAD_STOP.has(w)) break;
    phrase.push(w);
  }
  return phrase.length ? phrase[phrase.length - 1] : null;
}

function covers(item: Item, food: string[]): boolean {
  const head = headOf(item);
  if (!head || !food.some(f => sameWord(f, head))) return false;
  const have = [...words(item.rawText), ...words(item.normalizedForm ?? '')];
  return food.every(f => have.some(x => sameWord(f, x)));
}

/** A target must carry no quantity of its own and at least one content token. */
function isValidTarget(item: Item): boolean {
  const toks = words(item.rawText);
  if (/\d/.test(item.rawText)) return false;
  if (toks.some(x => QTY_WORDS.has(x))) return false;
  try {
    const parsed = parseIngredientLine(item.rawText);
    // A leading pour (`a swig of soda`) parses to a floz unit that is the parser's canonicalisation,
    // not a quantity the user stated, so it stays a valid target.
    if (parsed && parsed.unit && !splitLeadingPour(item.rawText)) return false;
  } catch {
    return false;
  }
  return toks.some(x => !isGrammarWord(x));
}

function rewrite(item: Item, clause: Clause): string {
  const pour = splitLeadingPour(item.rawText);
  if (pour) {
    // The stated clause unit wins; with none, keep the pour word so the parser canonicalises it.
    return clause.unit
      ? `${formatValue(clause.value)} ${clause.unit} of ${pour.rest}`
      : `${formatValue(clause.value)} ${pour.word} of ${pour.rest}`;
  }
  const food = item.rawText.replace(/^\s*(a|an|the|some)\s+/i, '').trim();
  return clause.unit
    ? `${formatValue(clause.value)} ${clause.unit} of ${food}`
    : `${formatValue(clause.value)} ${food}`;
}

// S240 (MGR route 4, 2026-10-19; default taken, organic 0): a PARTIAL-EAT clause the segmenter drops
// (`a sandwich, i gave half to my friend`) scales the ONE item it follows instead of vanishing. MGR's table only:
// gave half, shared half x1/2; left most x1/4; ate the top only x1/2; left some x3/4.
const PE_LEAD = new Set(['i', 'we', 'and', 'but', 'then', 'so', 'just', 'also']);
const PE_STOP = new Set(['to', 'with', 'for', 'away', 'because', 'cause', 'since', 'and', 'but', 'so', 'in', 'on', 'at']);
const PE_IT = new Set(['it', 'that', 'them', 'this']);

export interface PartialEat {
  factor: number;
  /** A food the clause names (`gave half the sandwich`), [] when it names none. */
  food: string[];
}

function foodAfter(rest: string[]): string[] | null {
  let k = 0;
  if (rest[k] === 'of') k++;
  if (PE_IT.has(rest[k] ?? '')) return [];
  if (rest[k] === 'the' || rest[k] === 'my') k++;
  const food: string[] = [];
  for (; k < rest.length && !PE_STOP.has(rest[k]); k++) food.push(rest[k]);
  return food.length > 3 ? null : food;
}

/** A dropped partial-eat clause and its factor, or null. MGR's five phrases, nothing else. */
export function parsePartialEat(group: string[]): PartialEat | null {
  let g = group;
  while (g.length && PE_LEAD.has(g[0])) g = g.slice(1);
  const at = (k: number) => g[k] ?? '';
  let factor: number;
  let rest: string[];
  if ((at(0) === 'gave' || at(0) === 'shared') && at(1) === 'half') { factor = 0.5; rest = g.slice(2); }
  else if (at(0) === 'left' && at(1) === 'most') { factor = 0.25; rest = g.slice(2); }
  else if (at(0) === 'left' && at(1) === 'some') { factor = 0.75; rest = g.slice(2); }
  else if (at(0) === 'ate' && at(1) === 'the' && at(2) === 'top' && at(3) === 'only') { factor = 0.5; rest = g.slice(4); }
  else return null;
  // `shared half and half` is the creamer, not a half.
  if (rest[0] === 'and' && rest[1] === 'half') return null;
  const food = foodAfter(rest);
  return food === null ? null : { factor, food };
}

const PE_FRAC: Record<number, string> = { 0.25: '1/4', 0.5: '1/2', 0.75: '3/4' };

/**
 * `a|an|one X` scaled by `factor`, or null. Null when X states an amount of its own (`a dozen wings`, `a 12 oz
 * steak`, `a couple of tacos`), when the target is not article-led (`chips` - a bare plural would leave its serving
 * rung), and when the scaled text does not parse to the SAME unit at exactly factor x the original quantity
 * (`a glass of wine` parses unitless, `3/4 glass of wine` parses a glass).
 */
function scaleByFactor(item: Item, factor: number): string | null {
  const raw = item.rawText.trim();
  const m = /^(?:a|an|one)\s+(.+)$/i.exec(raw);
  if (!m) return null;
  if (/\d/.test(m[1]) || words(m[1]).some(x => QTY_WORDS.has(x))) return null;
  const scaled = `${PE_FRAC[factor]} ${m[1]}`;
  try {
    const before = parseIngredientLine(raw);
    const after = parseIngredientLine(scaled);
    if (!before || !after) return null;
    if ((before.unit ?? null) !== (after.unit ?? null)) return null;
    if (Math.abs(after.qty * after.multiplier - factor * before.qty * before.multiplier) > 1e-9) return null;
  } catch {
    return null;
  }
  return scaled;
}

// S240 (MGR reserve R3): the units a fraction of a STOCK item may scale - measures and single containers. NOT pack / case /
// carton / dozen (`a 6 pack of beer` bills one serving; `3 pack` would be three packs) and NOT size words (large / medium).
const STOCK_UNITS = new Set([
  'oz', 'lb', 'g', 'kg', 'ml', 'l', 'liter', 'cup', 'pint', 'quart', 'gallon', 'tbsp', 'tsp', 'bag', 'can', 'bottle', 'box',
  'jar', 'container', 'tub', 'bowl', 'plate',
]);
const ORDINAL_CUE = new Set(['first', 'second', 'another', 'again', 'next']);

/**
 * S240 (MGR reserve R3): a PURE fraction clause (`ate half`, `about a quarter`) over a STOCK item that states its own amount
 * (`a bag of chips`, `a pint of ice cream`, `a 2 lb bag of baby carrots`) scales that amount: `a|an|one <unit> of X` ->
 * `<frac> <unit> of X`; `[a] <n> <unit> ...` -> `<n*f> <unit> ...`. The scaled text must parse to the SAME unit, in STOCK_UNITS,
 * at exactly f x the original qty (`a 12 inch sub`, `a 6 pack of beer` never scale). Else null.
 */
function scaleStock(item: Item, f: number): string | null {
  const raw = item.rawText.trim();
  let scaled: string | null = null;
  let orig = raw;
  const art = /^(?:a|an|one)\s+(.+)$/i.exec(raw);
  const num = /^(?:(?:a|an|one)\s+)?(\d+(?:\.\d+)?)\s+(.+)$/i.exec(raw);
  if (num) {
    orig = `${num[1]} ${num[2]}`;
    const v = Number(num[1]) * f;
    scaled = `${Number.isInteger(v) ? v : Math.round(v * 1000) / 1000} ${num[2]}`;
  } else if (art && !words(art[1]).some(x => QTY_WORDS.has(x))) {
    scaled = `${formatValue(f)} ${art[1]}`;
  }
  if (!scaled) return null;
  try {
    const before = parseIngredientLine(orig);
    const after = parseIngredientLine(scaled);
    if (!before || !after || !before.unit || before.unit !== after.unit || !STOCK_UNITS.has(before.unit)) return null;
    if (Math.abs(after.qty * after.multiplier - f * before.qty * before.multiplier) > 1e-6) return null;
  } catch {
    return null;
  }
  return scaled;
}

const isPureFraction = (c: Clause): boolean => c.value < 1 && c.unit === null && c.food.length === 0;

// S240 (MGR reserve R1): `1 doz eggs for the week, ate 2` - a COUNT the user says THEY consumed, after a STOCK item that
// states its own amount, is what they ate; the stock is not. Read only in the stock paths below (LEAD is unchanged).
const CONSUME = new Set(['ate', 'had', 'drank', 'eaten', 'finished']);
const SUBJECT_OK = new Set(['i', 'we', 'and', 'then', 'so', 'just', 'only', 'also']);
// A unitless count re-counts only a COUNT stock - never a size or a weight/volume stock (`a large pizza, had 3`).
const COUNT_STOCK = new Set(['dozen', 'doz', 'pack', 'box', 'bag', 'carton', 'case', 'sleeve', 'package', 'tray', 'packet']);
const STOCK_FORM_BAD = new Set([...COUNT_STOCK, ...STOCK_UNITS, 'large', 'medium', 'small', 'half', 'whole']);

/** The clause tokens with a user-subject consumption lead stripped (`i ate 2` -> `2`), or null when no such lead. */
function consumedTokens(t: string[]): string[] | null {
  let i = 0;
  while (i < t.length && SUBJECT_OK.has(t[i])) i++;
  if (!CONSUME.has(t[i] ?? '')) return null;
  return t.slice(i + 1);
}

/** The stock item replaced by the consumed count (`2 eggs`, `3 slices of pizza`), or null. */
function replaceStock(item: Item, c: Clause): string | null {
  if (!(c.value >= 1 && Number.isInteger(c.value) && c.food.length === 0)) return null;
  const food = (item.normalizedForm ?? '').trim();
  const fw = words(food);
  if (!food || /\d/.test(food) || fw.some(x => STOCK_FORM_BAD.has(x) || QTY_WORDS.has(x) || isUnit(x))) return null;
  const rw = words(item.rawText);
  let stockCount: number | null = null;
  try {
    const p = parseIngredientLine(item.rawText.replace(/^\s*(a|an|one)\s+/i, '1 '));
    if (p && !p.unit) stockCount = p.qty * p.multiplier;
  } catch { /* no cap */ }
  if (!c.unit) {
    // a unitless count needs a COUNT stock
    if (!rw.some(x => COUNT_STOCK.has(x)) && !(stockCount !== null && stockCount > 1)) return null;
  } else if (['large', 'medium', 'small'].includes(c.unit)) {
    return null;
  }
  if (rw.includes('dozen') || rw.includes('doz')) stockCount = 12 * (stockCount && stockCount > 1 && stockCount < 12 ? stockCount : 1);
  const m = /(\d+)\s*pack\b/.exec(item.rawText.toLowerCase());
  if (m) stockCount = Number(m[1]);
  if (stockCount !== null && stockCount > 1 && c.value > stockCount) return null;
  const out = c.unit ? `${c.value} ${c.unit} of ${food}` : `${c.value} ${food}`;
  try {
    const q = parseIngredientLine(out);
    if (!q || Math.abs(q.qty * q.multiplier - c.value) > 1e-9) return null;
  } catch {
    return null;
  }
  return out;
}


export function foldTrailingQuantityClauses<T extends Item>(
  lineKey: string,
  items: T[],
): { items: T[]; folds: TrailingQuantityFold[] } {
  const n = items.length;
  const folds: TrailingQuantityFold[] = [];
  if (n === 0) return { items: items.slice(), folds };

  const toks = tokenizeWithPieces(lineKey);
  // Spans over the ORIGINAL items, left to right.
  const spans: Array<{ start: number; end: number } | null> = [];
  let cursor = 0;
  for (const it of items) {
    const w = words(it.rawText);
    let found: { start: number; end: number } | null = null;
    if (w.length > 0) {
      for (let s = cursor; s + w.length <= toks.length; s++) {
        let ok = true;
        for (let k = 0; k < w.length; k++) {
          if (toks[s + k].w !== w[k]) { ok = false; break; }
        }
        if (ok) { found = { start: s, end: s + w.length }; break; }
      }
    }
    spans.push(found);
    if (found) cursor = found.end;
  }

  const removed = new Set<number>();
  const folded = new Map<number, string>();
  const dose = new Map<number, string>();
  const doseNf = new Map<number, string>();

  const aloneInPiece = (t: number, also?: number): boolean => {
    const sp = spans[t];
    if (!sp) return false;
    const piece = toks[sp.start].piece;
    for (let k = 0; k < n; k++) {
      if (k === t || k === also || removed.has(k)) continue;
      const o = spans[k];
      if (o && toks[o.start].piece === piece) return false;
    }
    return true;
  };

  // S240 (MGR 16:36Z, C70 flag 3): `a protein shake with two scoops in milk` - the segmenter emits the food-less dose (`two scoops`,
  // `2 scoops`, `two scoops in milk`) as its own item and the mapper invents a food for `scoops`. A PROTEIN shake (protein / whey /
  // casein + shake) right before `with <count> scoop(s)` is that many scoops of protein POWDER (measured: `2 scoops of protein shake`
  // retrieves a ready-to-drink shake and bills 18-36 kcal; protein powder bills ~260). An `in <liquid>` remainder stays its own item
  // (rawText AND normalizedForm = the liquid); any other remainder (`in total`, `in a shaker`) goes. Every other host is unchanged, and
  // a host that is itself a `with` part (`a protein shake with milk with 2 scoops`) never fires.
  for (let j = 1; j < n; j++) {
    const h = j - 1;
    const sh = spans[h];
    const sj = spans[j];
    if (!sh || !sj || removed.has(h) || folded.has(h)) continue;
    const gapW = toks.slice(sh.end, sj.start).map(x => x.w);
    if (gapW.length !== 1 || gapW[0] !== 'with') continue;
    if (toks[sh.start - 1]?.w === 'with' || toks[sh.start - 2]?.w === 'with') continue;
    const hw = words(`${items[h].normalizedForm ?? ''} ${items[h].rawText}`);
    if (!hw.some(x => PROTEIN_WORDS.has(x)) || !hw.some(x => x === 'shake' || x === 'shakes')) continue;
    const jw = words(items[j].rawText);
    const inAt = jw.indexOf('in');
    const c = parseClause(inAt > 0 ? jw.slice(0, inAt) : jw);
    if (!c || c.food.length || !c.unit || c.unit.replace(/s$/, '') !== 'scoop') continue;
    if (!isValidTarget(items[h])) continue;
    // The remainder after `in`: a liquid (bare or measured: `8 oz of milk`) survives as its own item; a non-food (`it`, `total`,
    // `a shaker bottle`, `the morning`) goes; anything else (`my oatmeal`, `milk and a banana`) means do NOT fire.
    const rest = inAt > 0 ? jw.slice(inAt + 1).filter(x => x !== 'my' && x !== 'the' && x !== 'some') : [];
    const rc = rest.length ? parseClause(rest) : null;
    const liquid = rest.length && isLiquid(rest) ? rest : rc && rc.food.length && isLiquid(rc.food) ? rc.food : null;
    if (rest.length && !liquid && rest.some(x => !REST_NONFOOD.has(x))) continue;
    const after = `${formatValue(c.value)} ${c.unit} of protein powder`;
    folds.push({ kind: 'dose', targetIndex: h, clause: items[j].rawText, before: items[h].rawText, after });
    folded.set(h, after);
    doseNf.set(h, 'protein powder');
    if (liquid) {
      dose.set(j, rest.join(' '));
      doseNf.set(j, liquid.join(' '));
    } else {
      removed.add(j);
    }
  }
  // Later folds see the rewritten liquid (`… in milk, 1 cup` still folds the cup onto the milk).
  const W: T[] = items.map((it, i) => (dose.has(i) ? { ...it, rawText: dose.get(i)!, normalizedForm: doseNf.get(i) ?? it.normalizedForm } : it));

  // Segment fold (shapes A, B).
  for (let j = 1; j < n; j++) {
    if (removed.has(j) || folded.has(j)) continue;
    const jt = words(W[j].rawText);
    const jc = consumedTokens(jt);
    const plain = parseClause(jt) ?? parseClause(jt, { fractions: true });
    const clause = plain ?? (jc && n === 2 ? parseClause(jc) ?? parseClause(jc, { fractions: true }) : null);
    // A clause read only after stripping a consumption verb (`drank 2`) is for the STOCK path alone.
    const viaConsume = !plain;
    if (!clause) continue;
    let t = -1;
    if (clause.food.length === 0) {
      t = j - 1;
    } else {
      for (let k = j - 1; k >= 0; k--) {
        if (removed.has(k)) continue;
        if (covers(W[k], clause.food)) { t = k; break; }
      }
    }
    if (t < 0 || removed.has(t) || folded.has(t)) continue;
    if (clause.fractionWord && toks.some(x => ORDINAL_CUE.has(x.w))) continue;
    if (!isValidTarget(W[t])) {
      // S240 R3: a pure fraction over a STOCK item, on a two-item line (the stock and the clause) only; never an ADDITION
      // (`a cup of rice, and a half` is 1.5 cups).
      const jw0 = words(W[j].rawText)[0];
      const additive = jw0 === 'and' || jw0 === 'plus' || (spans[j] && ['and', 'plus'].includes(toks[spans[j]!.start - 1]?.w ?? ''));
      let st = isPureFraction(clause) && n === 2 && !additive ? scaleStock(W[t], clause.value) : null;
      if (st === null && n === 2) {
        // S240 R1: a consumed count, its verb in the segment or the two line tokens before it (`… , ate 2` -> [`2`]).
        const own = consumedTokens(words(W[j].rawText));
        const pre = spans[j] ? toks.slice(Math.max(0, spans[j]!.start - 3), spans[j]!.start).map(x => x.w) : [];
        const lineVerb = pre.length > 0 && CONSUME.has(pre[pre.length - 1]) && (pre.length < 2 || SUBJECT_OK.has(pre[pre.length - 2]) || toks[spans[j]!.start - 2]?.piece !== toks[spans[j]!.start - 1]?.piece);
        // `had 2 left` / `2 remaining` is what is LEFT, not what was eaten.
        const after = spans[j] ? toks[spans[j]!.end]?.w : undefined;
        const leftover = after === 'left' || after === 'remaining' || after === 'over';
        const cc = leftover ? null : own ? parseClause(own) : lineVerb ? clause : null;
        if (cc) st = replaceStock(W[t], cc);
      }
      if (st === null) continue;
      folds.push({ kind: 'stock', targetIndex: t, clause: W[j].rawText, before: W[t].rawText, after: st });
      folded.set(t, st);
      removed.add(j);
      continue;
    }
    if (clause.fractionWord || viaConsume) continue;
    if (clause.food.length === 0 && !aloneInPiece(t, j)) continue;
    const after = rewrite(W[t], clause);
    folds.push({ kind: 'segment', targetIndex: t, clause: W[j].rawText, before: W[t].rawText, after });
    folded.set(t, after);
    removed.add(j);
  }

  // Gap fold (shape C).
  for (let t = 0; t < n; t++) {
    const sp = spans[t];
    if (!sp || removed.has(t) || folded.has(t)) continue;
    let end: number;
    if (t === n - 1) end = toks.length;
    else if (spans[t + 1]) end = spans[t + 1]!.start;
    else continue;
    const groups: string[][] = [];
    let lastPiece = -1;
    for (const tk of toks.slice(sp.end, end)) {
      if (tk.piece !== lastPiece) { groups.push([]); lastPiece = tk.piece; }
      groups[groups.length - 1].push(tk.w);
    }
    const first = groups.find(g => {
      if (g.every(x => CONNECTORS.has(x))) return false;
      if (g.length === 2 && FRAME_WORDS.has(g[0]) && MEAL_WORDS.has(g[1])) return false;
      return true;
    });
    if (!first) continue;
    const pe = parsePartialEat(first);
    if (pe) {
      // A clause that names no food belongs to a ONE-item line only (`a muffin, a coffee, ate the top only` is ambiguous).
      if (pe.food.length > 0 ? !covers(W[t], pe.food) : n !== 1) continue;
      const scaled = scaleByFactor(W[t], pe.factor);
      if (scaled === null) continue;
      folds.push({ kind: 'partial', targetIndex: t, clause: first.join(' '), before: W[t].rawText, after: scaled });
      folded.set(t, scaled);
      continue;
    }
    const clause = parseClause(first) ?? parseClause(first, { fractions: true });
    if (!clause) {
      // S240 (cloud-38 D7): a clause led by a verb the plain reader does not take (`drank half`, `finished 2`, `eaten 2`)
      // still re-counts a STOCK on a one-item line; it never rewrites a valid target (#531 refute-r1 item 2: `drank` in the global
      // reader made `a pitcher of beer, drank 2` two pitchers).
      if (n !== 1 || isValidTarget(W[t])) continue;
      const own = consumedTokens(first);
      const cc = own ? parseClause(own) ?? parseClause(own, { fractions: true }) : null;
      if (cc?.fractionWord && toks.some(x => ORDINAL_CUE.has(x.w))) continue;
      const st = !cc ? null : isPureFraction(cc) ? scaleStock(W[t], cc.value) : replaceStock(W[t], cc);
      if (st === null) continue;
      folds.push({ kind: 'stock', targetIndex: t, clause: first.join(' '), before: W[t].rawText, after: st });
      folded.set(t, st);
      continue;
    }
    if (clause.fractionWord && toks.some(x => ORDINAL_CUE.has(x.w))) continue;
    if (!isValidTarget(W[t])) {
      // S240 R3: a pure fraction over a STOCK item, on a one-item line only; never an ADDITION (`and a half`).
      let st = isPureFraction(clause) && n === 1 && first[0] !== 'and' && first[0] !== 'plus' ? scaleStock(W[t], clause.value) : null;
      if (st === null && n === 1) {
        const own = consumedTokens(first);
        const cc = own ? parseClause(own) ?? parseClause(own, { fractions: true }) : null;
        if (cc && isPureFraction(cc)) st = scaleStock(W[t], cc.value);
        else if (cc) st = replaceStock(W[t], cc);
      }
      if (st === null) continue;
      folds.push({ kind: 'stock', targetIndex: t, clause: first.join(' '), before: W[t].rawText, after: st });
      folded.set(t, st);
      continue;
    }
    if (clause.fractionWord) continue;
    if (clause.food.length === 0 ? !aloneInPiece(t) : !covers(W[t], clause.food)) continue;
    const after = rewrite(W[t], clause);
    folds.push({ kind: 'gap', targetIndex: t, clause: first.join(' '), before: W[t].rawText, after });
    folded.set(t, after);
  }

  const out: T[] = [];
  W.forEach((it, idx) => {
    if (removed.has(idx)) return;
    const after = folded.get(idx);
    const nf = after !== undefined ? doseNf.get(idx) : undefined;
    out.push(after !== undefined ? { ...it, rawText: after, ...(nf ? { normalizedForm: nf } : {}) } : it);
  });
  return { items: out, folds };
}
