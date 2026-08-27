import { convertMass, gramsFromVolume } from './unit-graph';
import { resolveDensityWithSource } from './density';

export type ServingOption = { label: string; grams: number };

/**
 * The portions a food may honestly be offered in.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO, both removed 2026-08-27 after a
 * TestFlight report on build 7 ("Some of these serving options are just
 * insanely wrong, perhaps we just get rid of them?"): Quaker White Cheddar Rice
 * Cakes — a record whose own data is `1 cake` = 11 g — was offered thirteen
 * chips including `1 cup`, and `1 cup` × 4 billed 3,927 kcal.
 *
 * 1. IT NO LONGER EMITS `½ X` AND `2 × X` FOR EVERY UNIT. Every surface that
 *    renders these also renders a quantity control beside them, so the halves
 *    and doubles were a second, worse spelling of a multiplier the user already
 *    had — and a worse one, because `½ 1 cake` reads as a serving the food
 *    declares rather than as arithmetic we did. They also fed
 *    `resolveGramsFromParsed()`, which matches a label by parsing a quantity
 *    prefix off it, so they were three candidate labels per real unit competing
 *    to answer one typed count.
 *
 * 2. IT NO LONGER DERIVES VOLUMES OFF A DENSITY NOBODY MEASURED. The volume
 *    branch used to fire whenever `resolveDensityGml()` returned > 0, and that
 *    function's last clause is a flat 1.0 g/ml `fallback`. Its companion
 *    `getDensityMessage()` already described that value as "using generic
 *    estimate (may be inaccurate)" — the code knew it was guessing and rendered
 *    the guess as a tappable choice anyway.
 *
 *    The cut is at the SOURCE of the density, not its value: `known` (the food
 *    carries one) and `calculated` (derived from a serving that declares both
 *    grams and ml) are measurements of THIS food and keep their cups; `category`
 *    (a keyword guess off the name) and `fallback` do not. That is why this
 *    function now calls `resolveDensityWithSource()` rather than
 *    `resolveDensityGml()` — the value alone cannot tell you which it was.
 *
 *    Note where that bites hardest: `resolve-payload.ts`, which builds the parse
 *    response the logging screen renders, passes `densityGml: null` AND
 *    `categoryId: null` at both of its call sites. So on the parse lane the old
 *    branch resolved to the 1.0 fallback for EVERY food, and a cup of rice cakes
 *    was priced as a cup of water. `foods/search`, `foods/[id]` and
 *    `resolve-ingredient` pass the food's real `densityGml`/`categoryId`, so
 *    those keep every volume a measurement supports.
 *
 * A category-derived density is still trusted for CONVERSION elsewhere (see
 * `DRY_GRANULE_DENSITY_CATEGORIES` in `./density`, which gates exactly that).
 * This function is a different question — not "how heavy is a cup of this" but
 * "should we put a cup in front of someone as a thing this food comes in" — and
 * a keyword match on a product name is not enough to answer the second.
 */
export function deriveServingOptions(food: {
  units?: Array<{ label: string; grams: number }>;
  densityGml?: number | null;
  categoryId?: string | null;
}): ServingOption[] {
  const opts: ServingOption[] = [];

  // 1) The food's own units, as the food declares them. No halves, no doubles —
  //    the quantity control is the multiplier.
  for (const u of food.units ?? []) {
    opts.push({ label: u.label, grams: u.grams });
  }

  // 2) Generic mass units (always valid — a gram is a gram)
  opts.push(
    { label: '100 g', grams: 100 },
    { label: '1 oz', grams: convertMass(1, 'oz', 'g') },
    { label: '4 oz', grams: convertMass(4, 'oz', 'g') },
  );

  // 3) Derived volumes — only off a density this food actually supports.
  const densitySource = resolveDensityWithSource(
    food.densityGml ?? undefined,
    food.categoryId ?? null,
  );
  if (
    (densitySource.type === 'known' || densitySource.type === 'calculated') &&
    densitySource.value > 0
  ) {
    const density = densitySource.value;
    const gPerTbsp = gramsFromVolume(1, 'tbsp', density);
    const gPerTsp  = gramsFromVolume(1, 'tsp',  density);
    const gPerCup  = gramsFromVolume(1, 'cup',  density);
    opts.push(
      { label: '1 tbsp', grams: gPerTbsp },
      { label: '1 tsp',  grams: gPerTsp  },
      { label: '¼ cup',  grams: gPerCup / 4 },
      { label: '1 cup',  grams: gPerCup  },
    );
  }

  // de-dup labels
  const seen = new Set<string>();
  return opts.filter(o => (seen.has(o.label) ? false : (seen.add(o.label), true)));
}
