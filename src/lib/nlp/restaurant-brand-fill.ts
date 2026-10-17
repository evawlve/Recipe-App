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
 * A fifth brand list - the parse route's own, read by nothing else. It is deliberately NOT
 * `filter-candidates.ts`'s list, which also drives `queryTargetsCandidateBrand()`.
 * `cracker barrel` is NOT listed: Cracker Barrel cheese is a grocery brand, and a fill would give an
 * apple logged beside it the restaurant's brand. For the same reason `starbucks`, `dunkin` and `panera`
 * are NOT listed (Diego, 2026-10-16): each also sells packaged grocery products (`starbucks doubleshot`),
 * and a fill turned the banana logged beside one into Starbucks banana bread. Dropping them costs carry
 * (364 -> 337 of 387 on the round-1 draws); a wrong food is worse than a missing brand.
 */

export const RESTAURANT_CHAINS: readonly string[] = [
  'pizza hut', 'dominos', "domino's", 'mcdonald', "mcdonald's", 'burger king', 'wendy', "wendy's",
  'taco bell', 'subway', 'chick-fil-a', 'chick fil a', 'popeyes', "popeye's", 'kfc', 'panda express',
  'chipotle', 'olive garden', 'applebee', "applebee's", "chili's", 'outback',
  'jack in the box', 'arby', "arby's", 'sonic', 'freshii', 'wingstop', 'five guys',
  "raising cane's", 'in-n-out', "portillo's", 'cava',
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

export function fillRestaurantBrand<T extends { brand?: string }>(
  items: T[],
): { items: T[]; fills: number } {
  const first = items[0]?.brand;
  if (items.length < 2 || !first || !isRestaurantChain(first)) {
    return { items, fills: 0 };
  }
  let fills = 0;
  const out = items.map((it, i) => {
    if (i === 0 || (it.brand ?? '').trim() !== '') return it;
    fills++;
    return { ...it, brand: first };
  });
  return { items: out, fills };
}
