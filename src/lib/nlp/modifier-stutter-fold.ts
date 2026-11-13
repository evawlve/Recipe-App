/**
 * modifier-stutter-fold.ts - a dictated "sugar sugar-free X" bills the sugar-free X, not a phantom sugar (s455 DS1).
 *
 * MECHANISM. "... 1 tablespoon of sugar sugar-free maple syrup": the speaker stuttered the modifier (or the
 * dictation doubled it), and the segmenter read the first "sugar" as a food with the amount and left the amount-less
 * "sugar-free maple syrup" as the second item. The line bills 12 g of sugar plus a syrup with no amount. The route maps
 * each item from item.rawText, so the amount has to move INTO the surviving item's rawText.
 *
 * RULE. For each adjacent pair (i, i+1), left to right, fold when ALL hold:
 *  1. neither item has a brand;
 *  2. items[i].rawText starts with an amount word (digit / one..five / half / a / an) and has >= 2 words;
 *  2b. every word of items[i].rawText except the last (X) is an amount, a unit, `of` or an article, and at least one
 *     is a unit word (the left item is AMOUNT [of] X);
 *  3. items[i+1].rawText does NOT start with an amount word;
 *  4. X = the last word of items[i], X.length >= 3, and words(items[i+1]) starts [X, 'free'];
 *  5. the line holds `X X-free` / `X X free` separated by whitespace only (a comma or "and" means two foods).
 * Action: drop item i; item i+1 keeps every field except rawText = items[i].rawText minus its trailing X + ' ' +
 * items[i+1].rawText ("1 tablespoon of" + "sugar-free maple syrup"). After a fold, scanning resumes at the pair after
 * the merged item; folds[].index is the ORIGINAL index of the dropped item.
 * Inherent: "1 teaspoon of sugar sugar free gum" folds too.
 *
 * PASS ORDER. Runs right after resolveSelfCorrections and before dropNegatedParts. The SegmentationCache keeps the
 * unfolded split. A segmenter that dropped the modifier itself (nf "creamer" for "sugar-free creamer") is NOT this row:
 * only rawText is rewritten, normalizedForm is untouched.
 *
 * Pure; never mutates its input (the merged item is a copy).
 */

import { words } from './trailing-quantity-fold';

export interface ModifierStutterFold {
  /** Index in the ORIGINAL input array of the dropped item. */
  index: number;
  rawText: string;
}

interface Item {
  rawText: string;
  brand?: string;
}

const LEAD = /^(?:\d|one\b|two\b|three\b|four\b|five\b|half\b|an?\b)/i;
const AMOUNT_WORD =
  /^(\d[\d/.]*|a|an|one|two|three|four|five|half|of|cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|grams?|g|scoops?|spoons?|spoonfuls?|pinch|dash|splash)$/;
const UNIT_WORD =
  /^(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|grams?|g|scoops?|spoons?|spoonfuls?|pinch|dash|splash)$/;

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Fold "AMOUNT of X" + "X-free Y" into "AMOUNT of X-free Y". Never mutates. */
export function foldModifierStutter<T extends Item>(
  lineKey: string,
  items: T[],
): { items: T[]; folds: ModifierStutterFold[] } {
  const out: T[] = [];
  const folds: ModifierStutterFold[] = [];
  let i = 0;
  while (i < items.length) {
    const a = items[i];
    const b = items[i + 1];
    const merged = b ? tryFold(lineKey, a, b) : null;
    if (merged) {
      out.push(merged);
      folds.push({ index: i, rawText: a.rawText });
      i += 2;
    } else {
      out.push(a);
      i += 1;
    }
  }
  return folds.length ? { items: out, folds } : { items, folds };
}

function tryFold<T extends Item>(lineKey: string, a: T, b: T): T | null {
  if (a.brand || b.brand) return null;
  const left = a.rawText.trim();
  const right = b.rawText.trim();
  if (!LEAD.test(left) || LEAD.test(right)) return null;
  const lw = words(left);
  if (lw.length < 2) return null;
  const x = lw[lw.length - 1];
  const head = lw.slice(0, -1);
  if (!head.every(w => AMOUNT_WORD.test(w)) || !head.some(w => UNIT_WORD.test(w))) return null;
  if (x.length < 3) return null;
  const rw = words(right);
  if (rw[0] !== x || rw[1] !== 'free') return null;
  if (!new RegExp(`\\b${esc(x)}\\s+${esc(x)}[- ]free\\b`).test(lineKey)) return null;
  const stripped = left.replace(new RegExp('\\s+' + esc(x) + '$', 'i'), '');
  if (stripped === left) return null;
  return { ...b, rawText: stripped + ' ' + right };
}
