/**
 * The name /api/foods/search shows for a USDA (fdc) row: the description as USDA wrote it,
 * head noun first ("Onions, raw"), instead of normalizeFdcName()'s "raw onions".
 * Display only: relevance, dedupe and the typo vocabulary keep reading the normalized name.
 *
 * A comma-separated part whose letters are ALL upper case (2+ letters) is Title Cased word by
 * word (a word is a run of non-space characters: first character up, the rest down). Nothing
 * is reordered; the only text dropped is the exact FDP parenthetical. The first character is upper-cased.
 */
function isAllCapsPart(part: string): boolean {
  const letters = part.replace(/[^A-Za-z]/g, '');
  return letters.length >= 2 && letters === letters.toUpperCase();
}

function titleCaseWords(part: string): string {
  return part
    .split(' ')
    .map((w) => (w === '' ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

// USDA appends this one parenthetical to 40 rows (measured 2026-11-24); no other parenthetical is dropped.
const FDP_SUFFIX = /\s*\(Includes foods for USDA's Food Distribution Program\)/;

export function displayFdcName(description: string): string {
  const trimmed = description.replace(FDP_SUFFIX, '').trim();
  if (trimmed === '') return '';
  const out = trimmed
    .split(', ')
    .map((p) => (isAllCapsPart(p) ? titleCaseWords(p) : p))
    .join(', ');
  return out.charAt(0).toUpperCase() + out.slice(1);
}
