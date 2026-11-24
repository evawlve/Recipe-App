/**
 * Do two sources name the same brand for one barcode? Pure. Used by /api/foods/barcode to
 * decide which of FatSecret's and our Open Food Facts row leads when both answer.
 *
 * Mirrors the verdict() of the s465 C5a offline replay: `compact()` has no NFKD step, `toks()`
 * has one, and the stop set is the same, so the replay and the route read the same function.
 */
const STOP = new Set([
  'the', 'inc', 'co', 'company', 'foods', 'food', 'brand', 'brands', 'llc', 'corp', 'and', 'of',
]);

const compact = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const toks = (s: string): string[] =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !STOP.has(t));

/** true = agree, false = disagree, null = cannot tell (either side blank or non-Latin-only). */
export function brandsAgree(a: string | null, b: string | null): boolean | null {
  if (!a || !b) return null;
  const ca = compact(a);
  const cb = compact(b);
  if (!ca || !cb) return null;
  if (ca === cb || ca.includes(cb) || cb.includes(ca)) return true;
  const ta = new Set(toks(a));
  if (toks(b).some((t) => ta.has(t))) return true;
  return false;
}

export interface BarcodeAnswerLite {
  name: string;
  brandName: string | null;
  /** The OffFood row carries a corruptReason: never leads over a FatSecret answer. */
  corrupt?: boolean;
}

/**
 * Which source leads. 'off' over a FatSecret answer only when both name a brand, the brands
 * disagree, and our row is not flagged corrupt. A corrupt row still answers a FatSecret miss.
 */
export function pickBarcodeAnswer(
  fs: BarcodeAnswerLite | null,
  off: BarcodeAnswerLite | null,
): 'fs' | 'off' | null {
  if (fs && off && brandsAgree(fs.brandName, off.brandName) === false && !off.corrupt) return 'off';
  if (fs) return 'fs';
  if (off) return 'off';
  return null;
}
