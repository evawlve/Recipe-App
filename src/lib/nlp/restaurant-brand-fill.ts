/**
 * restaurant-brand-fill - a restaurant's brand fills the later dishes of one logged line (S192 row 5, F2).
 *
 * "a chick-fil-a spicy chicken sandwich, waffle fries and a lemonade": the segmenter brands item 1 but
 * leaves items 2+ with brand ''. When item 1's brand is a known restaurant chain, every later item with
 * no brand of its own receives item 1's brand, copied as typed. Pure and deterministic: no prompt edit,
 * no version bump, no mapper edit. The route calls it AFTER the negated-part drop and the trailing-
 * quantity fold (the drop's guards skip a BRANDED item, so fill-first would bill `no pickles` under
 * chick-fil-a); the segmentation cache keeps the unfilled split.
 *
 * A fifth brand list - the parse route's own, read by `self-correction.ts` and, since s453 row C, by
 * `brandReassertEvidence()` in `mapping/quantity-word-brand.ts` (a dropped chain brand is put back). It is deliberately NOT
 * `filter-candidates.ts`'s list, which also drives `queryTargetsCandidateBrand()`.
 * `cracker barrel` is NOT listed: Cracker Barrel cheese is a grocery brand, and a fill would give an
 * apple logged beside it the restaurant's brand. For the same reason `starbucks`, `dunkin` and `panera`
 * are NOT listed (Diego, 2026-10-16): each also sells packaged grocery products (`starbucks doubleshot`),
 * and a fill turned the banana logged beside one into Starbucks banana bread. Dropping them costs carry
 * (364 -> 337 of 387 on the round-1 draws); a wrong food is worse than a missing brand.
 *
 * s459 row RC added 21 top-US chains on that rule read strictly: OffFood holds no packaged retail product under
 * the chain's spelling (a row outside the `Brand, Item` menu form, brandName read 2026-11-15). Left out for that
 * reason: whataburger (ketchup, mayo, pancake mix), steak n shake (frozen steakburgers, chili), denny's (pancake
 * mix; Henry Denny & Sons' Irish meats share the spelling), red robin (frozen fries), del taco (frozen
 * quesadillas), bojangles, zaxby's, dairy queen and papa john's (bottled sauces; `Papa John's Salads & Produce`
 * is another company), ihop, krispy kreme, tim hortons, cheesecake factory, p.f. chang's, red lobster,
 * tgi fridays, white castle, nathan's, cinnabon, texas roadhouse, buffalo wild wings, on the border, dutch bros,
 * jamba, smoothie king, auntie anne's, checkers, waffle house. The entries above this comment's s459 block
 * were not re-read on this rule (taco bell, olive garden, chick-fil-a, arby's, sonic and wendy's each have such
 * rows). Bare `culver` is not listed (`Culver Duck`). `jersey mike's` waited on the fill guard below (a
 * full-day line led by a sub filled olive oil, avocado and rice) and joined in s459 row JM. Membership gates four
 * things: this fill, the self-correction brand carry, the `restaurant_chain` brand re-assert, and the chain-topping subtraction (RM-b, and RM-d's
 * `hold the` / `sin`). A bare initialism (`dq`, `bk`) is not listed.
 *
 * s459 row FG, the measured-line guard: a line that measures ANY later food by weight or volume (`4 oz ground beef`,
 * `1 tbsp olive oil`, `1 cup rice`, `8 oz of milk`) is a home log, not a restaurant order, and gets no fill at all.
 * Chain sides are ordered by count or size (`medium fries`, `8 count`, `a serving of`), never by the tablespoon. Without
 * it, `taco bell crunchy taco shells, 4 oz ground beef and shredded cheddar` billed an AI-minted "Taco Bell Ground Beef"
 * and "Taco Bell Cheddar Crisps", and a Subway line billed `1 tbsp olive oil` as "Subway, Avocado". Line-level, not
 * per-item: an unmeasured home food beside a measured one (`a banana` before `8 oz of milk`) is filled too otherwise
 * (it billed "Taco Bell, Breakfast Soft Taco"). The measure is `parseIngredientLine()`'s own unit, classed by
 * `normalizeUnitToken()`: `mass` or `volume`; a count unit (`slice`, `serving`, `medium`) is not a measure. Item 1 is
 * not read (a chain steak is weighed: `outback 8 oz sirloin`).
 * A measured DRINK neither blocks nor fills: a chain sells a drink by its cup size (`16 oz coke`, `32 oz diet coke`,
 * `16oz latte`, `a cup of coffee`: an item whose parsed name `resolveVolumeGrams()` classes `beverage`), so the line's
 * sides keep the chain (`mcdonalds big mac, medium fries and a 16 oz coke` keeps "McDonald's Fries, Medium"), while the
 * drink itself maps unbranded (filled, `16 oz coke` billed an AI-minted "McDonald's Coke" and `16oz latte` beside a
 * Chick-fil-A biscuit billed "Chick-fil-A Icedream Cup" 521.6 kcal). Milk, water and juice class `liquid` and still
 * block; a spoon always blocks (`2 tbsp coffee creamer`). Organic SegmentationCache rows this changes: 0 of 457
 * (2026-11-15); the 2 rows the fill fires on keep it. Known cost: a measured chain item after item 1 (`a 12 oz ribeye`
 * after a bloomin onion) loses the brand, and a home food whose line's only measure is a drink (`taco bell
 * crunchwrap supreme, a banana and 16 oz coffee`) is still filled, as it is today.
 */

