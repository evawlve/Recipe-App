/**
 * Unit-letter and container abbreviations (`3 c popcorn`, `2 T peanut butter`).
 * Acceptance is TWIN EQUIVALENCE (the abbreviated line parses exactly like its
 * spelled-out twin), not correctness of the grams the twin later serves.
 */

import { parseIngredientLine } from '../ingredient-line';
import { normalizeUnitToken } from '../unit';
import { expandUnitAbbreviation, UNIT_ABBREVIATION_TARGETS } from '../unit-abbreviations';

const pick = (line: string) => {
  const p = parseIngredientLine(line);
  return p && { qty: p.qty, unit: p.unit, name: p.name, qualifiers: p.qualifiers };
};

describe('abbreviated unit equals its spelled-out twin', () => {
  const twins: Array<[string, string, { qty: number; unit: string; name: string }]> = [
    ['3 c popcorn', '3 cups popcorn', { qty: 3, unit: 'cup', name: 'popcorn' }],
    ['3c popcorn', '3 cups popcorn', { qty: 3, unit: 'cup', name: 'popcorn' }],
    ['1/2 c. cooked rice', '1/2 cup cooked rice', { qty: 0.5, unit: 'cup', name: 'rice' }],
    ['1 C milk', '1 cup milk', { qty: 1, unit: 'cup', name: 'milk' }],
    ['1 t honey', '1 tsp honey', { qty: 1, unit: 'tsp', name: 'honey' }],
    ['2 T peanut butter', '2 tbsp peanut butter', { qty: 2, unit: 'tbsp', name: 'peanut butter' }],
    ['1 T. olive oil', '1 tbsp olive oil', { qty: 1, unit: 'tbsp', name: 'olive oil' }],
    ['2 tbs pb', '2 tbsp pb', { qty: 2, unit: 'tbsp', name: 'pb' }],
    ['1 cn black beans', '1 can black beans', { qty: 1, unit: 'can', name: 'black beans' }],
    ['1 btl water', '1 bottle water', { qty: 1, unit: 'bottle', name: 'water' }],
    ['1 c. of rice', '1 cup of rice', { qty: 1, unit: 'cup', name: 'rice' }],
    ['1 svg tortilla chips', '1 serving tortilla chips', { qty: 1, unit: 'serving', name: 'tortilla chips' }],
    ['2 svgs pasta', '2 servings pasta', { qty: 2, unit: 'serving', name: 'pasta' }],
    ['2 slcs pizza', '2 slices pizza', { qty: 2, unit: 'slice', name: 'pizza' }],
    ['2 ts cinnamon', '2 tsp cinnamon', { qty: 2, unit: 'tsp', name: 'cinnamon' }],
    ['1 bx mac and cheese', '1 box mac and cheese', { qty: 1, unit: 'box', name: 'mac and cheese' }],
    ['1 pkg instant ramen', '1 package instant ramen', { qty: 1, unit: 'package', name: 'instant ramen' }],
    ['2 pkt instant oatmeal', '2 packets instant oatmeal', { qty: 2, unit: 'packet', name: 'instant oatmeal' }],
    ['1 ctn greek yogurt', '1 carton greek yogurt', { qty: 1, unit: 'carton', name: 'greek yogurt' }],
  ];

  test.each(twins)('%s', (abbrev, twin, expected) => {
    expect(pick(abbrev)).toEqual(pick(twin));
    expect(pick(abbrev)).toMatchObject(expected);
  });

  test('the cooked qualifier is stripped from the name, as for the twin', () => {
    expect(pick('1/2 c. cooked rice')!.qualifiers).toEqual(['cooked']);
  });

  test('a hedge in front still reaches the rule', () => {
    expect(pick('about 2 T peanut butter')).toEqual(pick('about 2 tbsp peanut butter'));
    expect(pick('about 2 T peanut butter')).toMatchObject({ qty: 2, unit: 'tbsp' });
  });
});

