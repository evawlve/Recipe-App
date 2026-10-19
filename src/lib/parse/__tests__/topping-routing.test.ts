import { isPourOntoSecondFood, resolveLoosePourMeasures, restoreLeadingPour } from '../loose-measures';

const NEW_WORDS = [
  'spoonful', 'teaspoonful', 'tablespoonful', 'sprinkle', 'dollop', 'pat', 'smear', 'dash', 'pinch',
  'dab', 'knob', 'squirt', 'squeeze', 'swirl',
];

describe('isPourOntoSecondFood - topping routing class', () => {
  test.each([
    'a spoonful of jam on toast',
    'a sprinkle of parmesan on spaghetti',
    'a dollop of sour cream on chili',
    'a pat of butter on toast',
    'a smear of cream cheese on bagel',
    'a dash of hot sauce on eggs',
    '2 squirts of sriracha on rice',
    'a drizzle of honey on toast',
    'a splash of syrup on pancakes',
  ])('true: %s', line => {
    expect(isPourOntoSecondFood(line)).toBe(true);
  });

  test.each([
    'a knob of butter in pan',
    'a pinch of salt in the pot',
    'a pat of butter in cooking',
    'a scoop of protein in shake',
    'a spoonful of jam',
    'a sprinkle of parmesan',
    'a spoonful of jam on the side',
    'a smear of cream cheese on a bagel',
  ])('false: %s', line => {
    expect(isPourOntoSecondFood(line)).toBe(false);
  });
});

describe('resolveLoosePourMeasures - liquid-only rewrite is untouched', () => {
  test.each(NEW_WORDS)('a %s of jam is unchanged', word => {
    const line = `a ${word} of jam`;
    expect(resolveLoosePourMeasures(line)).toBe(line);
    expect(resolveLoosePourMeasures(`2 ${word}s of jam`)).toBe(`2 ${word}s of jam`);
  });
  test('a drizzle still rewrites', () => {
    expect(resolveLoosePourMeasures('a drizzle of honey')).toBe('0.5 floz of honey');
  });
});

describe('restoreLeadingPour - topping class', () => {
  const mk = (...t: string[]) => t.map(rawText => ({ rawText }));
  test('restores the measure on the topping and strips the preposition on the second food', () => {
    const r = restoreLeadingPour('a spoonful of jam on toast', mk('jam', 'on toast'));
    expect(r.items.map(i => i.rawText)).toEqual(['a spoonful of jam', 'toast']);
  });
  test('never touches an in-n-out brand item', () => {
    const items = mk('splash of milk', 'in n out burger');
    const r = restoreLeadingPour('a splash of milk in my coffee', items);
    expect(r.items[1].rawText).toBe('in n out burger');
  });
  test('restores the first item, leaves the second unchanged', () => {
    const r = restoreLeadingPour('a sprinkle of parmesan on spaghetti', mk('parmesan', 'spaghetti'));
    expect(r.items.map(i => i.rawText)).toEqual(['a sprinkle of parmesan', 'spaghetti']);
  });
  test('on the border queso is never stripped', () => {
    const r = restoreLeadingPour('a dash of hot sauce on my chili', mk('hot sauce', 'on the border queso'));
    expect(r.items[1].rawText).toBe('on the border queso');
  });
});
