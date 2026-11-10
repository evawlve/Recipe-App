/**
 * measured-recipe-head-drop.ts - a measured recipe bills its ingredients, not the dish (s453 C3P).
 *
 * MECHANISM. "fried rice with 2 cups leftover rice, 2 eggs, 1/2 cup frozen peas and carrots, 1 tbsp sesame oil":
 * the segmenter emits the dish ("fried rice") AND every measured ingredient. The ingredients already ARE the
 * dish, so billing the dish too counts the whole recipe twice. Diego's ruling (2026-11-09): a dish named, then
 * amounts for its ingredients, with no homemade marker -> keep the ingredients, drop the dish.
 *
 * RULE. Scan items d = 0 .. n-1; drop the FIRST d meeting all of:
 *  1. the line has no made with / i made / we made / homemade / home made marker (dish-part-drop owns those);
 *  2. d has no brand, its rawText holds no amount and no `with`;
 *  3. d's name (normalizedForm || rawText) ends in a composite-dish head (BASE below);
 *  4. in the line, d's text is followed by with / filled with / topped with;
 *  5. >= 2 LATER items carry an amount, not counting a bare unit leftover ("1 cup" split off a line);
 *  6. >= 1 later item names that head's base (rice / egg / mix / bread / ...).
 * At most one drop per line.
 * LATER means later in the LINE (s455 MR1): the segmenter can emit the head last.
 *
 * PASS ORDER. Runs right after dropDishParts (which is a no-op wherever this fires, rule 1) and before
 * foldDrinkMilk. The SegmentationCache keeps the undropped split.
 *
 * KNOWN MISSES (left alone on purpose): a trailing dish quantity (", about 2 cups") orphans once the head
 * drops; `w/` is not `with`; fused splits (the head carries its own `with 2 eggs`) stay; a side naming the base
 * (fried rice with 2 egg rolls and 1 cup white rice) drops the dish.
 *
 * Pure; never mutates its input.
 */

import { words } from './trailing-quantity-fold';

export interface MeasuredRecipeHeadDrop {
  /** Index in the ORIGINAL input array. */
  index: number;
  rawText: string;
}

interface Item {
  rawText: string;
  normalizedForm?: string;
  brand?: string;
}

const BASE: Array<[RegExp, RegExp]> = [
  [/\bfried rice$|\bstir ?fry$/, /\brice\b|\bnoodles?\b/],
  [/\bshakshuka$|\bomelet(te)?s?$|\bfrittata$|\bscramble$/, /\beggs?\b|\begg whites?\b/],
  [/\bpancakes?$|\bwaffles?$/, /\bmix\b|\bflour\b|\bbatter\b|\boats\b/],
  [/\bsmoothies?$/, /\bmilk\b|\bbanana\b|\bprotein\b|\byogurt\b/],
  [/\bburritos?$|\bwraps?$|\bquesadillas?$|\btacos?$/, /\btortillas?\b|\bshells?\b/],
  [/\bsandwich(es)?$|\bsubs?$|\bpanini$|\bmelt$/, /\bbread\b|\bslices? of (white|wheat|sourdough|rye)|\bsourdough\b|\brye\b|\bbun\b|\broll\b|\bbagel\b|\bciabatta\b/],
  [/\bburgers?$/, /\bbuns?\b|\bpatt(y|ies)\b/],
  [/\bpizza$/, /\bcrust\b|\bdough\b|\bflatbread\b|\bnaan\b/],
  [/\bparfait$/, /\byogurt\b/],
];
const AMT = /^(?:about |maybe |like |around )?(?:\d|one\b|two\b|three\b|four\b|five\b|six\b|half\b|quarter\b|an? (?:quarter|half|third|cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|grams?|lbs?|pounds?|slices?|strips?|pieces?|handful|scoops?|can|cloves?|piece)\b)/i;
const MARKER = /\b(made with|i made|we made|homemade|home made)\b/;
const LEAD = /^(with|filled with|topped with)\b/;
const UNIT_ONLY = /^(cups?|c|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|grams?|g|lbs?|pounds?|scoops?|slices?|pieces?|servings?|bowls?|halves|half|of them|of it|more)$/;

/** Drop the dish head of a measured recipe. Never mutates; at most one drop per line. */
export function dropMeasuredRecipeHead<T extends Item>(
  lineKey: string,
  items: T[],
): { items: T[]; drops: MeasuredRecipeHeadDrop[] } {
  const lk = ' ' + words(lineKey).join(' ') + ' ';
  if (MARKER.test(lk)) return { items, drops: [] };
  // s455 MR1: an item's space-padded word needles (rawText, then normalizedForm when non-empty).
  const needles = (x: Item): string[] => {
    const out = [' ' + words(x.rawText).join(' ') + ' '];
    const nf = words(x.normalizedForm || '').join(' ');
    if (nf) out.push(' ' + nf + ' ');
    return out;
  };
  for (let d = 0; d < items.length; d++) {
    const h = items[d];
    const hw = words(h.rawText);
    if (h.brand) continue;
    if (!hw.length || AMT.test(h.rawText.trim()) || hw.includes('with')) continue;
    const nf = words(h.normalizedForm || h.rawText).join(' ');
    const pair = BASE.find(([hr]) => hr.test(nf));
    if (!pair) continue;
    const needle = ' ' + hw.join(' ') + ' ';
    const at = lk.indexOf(needle);
    if (at < 0) continue;
    if (!LEAD.test(lk.slice(at + needle.length))) continue;
    // LATER = found in the line past the head's own span; an item found nowhere falls back to array order.
    const from = at + needle.length - 1;
    const later = items.filter((x, i) => {
      if (i === d) return false;
      const ns = needles(x);
      if (ns.some(n => lk.indexOf(n, from) >= 0)) return true;
      return i > d && !ns.some(n => lk.indexOf(n) >= 0);
    });
    const amt = later.filter(x => {
      const raw = x.rawText.trim();
      if (!AMT.test(raw)) return false;
      const name = x.normalizedForm || raw.replace(AMT, '');
      return !UNIT_ONLY.test(words(name).join(' '));
    });
    if (amt.length < 2) continue;
    const base = later.some(
      x => pair[1].test(words(x.normalizedForm || x.rawText).join(' ')) || pair[1].test(words(x.rawText).join(' ')),
    );
    if (!base) continue;
    return { items: items.filter((_, i) => i !== d), drops: [{ index: d, rawText: h.rawText }] };
  }
  return { items, drops: [] };
}
