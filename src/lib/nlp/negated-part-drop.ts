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
 * S240 (MGR 17:14Z b) widened (a) and (b) for parts the segmenter splits off oddly: the negator may sit
 * in the LINE right before a bare part kept as-is (`a burrito with no sour cream or cheese` ->
 * [burrito | sour cream | cheese]); a removal verb may sit INSIDE the item (`picked off the pepperoni`,
 * `skipped the egg`); a normalizedForm may keep `<neg> <one word>` (`no sugar` ~ `no sugar`); and a
 * one-word bare part after `or` / `nor` inherits the negation of the part before it. Longer names
 * that start with a negator stay products (`no sugar added jam`, `no bake cookies`).
 *
 * Runs immediately BEFORE trailing-quantity-fold (drop first, then fold): fold-first can rewrite a
 * negated part into a billed one (`no bun, two of them` -> `2 no bun`). The SegmentationCache keeps
 * the undropped, unfolded split. Known miss: the heuristic segmenter sets normalizedForm '' and
 * keeps the negator in the LINE, so most of its splits still bill; it can now drop a removal-verb item
 * (`picked off the pepperoni`) or a bare part right after a line negator, nothing more.
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
  // S240 (MGR 17:14Z b)
  ['skipped'], ['left', 'off'], ['left', 'out'],
];
const OWN_CLAUSE = new Set(['but', 'then', 'had', 'ate', 'and', 'or', 'instead', 'kept']);
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
  let norm = words(item.normalizedForm ?? '');
  if (norm.length > 0 && (norm[0] === 'a' || norm[0] === 'an' || norm[0] === 'the')) norm.shift();
  // S240 (MGR 17:14Z b): the segmenter may keep the negator in the normalizedForm too, but only as `<neg> <one word>` repeating the
  // rawText (`no sugar` ~ `no sugar`); a longer name that starts with `no` is a product (`no yolks noodles`, `no sugar added jam`).
  const nNeg = NEG.find(n => startsWithWords(norm, n));
  const rawW = words(item.rawText);
  if (nNeg && norm.length === nNeg.length + 1 && rawW.length === norm.length && rawW.every((x, k) => x === norm[k])) norm = norm.slice(nNeg.length);
  if (norm.length > 1 && (norm[0] === 'the' || norm[0] === 'any')) norm = norm.slice(1);
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

/** S240 (MGR 17:14Z b): the segmenter may keep the removal verb INSIDE the item (`picked off the pepperoni`, `skipped the egg`). */
function isRemovedOwn(item: Item): boolean {
  if (item.brand && item.brand.trim()) return false;
  const w = words(item.rawText);
  for (const verb of REMOVAL_VERBS) {
    for (const det of REMOVAL_DETS) {
      const seq = [...verb, ...det];
      if (w.length > seq.length && seq.every((x, k) => w[k] === x)) {
        const rest = w.slice(seq.length);
        if (/^\d/.test(rest[0]) || NUMBER_START.has(rest[0])) return false;
        // never when a clause follows (`skipped the mayo but had chips`): the item then also names what was eaten.
        if (rest.some(x => OWN_CLAUSE.has(x))) return false;
        const nf = words(item.normalizedForm ?? '');
        if (nf.length === 0 || (nf.length === rest.length && nf.every((x, k) => sameWord(x, rest[k])))) return true;
        // else try a longer determiner (`skipped` + `the mayo` fails where `skipped the` + `mayo` matches)
      }
    }
  }
  return false;
}

/**
 * S240 (MGR 17:14Z b): the negator sits in the LINE right before a bare part the segmenter split off (`a burrito with no sour cream
 * or cheese` -> [burrito | sour cream | cheese]); a part joined to such a part by `or` / `nor` shares the negation.
 */
function negatedInLine(item: Item, span: { start: number; end: number } | null, toks: Tok[]): boolean {
  if (!span || (item.brand && item.brand.trim())) return false;
  const w = words(item.rawText);
  if (!w.length || /^\d/.test(w[0]) || NUMBER_START.has(w[0])) return false;
  // only a part the segmenter kept as-is: `sugar added jam` ~ `jam` (a no-sugar-added product) never; never a joined item
  // (`cheese or pepperoni pizza`) and never an `added` product (`no sugar added jam`).
  if (!asIs(item) || w.some(x => x === 'or' || x === 'and' || x === 'added')) return false;
  const piece = toks[span.start].piece;
  for (const n of NEG) {
    const from = span.start - n.length;
    if (from < 0) continue;
    if (!n.every((x, k) => toks[from + k].w === x && toks[from + k].piece === piece)) continue;
    // the `no` must open its comma piece or follow with / but / and (`a latte no cappuccino` is a correction, not a negation)
    const before = toks[from - 1];
    if (!before || before.piece !== piece || ['with', 'but', 'and', 'w'].includes(before.w)) return true;
  }
  return false;
}

/** The segmenter kept the part as-is: its own words END its normalizedForm (`cheese` ~ `cheddar cheese` yes; `sugar added jam` ~ `jam` no). */
function asIs(item: Item): boolean {
  const w = words(item.rawText);
  const nf = words(item.normalizedForm ?? '');
  if (!w.length || nf.length < w.length) return false;
  const off = nf.length - w.length;
  return w.every((x, k) => sameWord(x, nf[off + k]));
}

/** A bare part: not led by a number or an article (`2 bananas`, `a coffee` are new foods, never an inherited `no`). */
function bareLead(item: Item): boolean {
  const w = words(item.rawText);
  return w.length > 0 && !/^\d/.test(w[0]) && !NUMBER_START.has(w[0]) && !(item.brand && item.brand.trim());
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
  let prevNegated = false;
  items.forEach((it, j) => {
    if (j === 0) { out.push(it); return; }
    let kind: NegatedPartDrop['kind'] | null = null;
    if (isExclusion(it)) kind = 'exclusion';
    else if (isNegated(it)) kind = 'negated';
    else if (isRemoved(it, spans[j], toks) || isRemovedOwn(it)) kind = 'removed';
    else if (negatedInLine(it, spans[j], toks)) kind = 'negated';
    else if (
      prevNegated && spans[j] && spans[j - 1] && bareLead(it) && asIs(it) && words(it.rawText).length === 1 && toks[spans[j]!.start].piece === toks[spans[j - 1]!.end - 1].piece &&
      ['or', 'nor', 'or no'].includes(toks.slice(spans[j - 1]!.end, spans[j]!.start).map(t => t.w).join(' '))
    ) kind = 'negated';
    prevNegated = kind === 'negated';
    if (kind) drops.push({ kind, index: j, rawText: it.rawText });
    else out.push(it);
  });
  return { items: out, drops };
}
