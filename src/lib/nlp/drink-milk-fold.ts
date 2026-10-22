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
 * - Drop only: the milk item is removed and the drink item is left EXACTLY as the segmenter emitted it
 *   (rawText and normalizedForm untouched). The seat's composite arm refuted the rewrite: a rewritten rawText
 *   moved the serving onto corrupt powder panels (Matcha Latte 431 -> 953 kcal, London Fog 584 -> 1,120) and a
 *   milk appended to normalizedForm moved retrieval to worse records on 3 of 8 lines.
 *
 * - Second use (S202 cloud-35 F7): an `and` milk followed by `for|in|into` (or `with` + a possessive, or `with` + a word that opens a later
 *   item that is not ice or a drink addition — S240, cloud-36 C6) + a non-meal, non-time
 *   word (`for my cereal`, `for the baby`) is a second use of the milk, so it is KEPT; with no such evidence it still folds.
 *   `in|into it` (singular drink) / `in|into them` (plural), with the drink first, and `for me|myself` when the drink's own span
 *   holds no `for`, are not a second use (S240, cloud-36 C11).
 * - Ice (S240, MGR reserve R2): an item that is ONLY ice (`ice`, `some|extra|light|lots of|crushed ice`, `ice cubes`; rawText AND
 *   normalizedForm, never branded, never item 0) is dropped when the previous LIVE item is a DRINK (a word-list head, milk included),
 *   it shares that item's comma piece, and the gap from the IMMEDIATELY preceding item's span is `with`, `w`, `and`, `on`, `over`,
 *   `plus` (or `with|and some`, `with extra`). Never an article-led `an ice` / `a ice` (a UK dessert) and never a mis-split
 *   `ice | cream`. Drop only (kind `ice`): the drink is untouched; the mapper would bill the ice as Water 237 g.
 *
 * PASS ORDER. Runs AFTER dropDishParts and BEFORE foldTrailingQuantityClauses (drop, dish, drink, fold,
 * fill). The SegmentationCache keeps the unfolded split.
 *
 * Pure; never mutates its input; surviving items are returned as the same objects, untouched.
 */

import { words, tokenizeWithPieces } from './trailing-quantity-fold';

export interface DrinkMilkFold {
  /** Index in the ORIGINAL input array of the milk item. */
  index: number;
  /** The milk item's rawText. */
  rawText: string;
  /** The drink item's (unchanged) rawText. */
  drink: string;
  kind: 'fold' | 'duplicate' | 'ice';
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
const MEASURE_LEADS = ['a', 'an', 'one', 'two', 'some', 'glass', 'cup', 'splash'];
const MEAL_WORDS = new Set(['breakfast', 'brunch', 'lunch', 'dinner', 'supper', 'snack', 'snacks', 'dessert']);
const USE_DET = new Set(['my', 'the', 'a', 'his', 'her', 'their', 'our', 'your', 'some']);
const NOT_A_USE = new Set([...MEAL_WORDS, 'morning', 'today', 'tonight', 'afternoon', 'evening', 'later', 'now', 'here', 'go', 'side']);

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
        folds.push({ index: j, rawText: items[j].rawText, drink: items[d].rawText, kind: 'duplicate' });
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
    // S202 (cloud-35 F7): an `and` milk is KEPT only on positive second-use evidence after it:
    // `for|in|into` (+ optional possessive/article) + a non-meal/time word, or `with` + a possessive + a non-meal word.
    if (gap === 'and') {
      const nx = ptoks[sj.end];
      if (nx && nx.piece === ptoks[sj.start].piece) {
        let q = sj.end + 1;
        const poss = USE_DET.has(ptoks[q]?.w ?? '') && ptoks[q]?.piece === nx.piece;
        if (poss) q++;
        const obj = ptoks[q]?.piece === nx.piece ? ptoks[q]?.w : undefined;
        // S240 (cloud-36 C6): `with` + a bare word is evidence too when that word OPENS a later item's span — the split itself
        // names the second use (`a latte and milk with cereal` -> [latte | milk | cereal]).
        const laterItem = spans.some((x, k) => k > j && x !== null && x.start === q && !isIceOnly(items[k].rawText) && !isDrinkAddition(items[k]));
        const use = (['for', 'in', 'into'].includes(nx.w) && !!obj && !NOT_A_USE.has(obj))
          || (nx.w === 'with' && (poss || laterItem) && !!obj && !NOT_A_USE.has(obj));
        // S240 (cloud-36 C11): a pronoun object folds only when its antecedent can only be the drink / the eater.
        const head = words(items[d].normalizedForm || items[d].rawText).filter(x => x !== 'with' && x !== 'made' && x !== 'w');
        const plural = /s$/.test(head.find(x => DRINK1.has(x)) ?? '');
        const firstLive = ![...Array(d).keys()].some(q => !drop.has(q));
        const drinkHasFor = toks.slice(sd.start, sd.end).includes('for');
        const pron = !poss && obj !== undefined && (
          (['in', 'into'].includes(nx.w) && firstLive && ((obj === 'it' && !plural) || (obj === 'them' && plural)))
          || (nx.w === 'for' && (obj === 'me' || obj === 'myself') && !drinkHasFor));
        if (use && !pron) continue;
      }
    }

