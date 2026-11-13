// Named dishes whose `con` is part of the name, not a joiner. The mask feeds ONLY the MULTI_ITEM_SIGNALS test in
// singleItemFromText(); it never alters rawText, and the six-word count stays on rawText.
// Mobile isShortLine() copies this list and function verbatim.
export const KEPT_DISH_NAMES: readonly string[] = ['arroz con pollo', 'arroz con leche', 'arroz con gandules', 'leche con chocolate',
  'cafe con leche', 'chile con carne', 'chili con carne', 'chile con queso', 'chili con queso', 'salsa con queso', 'fresas con crema'];
const ACCENTS: Partial<Record<string, string>> = { a: '[aá]', e: '[eé]', i: '[ií]', o: '[oó]', u: '[uúü]', n: '[nñ]' };
// `[^\S\n]` = whitespace except a newline: a newline is a MULTI_ITEM_SIGNALS separator, so the mask must never swallow one.
const KEPT_DISH_RE = new RegExp('(^|[^\\p{L}\\p{N}_])(' + KEPT_DISH_NAMES.map(p => p.split(' ')
  .map(w => [...w].map(c => ACCENTS[c] ?? c).join('')).join('[^\\S\\n]+')).join('|') + ')(?![\\p{L}\\p{N}_])', 'giu');
export function maskKeptDishNames(text: string): string {
  return text.replace(KEPT_DISH_RE, (_m: string, pre: string, dish: string) => pre + dish.replace(/[^\S\n]+/g, '_'));
}
