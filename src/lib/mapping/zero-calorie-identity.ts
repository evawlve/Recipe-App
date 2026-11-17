/**
 * The zero-calorie identity: a food NAME that is plain water or ice bills 0 kcal and maps to no record.
 *
 * Owner of the name list and of the one comparison. The mapper reads it at TWO seats in
 * `map-ingredient-with-fallback.ts`, with the same whole-name rule at both:
 *   1. `preflightIngredientLine()` (Step 1-WATER), on `baseName` — the parsed name, before any model runs;
 *   2. right after the normalize step, on `normalizedName` — the name the model (or its cached answer) gave —
 *      and only when the user's own line names water or ice (`lineNamesWaterOrIce()`).
 *
 * WHY the second seat (s459 pd-water, MEASURED cold on deploy 44, `1FcoqURbnti8xu8neHcFv`): a line whose
 * plain-water name only appears AFTER normalize never reached the first seat. `un vaso de agua` parses to
 * the name `un vaso de agua` (`vaso` is no unit), the normalizer answers `agua`, and retrieval then picks
 * the only OffFood row named exactly `Agua`, Costa water crackers (OFF 7802215501838, 414 kcal/100 g):
 * 33 g / 137 kcal for a glass of water. `hielo` normalizes to `ice` and retrieval picks OFF 5011035500583
 * `ice` (Silver Pail, 188 kcal/100 g). English `a glass of water` normalizes to `water` and was only right
 * because a FatSecret `Water` record happened to win.
 *
 * WHY the Spanish names: `agua` is an English menu word in `spanish-detect.ts` (`agua fresca`), so a line
 * like `2 tazas de agua` is not a Spanish line, is never translated, and its parsed name `agua` went
 * straight to retrieval (480 g / 1,987 kcal of crackers).
 *
 * The rule stays WHOLE-NAME (the 2026-07-21 anchor: `canned tuna in water` must not bill 0 kcal), so every
 * caloric drink keeps its own name and never matches: `agua de jamaica`, `agua de horchata`, `agua fresca`,
 * `agua de coco`, `agua tonica`, `agua con limon`, `coconut water`, `tonic water`.
 */

/** English names, verbatim from the original Step 1-WATER list (`liquid` covers `100% liquid`, which normalizes to it). */
export const ZERO_CALORIE_INGREDIENTS: readonly string[] = [
    'ice', 'ice cubes', 'crushed ice', 'shaved ice',
    'water', 'tap water', 'cold water', 'hot water', 'warm water', 'ice water', 'iced water',
    'still water', 'sparkling water', 'mineral water', 'spring water', 'carbonated water',
    'filtered water', 'drinking water',
    'liquid',
];

/** Spanish plain water and ice, accent-folded (compared after folding). Unflavoured and unsweetened only. */
export const SPANISH_ZERO_CALORIE_INGREDIENTS: readonly string[] = [
    'agua', 'agua natural', 'agua simple', 'agua pura', 'agua purificada', 'agua potable',
    'agua fria', 'agua helada', 'agua tibia', 'agua caliente', 'agua al tiempo',
    'agua de la llave', 'agua del grifo', 'agua embotellada',
    'agua mineral', 'agua mineral natural', 'agua con gas', 'agua sin gas',
    'agua mineral con gas', 'agua mineral sin gas', 'agua carbonatada', 'agua gasificada',
    'hielo', 'cubos de hielo', 'cubitos de hielo', 'hielo picado',
];

const ZERO_CALORIE_NAMES: ReadonlySet<string> = new Set([...ZERO_CALORIE_INGREDIENTS, ...SPANISH_ZERO_CALORIE_INGREDIENTS]);

/**
 * Lowercase, strip accents, collapse whitespace, and drop a leading `100%`-style prefix
 * (`100% liquid` -> `liquid`, kept from the original check).
 */
export function zeroCalorieNameKey(name: string): string {
    return name
        .normalize('NFD')
        .replace(/\p{Mn}/gu, '')
        .toLowerCase()
        .trim()
        .replace(/^\d+(?:\.\d+)?\s*%\s*/, '')
        .replace(/\s+/g, ' ');
}

/** True when the WHOLE name is plain water or ice. Never a substring or last-word match. */
export function isZeroCalorieName(name: string | null | undefined): boolean {
    if (!name) return false;
    return ZERO_CALORIE_NAMES.has(zeroCalorieNameKey(name));
}

/** A water or ice WORD, English or Spanish, on the folded line (`agua`, `water`, `hielo`, `ice`, and plurals). */
const WATER_OR_ICE_WORD = /\b(?:agua|aguas|water|waters|hielo|hielos|ice)\b/;

/**
 * True when the user's OWN line names water or ice. Seat 2 reads a MODEL answer, not the user's text,
 * so it fires only when both agree: the answer is plain water/ice (isZeroCalorieName) AND the line says
 * water or ice. A model that answers `agua` for `un electrolit`, or `liquid` for `1 packet of liquid iv`,
 * must not bill a caloric drink at 0 kcal (s459 rf-water). Seat 1 reads the parsed name and needs no guard.
 */
export function lineNamesWaterOrIce(line: string | null | undefined): boolean {
    if (!line) return false;
    return WATER_OR_ICE_WORD.test(zeroCalorieNameKey(line));
}
