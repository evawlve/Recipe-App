/**
 * drizzle-pour - C70 flag (2): `drizzle` joins the pour words at 0.5 fl oz (a convention, about 1 tbsp).
 */

import { isPourOntoSecondFood, resolveLoosePourMeasures, splitLeadingPour, restoreLeadingPour } from '../loose-measures';

describe('drizzle pour onto a second food', () => {
  test.each([
    ['a drizzle of honey on toast', true],
    ['a drizzle of olive oil on salad', true],
    ['2 drizzles of syrup on pancakes', true],
    ['a drizzle of caramel over ice cream', true],
    ['a drizzle of honey', false],
    ['a drizzle of olive oil on the side', false],
    ['lemon drizzle cake', false],
    ['a splash of syrup on pancakes', true],
  ])('%s', (line, expected) => {
    expect(isPourOntoSecondFood(line)).toBe(expected);
  });
});

describe('drizzle resolves to floz', () => {
  test.each([
    ['a drizzle of honey', '0.5 floz of honey'],
    ['2 drizzles of syrup', '1 floz of syrup'],
    ['two drizzles of olive oil', '1 floz of olive oil'],
    ['lemon drizzle cake', 'lemon drizzle cake'],
    ['drizzle cake', 'drizzle cake'],
    ['honey drizzle', 'honey drizzle'],
    ['a drizzle', 'a drizzle'],
    ['drizzled honey on toast', 'drizzled honey on toast'],
  ])('%s', (line, out) => {
    expect(resolveLoosePourMeasures(line)).toBe(out);
  });
});

describe('drizzle split and restore', () => {
  test('splitLeadingPour singularises drizzles', () => {
    expect(splitLeadingPour('a drizzle of honey on toast')).toEqual({ count: 1, word: 'drizzle', rest: 'honey on toast' });
    expect(splitLeadingPour('2 drizzles of syrup')).toEqual({ count: 2, word: 'drizzle', rest: 'syrup' });
  });
  test('restoreLeadingPour puts the pour back on the liquid', () => {
    const r = restoreLeadingPour('a drizzle of honey on toast', [{ rawText: 'honey' }, { rawText: 'toast' }]);
    expect(r.restored).toBe(1);
    expect(r.items[0].rawText).toBe('a drizzle of honey');
    expect(r.items[1].rawText).toBe('toast');
  });
});
