/**
 * drink-milk-fold.ts - a milk named after a milk-bearing drink is the drink's variant, not a second drink.
 *
 * MECHANISM. "a matcha latte with almond milk" / "a flat white and oat milk": the segmenter emits the
 * drink AND the milk as separate items, so the latte (whose nutrition already contains its milk) is billed
 * once and the milk is billed again. Diego's ruling (Option A, 2026-10-17): the drink is billed, the milk
 * names its variant.
 *
 * RULES.
 * - Drink: the head of the drink's name (normalizedForm, else rawText; the words BEFORE a `with` / `made` /
 *   `w`) ends in latte, cappuccino, cortado, macchiato, mocha, frappuccino, frappe, `flat white` or
 *   `london fog`. Not coffee, tea, cold brew, americano, espresso or a smoothie.
 * - Milk: the NEXT item (adjacent only), and a bare milk phrase in BOTH its normalizedForm and its rawText
 *   (the segmenter keeps a measure in the rawText and strips it from the normalizedForm, so
 *   `8 oz of milk` / `a glass of milk` stay billed): `milk` with only milk modifiers, `half and half`, a
 *   short `... creamer`, or bare `cream`.
 * - Gap: in the same comma piece of the line, exactly `with`, `w`, `made with`, or `and` (`and` only when
 *   the milk carries no measure). A milk with no span in the line whose words already sit inside the
 *   drink's rawText (`... made with oat milk`) is a duplicate and is dropped with no rewrite.
 * - Rewrite: the drink's rawText becomes `<drink> <gap> <milk>` (the user's own words). Only a NON-default
 *   milk (oat, almond, skim ...) is appended to the drink's normalizedForm, and never to an empty one;
 *   plain / whole milk, cream, creamer and half and half append nothing.
 *
 * PASS ORDER. Runs AFTER dropDishParts and BEFORE foldTrailingQuantityClauses (drop, dish, drink, fold,
 * fill). The SegmentationCache keeps the unfolded split.
 *
 * Pure; never mutates its input; every other field of a rewritten item (brand) is preserved.
 */

import { words, tokenizeWithPieces } from './trailing-quantity-fold';

export interface DrinkMilkFold {
  /** Index in the ORIGINAL input array of the milk item. */
  index: number;
  /** The milk item's rawText. */
  rawText: string;
  /** The drink item's NEW rawText. */
  drink: string;
  kind: 'fold' | 'duplicate';
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

const DRINK1 = new Set([
  'latte', 'lattes', 'cappuccino', 'cappuccinos', 'cortado', 'macchiato', 'mocha', 'mochas', 'frappuccino', 'frappe',
]);
const DRINK2 = new Set(['flat white', 'london fog']);
const MILK_MODS = new Set([
  'almond', 'oat', 'skim', 'whole', 'soy', 'coconut', 'percent', 'low', 'fat', 'nonfat', 'lactose', 'free',
  'cashew', 'macadamia', 'pea', 'reduced', 'vanilla', 'unsweetened',
]);
const APPEND_MODS = new Set([
  'almond', 'oat', 'skim', 'soy', 'coconut', 'nonfat', 'lactose', 'cashew', 'macadamia', 'pea', 'low', 'fat',
  'free', '2',
]);
const MEASURE_LEADS = ['a', 'an', 'one', 'two', 'some', 'glass', 'cup', 'splash'];

function isMilkDrink(it: Item): boolean {
  const all = words(it.normalizedForm || it.rawText);
  const cut = all.findIndex(x => x === 'with' || x === 'made' || x === 'w');
  const w = cut > 0 ? all.slice(0, cut) : all;
  const k = w.length - 1;
  if (k < 0) return false;
  return DRINK1.has(w[k]) || (k > 0 && DRINK2.has(`${w[k - 1]} ${w[k]}`));
}

function milkWordsOf(text: string): string[] | null {
  const pct = /\b2%/.test(text);
  const w = words(text);
  if (!w.length || w.length > 4) return null;
  const last = w[w.length - 1];
  if (last === 'milk' && w.slice(0, -1).every(x => MILK_MODS.has(x) || (x === '2' && pct))) return w;
  if (w.join(' ') === 'half and half' || (last === 'creamer' && w.length <= 3) || (w.length === 1 && last === 'cream')) {
    return w;
  }
  return null;
}

/** BOTH the normalizedForm and the rawText must be a bare milk phrase. */
function milkWords(it: Item): string[] | null {
  const r = milkWordsOf(it.rawText);
  if (!r) return null;
  return it.normalizedForm ? milkWordsOf(it.normalizedForm) : r;
}

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

export function foldDrinkMilk<T extends Item>(lineKey: string, items: T[]): { items: T[]; folds: DrinkMilkFold[] } {
  const ptoks = tokenizeWithPieces(lineKey);
  const toks = ptoks.map(t => t.w);
  const spans: Array<Span | null> = [];
  let cur = 0;
  for (const it of items) {
    const sp = findSpan(toks, words(it.rawText), cur) ?? findSpan(toks, words(it.normalizedForm ?? ''), cur);
    spans.push(sp);
    if (sp) cur = sp.end;
  }

  const out = items.map(x => ({ ...x }));
  const drop = new Set<number>();
  const folds: DrinkMilkFold[] = [];

  for (let d = 0; d + 1 < items.length; d++) {
    if (drop.has(d) || !isMilkDrink(items[d])) continue;
    const j = d + 1;
    const mw = milkWords(items[j]);
    if (!mw) continue;
    const sd = spans[d];
    const sj = spans[j];
    if (!sj) {
      // duplicate: the milk's words already sit inside the drink's own rawText
      if (findSpan(words(items[d].rawText), mw, 0)) {
        drop.add(j);
        folds.push({ index: j, rawText: items[j].rawText, drink: out[d].rawText, kind: 'duplicate' });
      }
      continue;
    }
    if (!sd) continue;
    // never across a comma piece
    if (ptoks[sd.end - 1] && ptoks[sj.start] && ptoks[sd.end - 1].piece !== ptoks[sj.start].piece) continue;
    const gap = toks.slice(sd.end, sj.start).join(' ');
    const jLead = words(items[j].rawText)[0];
    const measured =
      MEASURE_LEADS.includes(jLead) && !milkWords({ rawText: items[j].rawText.replace(/^\s*(a|an|some)\s+/i, '') });
    if (!(gap === 'with' || gap === 'w' || gap === 'made with' || (gap === 'and' && !measured))) continue;

    // append ONLY a non-default milk, and only to a real normalizedForm
    const nf = out[d].normalizedForm;
    const variant = mw[mw.length - 1] === 'milk' && mw.length > 1 && mw.slice(0, -1).every(x => APPEND_MODS.has(x));
    if (nf && variant && !mw.every(x => words(nf).includes(x))) out[d].normalizedForm = `${nf} ${mw.join(' ')}`.trim();
    out[d].rawText = `${items[d].rawText} ${gap === 'w' ? 'w/' : gap} ${items[j].rawText}`;
    drop.add(j);
    folds.push({ index: j, rawText: items[j].rawText, drink: out[d].rawText, kind: 'fold' });
  }

  return { items: out.filter((_, i) => !drop.has(i)), folds };
}