import { parseIngredientLine } from '../parse/ingredient-line';
import { normalizeUnitToken } from '../parse/unit';
import { resolveVolumeGrams } from '../units/volume-density';

export const RESTAURANT_CHAINS: readonly string[] = [
  'pizza hut', 'dominos', "domino's", 'mcdonald', "mcdonald's", 'burger king', 'wendy', "wendy's",
  'taco bell', 'subway', 'chick-fil-a', 'chick fil a', 'popeyes', "popeye's", 'kfc', 'panda express',
  'chipotle', 'olive garden', 'applebee', "applebee's", "chili's", 'outback',
  'jack in the box', 'arby', "arby's", 'sonic', 'freshii', 'wingstop', 'five guys',
  "raising cane's", 'in-n-out', "portillo's", 'cava',
  // s459 row RC: top-US chains with no packaged retail product under the same name (OffFood brandName read 2026-11-15).
  "carl's jr", "carl's junior", "culver's", 'shake shack', 'little caesar', 'little caesars',
  'jimmy john', "jimmy john's", 'hardee', "hardee's", 'firehouse subs', 'qdoba', 'el pollo loco',
  "church's chicken", 'sweetgreen', 'noodles and company', 'noodles & company', 'longhorn steakhouse',
  "jason's deli", "mcalister's", 'potbelly', 'first watch', 'golden corral', 'crumbl', "moe's southwest",
  "marco's pizza",
  // s459 row JM: Jersey Mike's. OffFood holds 1,723 menu-form rows (`Jersey Mike's Subs, <item>`) and 3 UPC
  // `Hot Chopped Pepper Relish` rows (read 2026-11-15); FatSecret holds menu sides only. The bare `jersey mike`
  // covers the singular spelling (the trailing-s rule strips the INPUT side only).
  "jersey mike's", 'jersey mike',
];

// Apostrophe characters dropped before comparison: ' U+2018 U+2019 and backtick (iOS types U+2019).
const APOSTROPHES = /['‘’`]/g;

function normalise(s: string): string {
  return s.toLowerCase().replace(APOSTROPHES, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

const NORMALISED_CHAINS: ReadonlySet<string> = new Set(RESTAURANT_CHAINS.map(normalise));

export function isRestaurantChain(brand: string): boolean {
  const n = normalise(brand);
  if (!n) return false;
  const singular = n.replace(/s+$/, '');
  for (const r of NORMALISED_CHAINS) {
    if (n === r || n.startsWith(r + ' ') || r === singular) return true;
  }
  return false;
}

/**
 * s459 FG: how an item states its own amount - `food` (a weight or volume: `4 oz`, `1 tbsp`, `1 cup`, `100g`),
 * `drink` (a drink's cup size: `16 oz coke`, `a cup of coffee`; a spoon is never a drink's size), or null (a count,
 * a size word, none). See the header.
 */
export function measuredAs(rawText: string | undefined): 'food' | 'drink' | null {
  if (!rawText?.trim()) return null;
  const parsed = parseIngredientLine(rawText);
  if (!parsed?.unit) return null;
  const kind = normalizeUnitToken(parsed.unit).kind;
  if (kind !== 'mass' && kind !== 'volume') return null;
  if (parsed.unit === 'tbsp' || parsed.unit === 'tsp') return 'food';
  return resolveVolumeGrams(parsed.name).volumeClass === 'beverage' ? 'drink' : 'food';
}

export function fillRestaurantBrand<T extends { brand?: string; rawText?: string }>(
  items: T[],
): { items: T[]; fills: number } {
  const first = items[0]?.brand;
  if (items.length < 2 || !first || !isRestaurantChain(first)) {
    return { items, fills: 0 };
  }
  const measures = items.map(it => measuredAs(it.rawText));
  if (measures.slice(1).includes('food')) {
    return { items, fills: 0 };
  }
  let fills = 0;
  const out = items.map((it, i) => {
    if (i === 0 || (it.brand ?? '').trim() !== '' || measures[i] === 'drink') return it;
    fills++;
    return { ...it, brand: first };
  });
  return { items: out, fills };
}
