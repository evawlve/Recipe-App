/**
 * segmenter-echo-drop.ts - a `with` part the host item already names is not billed a second time.
 *
 * MECHANISM. The LLM segmenter sometimes keeps a `with` part inside the host item AND emits that part again as
 * its own item: `salad with chicken` -> [`salad with chicken` ~ `salad with chicken` | `chicken`]. The mapper
 * retrieves on the segmenter's normalizedForm when one is supplied, so when the host's own normalizedForm already
 * names the part, the part is billed twice: once inside the host's identity, once on its own (measured: the
 * `kraft mayo with olive oil` echo bills ~3x the host record).
 *
 * RULE. Item j (j >= 1) is an echo, and is dropped, when ALL hold:
 * 1. It has no span of its own in the line. Spans are found left-to-right with a cursor over the line's words
 *    (rawText words, else normalizedForm words), as foldDrinkMilk() computes them, plus one repair (S240, cloud-38 D9): an item
 *    never keeps a span that lies inside the span a later item needs (it moves to a later free occurrence, or has none); a j whose words occur
 *    only BEFORE the cursor has none (`salad with chicken and more chicken` keeps the second mention).
 * 2. It carries no amount: no rawText word is a digit, a|an, a number word, half, some, extra, more, ... and no
 *    vulgar fraction. The host also keeps its echo when an amount sits between its `with` and the matched part
 *    or its rawText holds a fraction (`popeyes chicken sandwich with half a biscuit`, `with 4 oz chicken`,
 *    `blt with extra bacon`: a separately billed portion).
 * 3. Some earlier surviving item has a `with` / `w` token in its rawText, the echo's rawText words sit
 *    contiguously AFTER that token, AND (when the host has a normalizedForm) also inside the host's
 *    normalizedForm (guard 3b: `coffee with milk` ~ `coffee` | `milk` and `granola with almonds` keep both).
 * The echo is matched on its rawText words ONLY.
 *
 * KNOWN MISSES (conservative, left as-is): plural/singular echoes (`onions` / `onion`); a host whose rawText the
 * segmenter rewrote; a rewritten echo (`mozzarella sticks` ~ `cheese`). Accepted false-positive class: a segmenter
 * that REORDERS a real second mention behind the cursor (`chicken and rice with chicken`), seen in no population.
 *
 * Drop only: surviving items are returned as the same objects, untouched (the drink-milk composite arm refuted
 * rewrites).
 *
 * PASS ORDER. Runs AFTER foldDrinkMilk (its `duplicate` kind stays its own) and BEFORE foldTrailingQuantityClauses:
 * `pasta with marinara, 2 cups` with an echo `marinara` becomes ONE item `2 cups of pasta with marinara` when the
 * echo goes first, but [pasta with marinara | 2 cups] (an orphaned quantity) when the fold goes first. Also before
 * fillRestaurantBrand (an echo must not be filled). The SegmentationCache keeps the undropped split.
 *
 * Pure; never mutates its input.
 */

import { words } from './trailing-quantity-fold';

export interface SegmenterEcho {
  /** Index in the ORIGINAL input array of the dropped echo. */
  index: number;
  /** The echo's rawText. */
  rawText: string;
  /** The host item's rawText. */
  host: string;
}

interface Item {
  rawText: string;
  normalizedForm?: string;
  brand?: string;
}

interface Span {
  start: number;
  end: number;
}

const WITH = new Set(['with', 'w']);
const AMOUNT = new Set([
  'a', 'an', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'dozen',
  'half', 'quarter', 'some', 'few', 'couple', 'several', 'another', 'extra', 'more', 'double', 'triple', 'added', 'side',
  'lots', 'bit', 'little', 'handful', 'splash', 'scoop', 'scoops', 'serving', 'servings', 'piece', 'pieces', 'slice', 'slices',
]);
const isAmount = (w: string): boolean => AMOUNT.has(w) || /\d/.test(w);
// words() strips non-ASCII, so a vulgar fraction is read off the raw text.
const FRACTION = /[¼-¾⅐-⅞]/;

function findSpan(toks: string[], w: string[], from: number): Span | null {
  if (!w.length) return null;
  for (let s = from; s + w.length <= toks.length; s++) {
    let ok = true;
    for (let k = 0; k < w.length; k++) {
      if (toks[s + k] !== w[k]) {
        ok = false;
        break;
      }
    }
    if (ok) return { start: s, end: s + w.length };
  }
  return null;
}

export function dropSegmenterEchoes<T extends Item>(
  lineKey: string,
  items: T[],
): { items: T[]; echoes: SegmenterEcho[] } {
  const toks = words(lineKey);
  const spans: Array<Span | null> = [];
  let cur = 0;
  for (const it of items) {
    const sp = findSpan(toks, words(it.rawText), cur) ?? findSpan(toks, words(it.normalizedForm ?? ''), cur);
    spans.push(sp);
    if (sp) cur = sp.end;
  }
  // S240 (cloud-38 D9): an item may not take its span from INSIDE the span a later item needs (`coffee with milk, wait no, oat
  // milk` -> [`coffee with milk` | `milk` | `oat milk`]: `milk` sits inside `oat milk`). Then the later item keeps that span and the
  // earlier one has none of its own (an echo candidate under guard 1).
  for (let k = 1; k < items.length; k++) {
    if (spans[k]) continue;
    for (let j = k - 1; j >= 0; j--) {
      const sj = spans[j];
      if (!sj) continue;
      let from = 0;
      for (let p = j - 1; p >= 0; p--) if (spans[p]) { from = spans[p]!.end; break; }
      const kw = words(items[k].rawText);
      const K = findSpan(toks, kw, from);
      if (K && K.start <= sj.start && sj.end <= K.end) {
        spans[k] = K;
        // j keeps a real occurrence AFTER K that no other item claims (the segmenter emitted the real second mention before the
        // item that contains the echo's words); only an item whose ONLY occurrence is inside K loses its span.
        const J2 = findSpan(toks, words(items[j].rawText), K.end);
        const free = J2 && !spans.some((x, q) => q !== j && x && x.start < J2.end && J2.start < x.end);
        spans[j] = free ? J2 : null;
      }
      break;
    }
  }

  const drop = new Set<number>();
  const echoes: SegmenterEcho[] = [];
  for (let j = 1; j < items.length; j++) {
    if (spans[j]) continue;
    const ew = words(items[j].rawText);
    if (!ew.length || ew.some(isAmount) || FRACTION.test(items[j].rawText)) continue;
    for (let d = 0; d < j; d++) {
      if (drop.has(d)) continue;
      const dw = words(items[d].rawText);
      const wi = dw.findIndex(x => WITH.has(x));
      if (wi < 0 || FRACTION.test(items[d].rawText)) continue;
      const at = findSpan(dw, ew, wi + 1);
      if (!at || dw.slice(wi + 1, at.start).some(isAmount)) continue;
      const dn = items[d].normalizedForm ? words(items[d].normalizedForm as string) : null;
      if (!dn || findSpan(dn, ew, 0)) {
        drop.add(j);
        echoes.push({ index: j, rawText: items[j].rawText, host: items[d].rawText });
        break;
      }
    }
  }
  return { items: items.filter((_, i) => !drop.has(i)), echoes };
}