describe('controls stay as master parses them', () => {
  const unchanged: Array<[string, { qty: number; unit: string | null; name: string }]> = [
    ['vitamin c gummies', { qty: 1, unit: null, name: 'vitamin c gummies' }],
    ['1 t-bone steak', { qty: 1, unit: null, name: 't-bone steak' }],
    ['1 T bone steak', { qty: 1, unit: null, name: 'T bone steak' }],
    ['c popcorn', { qty: 1, unit: null, name: 'c popcorn' }],
    ['1 c', { qty: 1, unit: null, name: 'c' }],
    ['2 c4 energy drinks', { qty: 2, unit: null, name: 'c4 energy drinks' }],
    ['2 c de aceite', { qty: 2, unit: null, name: 'c de aceite' }],
    ['1 cup popcorn', { qty: 1, unit: 'cup', name: 'popcorn' }],
    ['1 tsp honey', { qty: 1, unit: 'tsp', name: 'honey' }],
    ['1 can black beans', { qty: 1, unit: 'can', name: 'black beans' }],
    ['1 bottle water', { qty: 1, unit: 'bottle', name: 'water' }],
    ['1 cnt eggs', { qty: 1, unit: null, name: 'cnt eggs' }],
    ['2 TS cinnamon', { qty: 2, unit: null, name: 'TS cinnamon' }],
    ['1 svg', { qty: 1, unit: null, name: 'svg' }],
    ['2 ts de canela', { qty: 2, unit: null, name: 'ts de canela' }],
    ['svg tortilla chips', { qty: 1, unit: null, name: 'svg tortilla chips' }],
    ['2 tbsp', { qty: 2, unit: 'tbsp', name: 'tbsp' }],
    ['16oz', { qty: 16, unit: 'oz', name: 'oz' }],
    ['1/2cup oats', { qty: 0.5, unit: null, name: 'oats' }],
    ['1 oz. cheddar', { qty: 1, unit: 'oz', name: 'cheddar' }],
    ['1 TBSP maple syrup', { qty: 1, unit: 'tbsp', name: 'maple syrup' }],
    ['1 tsp. sugar', { qty: 1, unit: 'tsp', name: 'sugar' }],
    ['3 tbsps hummus', { qty: 3, unit: 'tbsp', name: 'hummus' }],
    ['2 Tbsp. olive oil', { qty: 2, unit: 'tbsp', name: 'olive oil' }],
    ['.5 cup cottage cheese', { qty: 0.5, unit: 'cup', name: 'cottage cheese' }],
    ['0.25 c walnuts', { qty: 0.25, unit: 'cup', name: 'walnuts' }],
    ['1 ½ cups almond milk', { qty: 1.5, unit: 'cup', name: 'almond milk' }],
    ['1 1/2 tbsp peanut butter', { qty: 1.5, unit: 'tbsp', name: 'peanut butter' }],
    ['1.5c cooked rice', { qty: 1.5, unit: 'cup', name: 'rice', qualifiers: ['cooked'] }],
    ['1 c. OJ', { qty: 1, unit: 'cup', name: 'OJ' }],
  ];

  test.each(unchanged)('%s', (line, expected) => {
    expect(pick(line)).toMatchObject(expected);
  });
});

describe('the table', () => {
  test('case decides T (tbsp) vs t (tsp); c and tbs ignore case', () => {
    expect(expandUnitAbbreviation('T', 'honey')).toBe('tbsp');
    expect(expandUnitAbbreviation('t', 'honey')).toBe('tsp');
    expect(expandUnitAbbreviation('C', 'milk')).toBe('cup');
    expect(expandUnitAbbreviation('TBS', 'pb')).toBe('tbsp');
  });

  test('guards: de/del decline every token, bone declines only T/t', () => {
    expect(expandUnitAbbreviation('c', 'de')).toBeNull();
    expect(expandUnitAbbreviation('tbs', 'del')).toBeNull();
    expect(expandUnitAbbreviation('T', 'bone')).toBeNull();
    expect(expandUnitAbbreviation('c', 'bone')).toBe('cup');
  });

  test('non-members are null', () => {
    for (const t of ['t-bone', 'c4', 'cnt', 'cup', 'tsp', 'x']) {
      expect(expandUnitAbbreviation(t, 'milk')).toBeNull();
    }
  });

  test('every target is a known unit; the letters themselves are not', () => {
    for (const u of UNIT_ABBREVIATION_TARGETS) {
      expect(normalizeUnitToken(u).kind).not.toBe('unknown');
    }
    expect(normalizeUnitToken('t').kind).toBe('unknown');
  });
});