    // DROP ONLY: the drink item is left exactly as the segmenter emitted it.
    drop.add(j);
    folds.push({ index: j, rawText: items[j].rawText, drink: items[d].rawText, kind: 'fold' });
  }

  // S240 (MGR reserve R2): `a glass of lemonade with ice` - the segmenter emits `ice` as its own item and the mapper bills it as
  // Water 237 g. An item that is ONLY ice (`ice`, `some ice`, `crushed ice`, `ice cubes`, ...) joined to the previous live item in
  // the same comma piece by with / and / on / over / plus is dropped; the drink is left untouched. Item 0 never drops.
  for (let j = 1; j < items.length; j++) {
    if (drop.has(j) || (items[j].brand ?? '').trim() || !isIceOnly(items[j].rawText) || (items[j].normalizedForm && !isIceOnly(items[j].normalizedForm!))) continue;
    let k = j - 1;
    while (k >= 0 && drop.has(k)) k--;
    const sk = spans[k];
    const sj = spans[j];
    if (k < 0 || !sk || !sj) continue;
    // ...only after a DRINK (`oysters on ice`, `cake and ice` keep theirs), never an article-led `an ice` (a dessert in UK English),
    // and never a mis-split `ice | cream`.
    if (!words(`${items[k].normalizedForm ?? ''} ${items[k].rawText}`).some(x => DRINK_WORDS.has(x))) continue;
    if (/^\s*(an?|one)\s+ice\b/i.test(items[j].rawText)) continue;
    if (j + 1 < items.length && words(items[j + 1].rawText)[0] === 'cream') continue;
    if (ptoks[sk.end - 1]?.piece !== ptoks[sj.start]?.piece) continue;
    // the gap is read from the IMMEDIATELY preceding item's span (a folded milk sits between the drink and its ice)
    const sp = spans[j - 1];
    if (!sp) continue;
    const gap = toks.slice(sp.end, sj.start).join(' ');
    if (!ICE_GAP.has(gap)) continue;
    drop.add(j);
    folds.push({ index: j, rawText: items[j].rawText, drink: items[k].rawText, kind: 'ice' });
  }

  return { items: items.filter((_, i) => !drop.has(i)), folds };
}

const DRINK_WORDS = new Set([
  'milk', 'coke', 'cola', 'pepsi', 'sprite', 'soda', 'pop', 'water', 'seltzer', 'coffee', 'latte', 'lattes', 'cappuccino', 'americano', 'espresso',
  'mocha', 'macchiato', 'tea', 'matcha', 'lemonade', 'juice', 'smoothie', 'smoothies', 'shake', 'milkshake', 'beer', 'wine', 'whiskey',
  'whisky', 'bourbon', 'vodka', 'gin', 'rum', 'tequila', 'margarita', 'cocktail', 'drink', 'drinks', 'soda', 'gatorade', 'powerade',
  'kombucha', 'cider', 'sangria', 'mojito', 'spritz', 'refresher', 'frappuccino', 'frappe', 'chai', 'brew', 'icee', 'slushie',
]);
const ICE_GAP = new Set(['with', 'w', 'and', 'on', 'over', 'plus', 'with some', 'with extra', 'and some']);
function isIceOnly(text: string): boolean {
  const w = words(text).filter(x => !['some', 'extra', 'light', 'lots', 'of', 'a', 'an', 'little', 'crushed', 'cubed', 'the'].includes(x));
  return w.length >= 1 && w.length <= 2 && w[0] === 'ice' && (w.length === 1 || w[1] === 'cubes' || w[1] === 'cube');
}

// S240 (cloud-36 C6): a later item whose HEAD (last word) is something that goes INTO / ONTO the drink is not a second use of the milk.
const DRINK_ADD = new Set([
  'sugar', 'sugars', 'honey', 'cream', 'cinnamon', 'caramel', 'syrup', 'syrups', 'vanilla', 'hazelnut', 'shot', 'shots', 'foam',
  'stevia', 'splenda', 'sweetener', 'sweeteners', 'espresso', 'drizzle', 'sprinkles', 'nutmeg', 'cocoa', 'pump', 'pumps', 'sauce',
  'agave', 'truvia', 'equal', 'whip', 'topping', 'toppings',
]);
function isDrinkAddition(it: Item): boolean {
  const w = words(it.normalizedForm || it.rawText);
  return w.length > 0 && DRINK_ADD.has(w[w.length - 1]);
}
