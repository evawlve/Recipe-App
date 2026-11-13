/**
 * extra-portion.ts - a split-off `double meat` / `extra protein` is one more portion of the host's protein.
 *
 * MECHANISM (S240, MGR 17:30Z relay 1, C70 run-5 pre-digest). "a turkey sub with double meat": the segmenter emits the
 * modifier as its own item (`double meat` ~ `double meat`), and retrieval answers the literal words with a branded
 * record (Double Meat Whataburger 400 g / 835 kcal; `double protein` -> Double protein raw oats). The item's
 * normalizedForm becomes the protein its HOST names: `double meat` ~ `turkey`. The host is the item the modifier hangs
 * off by `with` (in the item, or in the line gap within the same comma piece), else the item right before it. A host
 * naming no single protein gives `meat` for `meat` and leaves `protein` untouched (a smoothie's `extra protein` is not
 * meat). `egg` / `eggs` / `tofu` never answer a generic `meat`. A named protein (`double chicken` ~ `double chicken`)
 * only loses the modifier; any other modifier (`extra cheese`, `double patty`) is untouched.
 *
 * Fires on an item after the first, brand empty, whose normalizedForm (or rawText when the normalizedForm is a bare
 * `meat` / `protein`) is exactly `double|extra|triple <meat|protein|a protein word>`. rawText is never changed: the echo
 * drop and the trailing-quantity fold find items by their rawText in the line. Protein words: dish-part-drop's PROT
 * minus `patty` / `patties`. Known under-bill: `triple` bills one extra portion.
 *
 * Pure; never mutates its input.
 */
import { words } from './trailing-quantity-fold';
import { PROT } from './dish-part-drop';

interface Item { rawText: string; normalizedForm?: string; brand?: string }
export interface ExtraPortion { index: number; from: string; to: string }

const MODIFIERS = new Set(['double', 'extra', 'triple']);
const GENERIC = new Set(['meat', 'protein']);
const PROTEINS = new Set(PROT.filter(x => x !== 'patty' && x !== 'patties'));
const WITH = new Set(['with', 'w']);
const NOT_MEAT = new Set(['egg', 'eggs', 'tofu']);

function proteinsIn(item: Item): string[] {
  const w = words(item.normalizedForm || item.rawText);
  return [...new Set(w.filter(x => PROTEINS.has(x)))];
}
// A bare quantity clause (`two of them`, `2 more`) names no food, so it is never the host.
const QTY_WORDS = new Set([
  'a', 'an', 'the', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'half', 'of', 'them', 'it', 'those', 'these', 'more', 'another', 'both', 'all', 'couple', 'few', 'i', 'had', 'ate',
]);
function quantityOnly(item: Item): boolean {
  const w = words(item.rawText);
  return w.length > 0 && w.every(x => QTY_WORDS.has(x) || /^[\d/.]+$/.test(x));
}
function strip(w: string[]): string[] { return w[0] === 'a' || w[0] === 'an' || w[0] === 'with' ? w.slice(1) : w; }
function span(toks: string[], w: string[], from: number): [number, number] | null {
  if (!w.length) return null;
  for (let s = from; s + w.length <= toks.length; s++) if (w.every((x, k) => toks[s + k] === x)) return [s, s + w.length];
  return null;
}

export function rewriteExtraPortions<T extends Item>(lineKey: string, items: T[]): { items: T[]; rewrites: ExtraPortion[] } {
  const rewrites: ExtraPortion[] = [];
  const pieces = lineKey.split(/[,;]/).map(p => words(p));
  const toks: string[] = []; const piece: number[] = [];
  pieces.forEach((p, i) => p.forEach(x => { toks.push(x); piece.push(i); }));
  const spans: Array<[number, number] | null> = []; let cur = 0;
  for (const it of items) { const s = span(toks, words(it.rawText), cur) ?? span(toks, words(it.normalizedForm ?? ''), cur); spans.push(s); if (s) cur = s[1]; }
  const out = items.map((it, j) => {
    if (j === 0 || (it.brand && it.brand.trim())) return it;
    let w = strip(words(it.normalizedForm || it.rawText));
    if (w.length === 1 && GENERIC.has(w[0])) w = strip(words(it.rawText));
    if (w.length !== 2 || !MODIFIERS.has(w[0])) return it;
    let protein: string;
    if (PROTEINS.has(w[1])) protein = w[1];
    else if (GENERIC.has(w[1])) {
      // The `with` host: the nearest earlier item holding `with`, or joined to this one by `with` in the same comma piece.
      let host = -1;
      for (let d = j - 1; d >= 0 && host < 0; d--) {
        if (quantityOnly(items[d])) continue;
        if (words(items[d].rawText).some(x => WITH.has(x))) { host = d; break; }
        const a = spans[d], b = spans[j];
        if (a && b && toks.slice(a[1], b[0]).some((x, k) => WITH.has(x) && piece[a[1] + k] === piece[b[0]])) host = d;
      }
      for (let d = j - 1; d >= 0 && host < 0; d--) if (!quantityOnly(items[d])) host = d;
      const named = (host >= 0 ? proteinsIn(items[host]) : []).filter(x => w[1] === 'protein' || !NOT_MEAT.has(x));
      if (named.length === 1) protein = named[0];
      else if (w[1] === 'protein') return it;
      else protein = 'meat';
    } else return it;
    rewrites.push({ index: j, from: `${it.rawText} ~ ${it.normalizedForm ?? ''}`, to: protein });
    return { ...it, normalizedForm: protein };
  });
  return { items: out, rewrites };
}
