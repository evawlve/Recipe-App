/**
 * The partitive "of" must not survive into `parsed.name`.
 *
 * parseIngredientLine() consumes the unit token at several independent sites
 * and only TWO of them skipped the "of" that follows it, so "1 cup of milk"
 * came back as name "of milk". That name is not cosmetic — it is the search
 * query and the cache key:
 *
 *   preflightIngredientLine() (map-ingredient-with-fallback.ts) sets
 *     baseName = options.normalizedForm?.trim() || parsed?.name?.trim() || preProcessLine
 *   and feeds it to normalizeIngredientName() -> gatherCandidates(); and
 *   canonicalizeCacheKey() (normalization-rules.ts) sorts and singularises with
 *   NO stopword list, so "of bacon" becomes the key "bacon of" — a different
 *   FoodMapping row from "bacon". Measured live forks at the time of the fix:
 *   "bacon of" (usedCount 31), "garlic of", "of rosemary".
 *
 *   "1 cup of water" additionally arrived at preflight as "of water" and so
 *   missed the zero-calorie fast path, a whole-string
 *   ZERO_CALORIE_INGREDIENTS.includes(baseName) test.
 *
 * These tests assert the SYMPTOM (the resulting name, plus that qty/unit are
 * still right), not the internal branch that produced it.
 *
 * Orphaned-key repoint plan: scripts/eval/partitive-forked-keys.md.
 */

import { parseIngredientLine } from '../ingredient-line';

/** name/unit/qty triple, the shape every assertion below reads. */
function parsed(line: string) {
  const p = parseIngredientLine(line);
  expect(p).not.toBeNull();
  return { qty: p!.qty, unit: p!.unit, name: p!.name };
}

describe('partitive "of" is not left in the name (RED on the pre-fix tree)', () => {
  test.each([
    // <qty> <mass|volume unit> of <food>
    ['1 cup of milk', 1, 'cup', 'milk'],
    ['4 oz of chicken breast', 4, 'oz', 'chicken breast'],
    ['2 tbsp of olive oil', 2, 'tbsp', 'olive oil'],
    // <qty> <count unit> of <food>
    ['three slices of bacon', 3, 'slice', 'bacon'],
    ['1 sprig of rosemary', 1, 'sprig', 'rosemary'],
    ['1 bag of chips', 1, 'bag', 'chips'],
    // <article> <unit> of <food> — the article blocked unit parsing entirely
    ['a slice of texas toast', 1, 'slice', 'texas toast'],
    ['a handful of almonds', 1, 'handful', 'almonds'],
    ['a bowl of oatmeal', 1, 'bowl', 'oatmeal'],
    ['a tbsp of peanut butter', 1, 'tbsp', 'peanut butter'],
    ['a can of soup', 1, 'can', 'soup'],
    ['an ounce of cheese', 1, 'oz', 'cheese'],
    ['a piece of chicken', 1, 'piece', 'chicken'],
    // "half"/"quarter" multiplier branch
    ['1 half cup of milk', 1, 'cup', 'milk'],
    // "x" multiplier branch
    ['2 x 200 g of flour', 2, 'g', 'flour'],
    // package multiplier resolves to a mass unit, then the mass branch runs
    ['1/2 (12 oz) package of bacon', 6, 'oz', 'bacon'],
    ['2 (15 oz) cans of beans', 30, 'oz', 'beans'],
  ])('%s -> qty %s, unit %s, name "%s"', (line, qty, unit, name) => {
    expect(parsed(line as string)).toEqual({ qty, unit, name });
  });

  test('"1 half of onion" — multiplier branch with no unit still drops the partitive', () => {
    const r = parsed('1 half of onion');
    expect(r.name).toBe('onion');
  });

  test('unit-HINT words take a partitive too: "2 cloves of garlic" (the live "garlic of" fork)', () => {
    // The hint word is deliberately NOT consumed as a unit (extractUnitHint owns
    // it), so the "of" has to be dropped from the token stream rather than
    // stepped over. Symptom: name is the food alone, hint still recovered.
    expect(parseIngredientLine('2 cloves of garlic')).toMatchObject({ qty: 2, name: 'garlic', unitHint: 'clove' });
    expect(parseIngredientLine('3 leaves of basil')).toMatchObject({ qty: 3, name: 'basil', unitHint: 'leaf' });
    expect(parseIngredientLine('2 stalks of celery')).toMatchObject({ qty: 2, name: 'celery', unitHint: 'stalk' });
  });

  test('no leaked name in this file still contains a bare "of" token', () => {
    const lines = [
      '1 cup of milk', '4 oz of chicken breast', 'three slices of bacon', 'a slice of texas toast',
      'a handful of almonds', 'a bowl of oatmeal', 'a tbsp of peanut butter', '2 cloves of garlic',
      '1 sprig of rosemary', '2 x 200 g of flour', '1/2 (12 oz) package of bacon', '1 cup of water',
    ];
    for (const line of lines) {
      expect(parseIngredientLine(line)!.name.split(/\s+/)).not.toContain('of');
    }
  });

  test('"1 cup of water" reaches preflight as the bare zero-calorie name', () => {
    // Whole-string ZERO_CALORIE_INGREDIENTS.includes(baseName) — "of water" missed it.
    expect(parsed('1 cup of water')).toEqual({ qty: 1, unit: 'cup', name: 'water' });
  });
});

