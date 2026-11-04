/**
 * removal-clause.ts - parse `<dish> no|without|minus <part>` ONCE so admission can ignore the removed part.
 *
 * MECHANISM (s444 report section 2, brief s445a). On a brand-detected `no <part>` line `deriveMustHaveTokens()` drops `no` but
 * keeps the removed part as the K2 head noun, so `filterCandidatesByTokens()` hard-rejects every record that does not name it
 * (the base dish the user asked for). `stripSoloRemoval()` in `src/lib/nlp/negated-part-drop.ts` strips only `without` / `minus`
 * on the single path and keeps bare `no` out on purpose (product names). This module is its sibling: the SAME grammar widened to
 * `no`, consumed inside `src/lib/mapping/filter-candidates.ts` (admission only; ranking is untouched).
 *
 * TAIL_STOP / ABSENCE / HEAD_FILLER below are this module's OWN copies of SOLO_TAIL_STOP / SOLO_ABSENCE / SOLO_HEAD_FILLER; a jest
 * pin reads both files as text and asserts they are identical. Pure: no env, no memo, never throws.
 */
import { detectBrandInQuery } from './brand-detector';

export interface RemovalClause {
  head: string;
  removed: string[];
}

const NEG = new Set(['no', 'without', 'minus']);
const HEAD_TRIM = new Set(['with', 'w', 'and', 'but', 'plus']);
const TAIL_DETS = new Set(['the', 'any', 'my', 'a', 'an']);
const TAIL_STOP = new Set([
  'a', 'an', 'one', 'two', 'three', 'four', 'five', 'six', 'half', 'some', 'extra', 'double', 'small', 'medium', 'large',
  'little', 'bit', 'much', 'and', 'or', 'nor', 'but', 'then', 'with', 'plus', 'i', 'it', 'them', 'that',
  'w', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'dozen', 'couple', 'few', 'several', 'pair', 'twice', 'thrice',
  'again', 'x', 'lg', 'sm', 'md', 'reg', 'big', 'huge', 'full', 'whole', 'regular', 'tall', 'grande', 'venti', 'jumbo', 'mini',
  'cup', 'bowl', 'piece', 'slice', 'serving', 'helping', 'plate', 'plateful', 'handful', 'scoop', 'tbsp', 'tsp', 'tablespoon',
  'teaspoon', 'oz', 'ounce', 'gram', 'g', 'ml', 'container', 'portion', 'glass', 'mug', 'can', 'bottle', 'bag', 'box', 'packet',
  'spoonful', 'pint', 'quart', 'liter', 'lb', 'pound',
]);
const ABSENCE = /^(?:added )?(?:sugars?|salt|sodium|fat|calories?|carbs?|caffeine|alcohol|gluten|lactose|yolks?|meat|skin|dairy|breading)$/;
const HEAD_FILLER = new Set([
  'a', 'an', 'the', 'one', 'two', 'three', 'some', 'my', 'half', 'just', 'only', 'i', 'had', 'ate', 'have', 'of',
]);

// Plural-folded like the sibling's soloStop.
const isStop = (w: string): boolean =>
  TAIL_STOP.has(w) || (/(?:es|s)$/.test(w) && (TAIL_STOP.has(w.replace(/es$/, '')) || TAIL_STOP.has(w.replace(/s$/, ''))));
// F6a: a part that STARTS with an absence noun is an identity claim (`no sugar added jam`), not a removed part.
const startsWithAbsence = (p: string[]): boolean => ABSENCE.test(p[0]) || ABSENCE.test(p[0].replace(/(?:es|s)$/, ''));
const ABSENCE_WORDS = new Set(['added', 'free', 'reduced', 'low']);
const clean = (t: string): string => t.toLowerCase().replace(/[^a-z0-9']+/g, '');
const fold = (w: string): string => w.replace(/s$/, '');

/** The tail's parts, or null when the tail is not a plain 1-4 word removed part (shared by the name and the raw line). */
function tailParts(tail: string[]): string[][] | null {
  let t = tail;
  if (t.length > 1 && TAIL_DETS.has(t[0])) t = t.slice(1);
  if (t.length < 1 || t.length > 4) return null;
  const parts = t.join(' ').split(/ (?:or|nor) /).map(p => p.split(' ').filter(Boolean));
  if (parts.some(p => p.length < 1 || p.length > 3)) return null;
  if (parts.some(p => p.some(w => isStop(w) || /\d/.test(w)))) return null;
  if (parts.some(p => ABSENCE.test(p.join(' ')) || startsWithAbsence(p))) return null;
  if (t.some(w => ABSENCE_WORDS.has(w))) return null;
  return parts;
}

export function parseRemovalClause(name: string, rawLine?: string): RemovalClause {
  const noop: RemovalClause = { head: name, removed: [] };
  const raw = name.toLowerCase().split(/\s+/).filter(Boolean);
  const lw = raw.map(clean);
  const at = lw.flatMap((w, k) => (NEG.has(w) ? [k] : []));
  if (at.length !== 1 || at[0] === 0) return noop;
  const k = at[0];
  const negator = lw[k];

  let headToks = raw.slice(0, k);
  if (headToks.length > 0 && HEAD_TRIM.has(clean(headToks[headToks.length - 1]))) headToks = headToks.slice(0, -1);
  const head = headToks.join(' ').replace(/[\s,;:(-]+$/, '');
  const headWords = head.split(/\s+/).map(clean).filter(Boolean);
  if (!headWords.some(w => !HEAD_FILLER.has(w) && !/^[\d/.]+$/.test(w))) return noop;

  const tailToks = lw.slice(k + 1).filter(Boolean);
  const parts = tailParts(tailToks);
  if (!parts) return noop;

  // F6c: a part wholly named by the head (`egg mcmuffin no egg`, `cheeseburger no cheese`) is no removal.
  const covered = (w: string): boolean => headWords.some(h => h === w || fold(h) === fold(w) || (w.length >= 4 && h.startsWith(w)));
  if (parts.some(p => p.every(covered))) return noop;

  // F6b: the raw line must carry the same negator + tail, with nothing else after it (`pizza no extra cheese`).
  if (rawLine !== undefined) {
    const rl = ' ' + rawLine.toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim() + ' ';
    const needle = ` ${negator} ${tailToks.join(' ')}`;
    const i = rl.indexOf(needle + ' ');
    if (i < 0) return noop;
    const rawTail = rl.slice(i + 1 + negator.length).trim().split(' ').filter(Boolean);
    if (!tailParts(rawTail)) return noop;
  }

  // Only after the grammar matched: a brand whose name carries the negator (`no name`) is a product, not a removal.
  const brand = detectBrandInQuery(name).matchedBrand;
  if (brand && brand.toLowerCase().split(/\s+/).some(w => NEG.has(w))) return noop;

  return { head, removed: parts.flat() };
}
