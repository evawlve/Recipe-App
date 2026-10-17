/**
 * negated-part-drop.ts - a negated, removed or excluded part is dropped, not billed.
 *
 * MECHANISM. "a double cheeseburger, no bun" / "i took off the bacon" / "a baked potato with
 * everything except sour cream": the segmenter sometimes emits the REMOVED part as its own
 * segment (`no bun`, `bacon`, `everything except sour cream`). The mapper then mints and bills a
 * food the user said they did not eat. Three rules, checked in the order (c), (a), (b); the first
 * match names the receipt `kind`:
 *   (c) 'exclusion' - an exclusion of an unnamed set (`everything except ...`);
 *   (a) 'negated'   - the rawText starts with a negator and the item's normalizedForm is exactly
 *                     the negated words (brand empty);
 *   (b) 'removed'   - a negator-less restatement (`bacon`) immediately preceded in the line by a
 *                     VERB phrase (`took off the`), brand empty.
 * Item 0 always survives, so the list never empties.
 *
 * Runs immediately BEFORE trailing-quantity-fold (drop first, then fold): fold-first can rewrite a
 * negated part into a billed one (`no bun, two of them` -> `2 no bun`). The SegmentationCache keeps
 * the undropped, unfolded split. Known miss: the heuristic segmenter sets normalizedForm '' and
 * keeps removal phrases inside rawText, so nothing drops there.
 *
 * Pure; never mutates its input.
 */

import { words, sameWord, tokenizeWithPieces, Tok } from './trailing-quantity-fold';

export interface NegatedPartDrop {
  kind: 'negated' | 'removed' | 'exclusion';
  /** Index in the ORIGINAL input array. */
  index: number;
  rawText: string;
}

interface Item {
  rawText: string;
  normalizedForm?: string;
  brand?: string;
}

// Longest first.
const NEG: string[][] = [
  ['no', 'more'], ['hold', 'the'], ['skip', 'the'], ['no'], ['without'], ['minus'], ['except'],
];
const EXCLUSION_PREFIXES: string[][] = [
  ['everything', 'except'], ['everything', 'but'], ['all', 'the', 'toppings', 'except'], ['the', 'works', 'except'],
];
const REMOVAL_VERBS: string[][] = [
  ['took', 'off'], ['took', 'out'], ['picked', 'out'], ['picked', 'off'], ['scraped', 'off'], ['removed'], ['pulled', 'off'],
];
const REMOVAL_DETS: string[][] = [[], ['the'], ['all', 'the'], ['my']];
const NUMBER_START = new Set([
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'a', 'an',
]);

function startsWithWords(w: string[], prefix: string[]): boolean {
  return w.length >= prefix.length && prefix.every((p, k) => w[k] === p);
}

function isExclusion(item: Item): boolean {
  const w = words(item.rawText);
  return EXCLUSION_PREFIXES.some(p => startsWithWords(w, p));
}

function isNegated(item: Item): boolean {
  if (item.brand && item.brand.trim()) return false;
  const norm = words(item.normalizedForm ?? '');
  if (norm.length > 0 && (norm[0] === 'a' || norm[0] === 'an' || norm[0] === 'the')) norm.shift();
  if (norm.length === 0) return false;
  // Split on WHITESPACE so a hyphenated `no-bake` is one token and never a negator.
  const toks = item.rawText.toLowerCase().split(/\s+/).filter(Boolean);
  const neg = NEG.find(n => startsWithWords(toks, n));
  if (!neg) return false;
  let rest = toks.slice(neg.length);
  if (rest.length > 1 && (rest[0] === 'the' || rest[0] === 'any')) rest = rest.slice(1);
  const x = words(rest.join(' '));
  if (x.length === 0 || x.length !== norm.length) return false;
  return x.every((w, k) => sameWord(w, norm[k]));
}

function isRemoved(item: Item, span: { start: number; end: number } | null, toks: Tok[]): boolean {
  if (!span) return false;
  if (item.brand && item.brand.trim()) return false;
  const first = toks[span.start].w;
  if (/^\d/.test(first) || NUMBER_START.has(first)) return false;
  const piece = toks[span.start].piece;
  for (const det of REMOVAL_DETS) {
    for (const verb of REMOVAL_VERBS) {
      const seq = [...verb, ...det];
      const from = span.start - seq.length;
      if (from < 0) continue;
      let ok = true;
      for (let k = 0; k < seq.length; k++) {
        if (toks[from + k].w !== seq[k] || toks[from + k].piece !== piece) { ok = false; break; }
      }
      if (ok) return true;
    }
  }
  return false;
}

export function dropNegatedParts<T extends Item>(
  lineKey: string,
  items: T[],
): { items: T[]; drops: NegatedPartDrop[] } {
  const drops: NegatedPartDrop[] = [];
  if (items.length <= 1) return { items: items.slice(), drops };

  const toks = tokenizeWithPieces(lineKey);
  // Spans over the ORIGINAL items, left to right (row 2's rule: exact word match, cursor to the
  // END of a match, a miss leaves the cursor).
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

  const out: T[] = [];
  items.forEach((it, j) => {
    if (j === 0) { out.push(it); return; }
    let kind: NegatedPartDrop['kind'] | null = null;
    if (isExclusion(it)) kind = 'exclusion';
    else if (isNegated(it)) kind = 'negated';
    else if (isRemoved(it, spans[j], toks)) kind = 'removed';
    if (kind) drops.push({ kind, index: j, rawText: it.rawText });
    else out.push(it);
  });
  return { items: out, drops };
}
