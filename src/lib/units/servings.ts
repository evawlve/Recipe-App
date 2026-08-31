import { convertMass, convertVolume, gramsFromVolume } from './unit-graph';
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
 *
 * WHAT IT NOW DOES INSTEAD (2026-08-30, Lane A session 29): when a caller
 * passes a unit that declares BOTH grams and volumeMl — a real measured pair on
 * THIS food's own label, e.g. FatSecret's `1 serving` = 15.45 g / 15 ml on a
 * coffee creamer — spoon rungs are derived by PURE RATIO from that pair (see
 * branch 3b). The food's own g-per-ml cancels out of the arithmetic, so no
 * density is stored, transmitted, or claimed; the `category` and `fallback`
 * density tiers still refuse spoons exactly as rule 2 above cut them. Callers
 * that pass no volumeMl (every OFF path today — OFF's ingest wrote grams ≡ ml,
 * so a ratio from those rows would be the 1.0 fallback laundered as data) get
 * byte-identical output. Owner of the population and the laundering trap:
 * sync-docs/reports/2026-08-30_spoon-options-from-ml-census.md (mobile repo).
 */
export function deriveServingOptions(food: {
  units?: Array<{ label: string; grams: number; volumeMl?: number | null }>;
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
  } else {
    // 3b) Spoon rungs by PURE RATIO from the food's own declared g↔ml pair.
    //
    //    NOT a density tier. The scale factor is `pair.grams / pair.volumeMl`,
    //    both read off the same serving row of THIS food, so the arithmetic is
    //    "what does 14.79 ml of the thing this label weighed cost in grams" —
    //    the g-per-ml never leaves this block and is never persisted or put on
    //    the wire. That is the design Diego proposed for tester report ANBKs2
    //    (a creamer labelled `1 tbsp (15 ml)` offered no spoon chip), and it is
    //    what keeps this branch out of the laundering trap the census names:
    //    an OFF-style assumed 1.0 g/ml fed back in as `calculated` would turn
    //    the fallback tier's refusal into an emission with no new information.
    //
    //    The pair with the SMALLEST volumeMl wins when several qualify (ties by
    //    label): it is deterministic under Prisma's unordered `include`, and
    //    the spoon-scale pair extrapolates least. Larger rungs are emitted only
    //    where the pair itself covers the rung's volume — a `¼ cup` chip backed
    //    by a 100 ml measured pour is interpolation; a `1 cup` chip backed by a
    //    6 ml one would be a 40× extrapolation rendered as a tappable choice.
    let pair: { label: string; grams: number; volumeMl: number } | null = null;
    for (const u of food.units ?? []) {
      if (!(u.grams > 0) || u.volumeMl == null || !(u.volumeMl > 0)) continue;
      if (
        pair === null ||
        u.volumeMl < pair.volumeMl ||
        (u.volumeMl === pair.volumeMl && u.label < pair.label)
      ) {
        pair = { label: u.label, grams: u.grams, volumeMl: u.volumeMl };
      }
    }
    if (pair) {
      const ratio = pair.grams / pair.volumeMl; // this food's own label pair
      opts.push(
        { label: '1 tbsp', grams: gramsFromVolume(1, 'tbsp', ratio) },
        { label: '1 tsp',  grams: gramsFromVolume(1, 'tsp',  ratio) },
      );
      if (pair.volumeMl >= convertVolume(0.25, 'cup', 'ml')) {
        opts.push({ label: '¼ cup', grams: gramsFromVolume(0.25, 'cup', ratio) });
      }
      if (pair.volumeMl >= convertVolume(1, 'cup', 'ml')) {
        opts.push({ label: '1 cup', grams: gramsFromVolume(1, 'cup', ratio) });
      }
    }
  }

  // de-dup labels
  const seen = new Set<string>();
  return opts.filter(o => (seen.has(o.label) ? false : (seen.add(o.label), true)));
}
