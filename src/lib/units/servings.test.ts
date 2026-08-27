import { deriveServingOptions } from './servings';

/**
 * The first test here used to assert `½ 1 scoop` and `2 × 1 scoop` — it PINNED
 * the behaviour removed on 2026-08-27, so it is flipped rather than deleted
 * (same treatment #242 gave the `whole milk` key test): the negative assertion
 * is what stops the halves and doubles coming back by accident.
 */

test('a food-declared unit is offered once — the quantity control is the multiplier', () => {
  const opts = deriveServingOptions({
    units: [{ label: '1 scoop', grams: 32 }],
    densityGml: 0.5, // powder, and MEASURED — so volumes are honest here
    categoryId: 'whey',
  });
  const labels = opts.map(o => o.label);
  expect(labels).toEqual(expect.arrayContaining(['1 scoop', '100 g', '1 oz', '1 tbsp', '1 cup']));
  expect(labels).not.toContain('½ 1 scoop');
  expect(labels).not.toContain('2 × 1 scoop');
});

test('oil category with a declared density produces a correct tbsp serving', () => {
  const opts = deriveServingOptions({
    units: [{ label: '1 tbsp', grams: 13.6 }],
    densityGml: 0.91, // oil density
    categoryId: 'oil',
  });

  const labels = opts.map(o => o.label);
  expect(labels).toEqual(expect.arrayContaining(['100 g', '1 oz', '1 tbsp']));

  // Check 1 tbsp has correct grams for oil density (should be ~13.6g)
  const tbsp = opts.find(o => o.label === '1 tbsp');
  expect(tbsp).toBeDefined();
  expect(tbsp!.grams).toBeGreaterThan(13);
  expect(tbsp!.grams).toBeLessThan(14.5);
});

/**
 * The reported case, verbatim. `fs_96724607` Quaker White Cheddar Rice Cakes
 * carries `1 cake` = 11 g and nothing else; the parse lane passes null for both
 * density and category, so the old code reached its 1.0 g/ml `fallback` and
 * offered a cup of rice cakes priced as a cup of water — 240 g, which at that
 * record's 409 kcal/100 g bills 982 kcal a cup, 3,927 at the quantity of 4 the
 * reporter had set.
 */
test('a food with no measured density is offered no volume', () => {
  const opts = deriveServingOptions({
    units: [{ label: '1 cake', grams: 11 }],
    densityGml: null,
    categoryId: null,
  });
  const labels = opts.map(o => o.label);
  expect(labels).toEqual(['1 cake', '100 g', '1 oz', '4 oz']);
});

/**
 * The cut is at the SOURCE of the density, not its value — a keyword match on a
 * product name ("rice cakes" → category `rice`) is a guess about the food, and
 * this function's question is whether to put a cup in front of someone, not how
 * heavy one would be. `DRY_GRANULE_DENSITY_CATEGORIES` still trusts a category
 * density for CONVERSION; that is a different question and is unchanged.
 */
test('a category-guessed density does not earn a volume option', () => {
  const opts = deriveServingOptions({
    units: [{ label: '1 cake', grams: 11 }],
    densityGml: null,
    categoryId: 'rice', // 0.85 g/ml by keyword, never measured on this food
  });
  expect(opts.map(o => o.label)).not.toContain('1 cup');
});

test('an empty food still offers the mass units', () => {
  expect(deriveServingOptions({}).map(o => o.label)).toEqual(['100 g', '1 oz', '4 oz']);
});
