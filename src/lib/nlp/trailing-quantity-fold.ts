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
 * NO prompt edit, NO version bump: the SegmentationCache stores the UNFOLDED split; the fold
 * reads `lineKey` (canonicalizeSegLine(text)) so one cached split folds one way for every
 * case/punctuation variant that shares its key. Pure; imports only parseIngredientLine;
 * never mutates its input.
 */

import { parseIngredientLine } from '@/lib/parse/ingredient-line';
import { splitLeadingPour } from '@/lib/parse/loose-measures';

export interface TrailingQuantityFold {
  kind: 'segment' | 'gap';
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
export function parseClause(t: string[]): Clause | null {
  const n = t.length;
  let i = 0;
  while (i < n && LEAD.has(t[i])) i++;
  if (i >= n) return null;

  let value: number;
  let half = false;
  const w = t[i];
  const numeric = parseNumeric(w);
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
  return v === 0.5 ? '1/2' : String(v);
}

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

  // Segment fold (shapes A, B).
  for (let j = 1; j < n; j++) {
    if (removed.has(j) || folded.has(j)) continue;
    const clause = parseClause(words(items[j].rawText));
    if (!clause) continue;
    let t = -1;
    if (clause.food.length === 0) {
      t = j - 1;
    } else {
      for (let k = j - 1; k >= 0; k--) {
        if (removed.has(k)) continue;
        if (covers(items[k], clause.food)) { t = k; break; }
      }
    }
    if (t < 0 || removed.has(t) || folded.has(t)) continue;
    if (!isValidTarget(items[t])) continue;
    if (clause.food.length === 0 && !aloneInPiece(t, j)) continue;
    const after = rewrite(items[t], clause);
    folds.push({ kind: 'segment', targetIndex: t, clause: items[j].rawText, before: items[t].rawText, after });
    folded.set(t, after);
    removed.add(j);
  }

  // Gap fold (shape C).
  for (let t = 0; t < n; t++) {
    const sp = spans[t];
    if (!sp || removed.has(t) || folded.has(t) || !isValidTarget(items[t])) continue;
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
    const clause = parseClause(first);
    if (!clause) continue;
    if (clause.food.length === 0 ? !aloneInPiece(t) : !covers(items[t], clause.food)) continue;
    const after = rewrite(items[t], clause);
    folds.push({ kind: 'gap', targetIndex: t, clause: first.join(' '), before: items[t].rawText, after });
    folded.set(t, after);
  }

  const out: T[] = [];
  items.forEach((it, idx) => {
    if (removed.has(idx)) return;
    const after = folded.get(idx);
    out.push(after !== undefined ? { ...it, rawText: after } : it);
  });
  return { items: out, folds };
}