describe('guards — at most ONE "of", and only when a token follows', () => {
  test('"1 cup of cream of wheat": the measure\'s "of" goes, the food\'s "of" stays', () => {
    expect(parsed('1 cup of cream of wheat')).toEqual({ qty: 1, unit: 'cup', name: 'cream of wheat' });
  });

  test('"2 slices of": nothing follows the partitive, so it is left exactly where it was', () => {
    // A truncated line has no food in it; skipping here would empty the name.
    expect(parsed('2 slices of')).toEqual({ qty: 2, unit: 'slice', name: 'of' });
  });
});

describe('negative controls — byte-identical to the pre-fix tree', () => {
  test('already-clean partitive shapes are unchanged', () => {
    expect(parsed('pinch of salt')).toEqual({ qty: 1, unit: 'pinch', name: 'salt' });     // no qty
    expect(parsed('1 knob of butter')).toEqual({ qty: 1, unit: 'knob', name: 'butter' }); // unknown-unit branch
    expect(parsed('a couple of eggs')).toEqual({ qty: 2, unit: 'egg', name: 'eggs' });    // quantity.ts owns "a couple"
  });

  test('"honey bunches of oats": no unit token, so no site fires and the name is whole', () => {
    expect(parsed('honey bunches of oats')).toEqual({ qty: 1, unit: null, name: 'honey bunches of oats' });
  });

  test('food names built on "of" are NOT made worse (they are already mangled — see below)', () => {
    // PRE-EXISTING, NOT OWNED HERE. The unknown-token partitive branch shipped
    // with partitive-unit.test.ts ("1 knob of butter") reads "<unknown> of
    // <food>" as a measure word, so these four are already wrong on master.
    // Pinned at their master values so this change is provably a no-op for them.
    expect(parsed('cream of wheat')).toEqual({ qty: 1, unit: 'cream', name: 'wheat' });
    expect(parsed('leg of lamb')).toEqual({ qty: 1, unit: 'leg', name: 'lamb' });
    expect(parsed('chicken of the sea')).toEqual({ qty: 1, unit: 'chicken', name: 'the sea' });
    expect(parsed('hearts of palm')).toEqual({ qty: 1, unit: 'hearts', name: 'palm' });
  });

  test('"half a cup of rice": article at [1], not [0] — documented limitation, untouched', () => {
    // leading-hedge-strip.test.ts already owns this as an unfixed shape. The
    // article strip is positional (mergedTokens[0] only) so it never sees this.
    expect(parsed('half a cup of rice')).toEqual({ qty: 0.5, unit: null, name: 'a cup of rice' });
  });

  test('the article strip is unit-gated: a non-unit after the article is left alone', () => {
    expect(parsed('an apple')).toEqual({ qty: 1, unit: null, name: 'an apple' });
    expect(parsed('a banana')).toEqual({ qty: 1, unit: null, name: 'a banana' });
    expect(parsed('a dozen eggs')).toEqual({ qty: 12, unit: 'egg', name: 'eggs' }); // quantity.ts owns "a dozen"
  });

  test('unit-less identity lines keep their existing readings', () => {
    expect(parseIngredientLine('whole milk')).toMatchObject({ name: 'milk', qualifiers: ['whole'] });
    expect(parseIngredientLine('egg noodles')).toMatchObject({ name: 'egg noodles' });
    expect(parseIngredientLine('1 cup egg whites')).toMatchObject({ qty: 1, unit: 'cup', name: 'egg', unitHint: 'white' });
  });

  test('unknown tokens without a following "of" are still not units', () => {
    expect(parseIngredientLine('1 organic banana')!.unit).not.toBe('organic');
    expect(parseIngredientLine('5 romaine leaves')!.name).toContain('romaine');
  });
});
