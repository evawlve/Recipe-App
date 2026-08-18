/**
 * Positional leading-hedge strip in parseIngredientLine().
 *
 * A prose log puts a hedge IN FRONT of the quantity ("about 1 cup of egg
 * whites", "roughly 2 tbsp olive oil"). Every arm of parseQuantityTokens()
 * reads tokens[0], so the hedge cost the line its quantity and unit (name became
 * "about 1 cup of") and the mapper spent a `parse` model call recovering what
 * the line already said. The strip is positional (mergedTokens[0] only) and
 * number-gated (the owner, parseQuantityTokens, must recognise what follows), so
 * a hedged line parses EXACTLY as its un-hedged form and nothing else moves.
 *
 * Owner: mobile sync-docs/reports/2026-08-17_the-prose-log-is-clean-at-the-split-and-lost-at-the-portion.md §2.
 * Doc-check claim: hedge-strip-is-positional.
 */

import { parseIngredientLine } from '../ingredient-line';

/** Hedged line must parse byte-identically to the same line without the hedge. */
function expectParity(hedged: string, unhedged: string) {
  const h = parseIngredientLine(hedged);
  const u = parseIngredientLine(unhedged);
  expect(h).not.toBeNull();
  expect(u).not.toBeNull();
  expect(h).toEqual(u);
  return h!;
}

describe('leading hedge before a quantity is stripped (tripwires — RED on the pre-fix tree)', () => {
  test('"about 1 cup egg whites" -> qty 1, unit cup, name "egg" (the doc-check claim input)', () => {
    const r = parseIngredientLine('about 1 cup egg whites')!;
    expect(r.qty).toBe(1);
    expect(r.unit).toBe('cup');
    expect(r.name).toBe('egg');
    expect(r.unitHint).toBe('white');
    expect(r.name.toLowerCase()).not.toContain('about');
  });

  test('"about 1 cup of egg whites" -> qty 1, unit cup, name without the hedge, parity with the un-hedged form', () => {
    // The name is asserted by PARITY, not literal: what "1 cup of egg whites"
    // yields today is what the rest of the pipeline already expects, and this
    // strip must add nothing to it. (Today that name still carries the
    // partitive "of" — a separate, pre-existing shape this file does not own.)
    const r = expectParity('about 1 cup of egg whites', '1 cup of egg whites');
    expect(r.qty).toBe(1);
    expect(r.unit).toBe('cup');
    expect(r.name.toLowerCase()).not.toContain('about');
    expect(r.name.toLowerCase()).not.toContain('cup');
  });

  test('"roughly 2 tbsp olive oil" -> qty 2, unit tbsp, name "olive oil"; `roughly` is NOT captured as a qualifier', () => {
    const r = expectParity('roughly 2 tbsp olive oil', '2 tbsp olive oil');
    expect(r.qty).toBe(2);
    expect(r.unit).toBe('tbsp');
    expect(r.name).toBe('olive oil');
    expect(r.qualifiers).toBeUndefined();
  });

  test('"approximately half a cup of rice" -> qty 0.5, parity with "half a cup of rice"', () => {
    // The fraction grammar does NOT read "half a cup" as 0.5 cup on either tree
    // (parseQuantityTokens consumes "half"; the article "a" then blocks the
    // unit), so unit is not asserted here — only that the hedge no longer
    // hides the quantity. Documented limitation, not owned by this strip.
    const r = expectParity('approximately half a cup of rice', 'half a cup of rice');
    expect(r.qty).toBe(0.5);
    expect(r.name.toLowerCase()).not.toContain('approximately');
  });

  test('"like 3 eggs" -> like + number strips: qty 3, unit egg', () => {
    const r = expectParity('like 3 eggs', '3 eggs');
    expect(r.qty).toBe(3);
    expect(r.unit).toBe('egg');
    expect(r.name).toBe('eggs');
  });

  test.each([
    ['around 1 cup cooked pasta', '1 cup cooked pasta', 1, 'cup'],
    ['nearly 2 cups milk', '2 cups milk', 2, 'cup'],
    ['almost 1 banana', '1 banana', 1, null],
    ['maybe 2 slices bread', '2 slices bread', 2, 'slice'],
    ['approx 100 g chicken', '100 g chicken', 100, 'g'],
    ['about ½ cup milk', '½ cup milk', 0.5, 'cup'],
    ['about 2-3 eggs', '2-3 eggs', 2.5, 'egg'],
    ['about a dozen eggs', 'a dozen eggs', 12, 'egg'],
    ['about two eggs', 'two eggs', 2, 'egg'],
    ['About 1 cup egg whites', '1 cup egg whites', 1, 'cup'],
  ])('%s parses as %s (every hedge, every quantity grammar the owner knows)', (hedged, unhedged, qty, unit) => {
    const r = expectParity(hedged, unhedged);
    expect(r.qty).toBe(qty);
    expect(r.unit).toBe(unit);
  });
});

describe('controls — green on both trees', () => {
  test('"about time seasoning": no number follows, name unchanged', () => {
    const r = parseIngredientLine('about time seasoning')!;
    expect(r.qty).toBe(1);
    expect(r.unit).toBeNull();
    expect(r.name).toBe('about time seasoning');
  });

  test('"like eggs": like + no number does NOT strip', () => {
    const r = parseIngredientLine('like eggs')!;
    expect(r.qty).toBe(1);
    expect(r.name).toBe('like eggs');
  });

  test('"a couple of eggs" -> qty 2 (word-number grammar untouched)', () => {
    const r = parseIngredientLine('a couple of eggs')!;
    expect(r.qty).toBe(2);
    expect(r.name).toBe('eggs');
  });

  test('"dried apricots" unchanged (doc-check claim qualifier-strip-precedes-normalization input)', () => {
    const r = parseIngredientLine('dried apricots')!;
    expect(r.qty).toBe(1);
    expect(r.unit).toBeNull();
    expect(r.name).toBe('apricots');
    expect(r.qualifiers).toEqual(['dried']);
  });

  test('"roughly chopped onion": `roughly` stays a qualifier when no number follows', () => {
    const r = parseIngredientLine('roughly chopped onion')!;
    expect(r.qty).toBe(1);
    expect(r.name).toBe('onion');
    expect(r.qualifiers).toEqual(['roughly chopped']);
  });

  test('"about egg noodles" / "about whole milk": no number, the hedge is left where it was', () => {
    expect(parseIngredientLine('about egg noodles')!.name).toBe('about egg noodles');
    const r = parseIngredientLine('about whole milk')!;
    expect(r.name).toBe('about milk');
    expect(r.qualifiers).toEqual(['whole']);
  });

  test('a hedge in the MIDDLE of a line is not touched (positional, not global)', () => {
    const r = parseIngredientLine('2 cups about time seasoning')!;
    expect(r.qty).toBe(2);
    expect(r.unit).toBe('cup');
    expect(r.name).toBe('about time seasoning');
  });

  test('un-hedged lines are byte-identical to before: "1 cup egg whites", "2 tbsp olive oil", "3 eggs"', () => {
    expect(parseIngredientLine('1 cup egg whites')).toMatchObject({ qty: 1, unit: 'cup', name: 'egg', unitHint: 'white' });
    expect(parseIngredientLine('2 tbsp olive oil')).toMatchObject({ qty: 2, unit: 'tbsp', name: 'olive oil' });
    expect(parseIngredientLine('3 eggs')).toMatchObject({ qty: 3, unit: 'egg', name: 'eggs' });
  });
});
