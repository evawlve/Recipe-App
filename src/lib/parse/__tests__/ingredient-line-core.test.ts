/**
 * S1.6: Core parser test suite (25 deterministic cases)
 * Table-driven tests covering all parser behaviors from S1.1, S1.2, S1.3
 */

import { parseIngredientLine } from '../ingredient-line';

describe('S1.6: Core Parser Test Suite', () => {
  describe('Fractions & Ranges (5 cases)', () => {
    test.each([
      {
        input: '2½ cups flour',
        expected: { qty: 2.5, unit: 'cup', name: 'flour' },
        description: '2½ cups flour → qty: 2.5, unit: cup, name: flour'
      },
      {
        input: '½ cup oats',
        expected: { qty: 0.5, unit: 'cup', name: 'oats' },
        description: '½ cup oats → qty: 0.5, unit: cup, name: oats'
      },
      {
        input: '1 ½ cup milk',
        expected: { qty: 1.5, unit: 'cup', name: 'milk' },
        description: '1 ½ cup milk → qty: 1.5, unit: cup, name: milk (space variant)'
      },
      {
        input: '1½-2 tsp vanilla extract',
        expected: { qty: 1.75, unit: 'tsp', name: 'vanilla extract' },
        description: '1½-2 tsp vanilla extract → qty: 1.75, unit: tsp, name: vanilla extract'
      },
      {
        input: '2–3 large eggs',
        expected: { qty: 2.5, qualifiers: ['large'], name: 'eggs' },
        description: '2–3 large eggs → qty: 2.5, qualifiers: [large], name: eggs (en-dash)'
      }
    ])('$description', ({ input, expected }) => {
      const p = parseIngredientLine(input)!;
      expect(p).not.toBeNull();
      expect(p.qty).toBeCloseTo(expected.qty);
      if (expected.unit) {
        expect(p.unit).toBe(expected.unit);
      }
      if (expected.qualifiers) {
        expect(p.qualifiers).toEqual(expected.qualifiers);
      }
      expect(p.name).toBe(expected.name);
    });
  });

  describe('Piece-like Hints (5 cases)', () => {
    test.each([
      {
        input: '2 egg yolks',
        expected: { qty: 2, unitHint: 'yolk', name: 'egg' },
        description: '2 egg yolks → unitHint: yolk, name: egg'
      },
      {
        input: '3 egg whites',
        expected: { qty: 3, unitHint: 'white', name: 'egg' },
        description: '3 egg whites → unitHint: white, name: egg'
      },
      {
        input: '5 romaine leaves',
        expected: { qty: 5, unitHint: 'leaf', name: 'romaine' },
        description: '5 romaine leaves → unitHint: leaf, name: romaine'
      },
      {
        input: '2 cloves garlic',
        expected: { qty: 2, unitHint: 'clove', name: 'garlic' },
        description: '2 cloves garlic → unitHint: clove, name: garlic'
      },
      {
        input: '1 sheet nori',
        expected: { qty: 1, unitHint: 'sheet', name: 'nori' },
        description: '1 sheet nori → unitHint: sheet, name: nori'
      }
    ])('$description', ({ input, expected }) => {
      const p = parseIngredientLine(input)!;
      expect(p).not.toBeNull();
      expect(p.qty).toBeCloseTo(expected.qty);
      expect(p.unitHint).toBe(expected.unitHint);
      expect(p.name).toBe(expected.name);
    });
  });

  describe('Qualifiers (5 cases)', () => {
    test.each([
      {
        input: '3 large boneless skinless chicken breasts',
        expected: { qty: 3, qualifiers: ['large', 'boneless', 'skinless'], name: 'chicken breasts' },
        description: '3 large boneless skinless chicken breasts → qualifiers: [large, boneless, skinless]'
      },
      {
        input: '1 cup onion (diced)',
        expected: { qty: 1, unit: 'cup', qualifiers: ['diced'], name: 'onion' },
        description: '1 cup onion (diced) → qualifiers: [diced]'
      },
      {
        input: '1/2 cup cilantro, finely chopped',
        expected: { qty: 0.5, unit: 'cup', qualifiers: ['finely chopped'], name: 'cilantro' },
        description: '1/2 cup cilantro, finely chopped → qty: 0.5, unit: cup, qualifiers: [finely chopped]'
      },
      {
        input: '1 cup, packed, brown sugar',
        expected: { qty: 1, unit: 'cup', qualifiers: ['packed'], name: 'brown sugar' },
        description: '1 cup, packed, brown sugar → unit: cup, qualifiers: [packed], name: brown sugar'
      },
      {
        input: '2 cloves garlic, minced',
        expected: { qty: 2, qualifiers: ['minced'], name: 'garlic' },
        description: '2 cloves garlic, minced → qualifiers: [minced]'
      }
    ])('$description', ({ input, expected }) => {
      const p = parseIngredientLine(input)!;
      expect(p).not.toBeNull();
      expect(p.qty).toBeCloseTo(expected.qty);
      if (expected.unit) {
        expect(p.unit).toBe(expected.unit);
      }
      if (expected.qualifiers) {
        expect(p.qualifiers).toEqual(expected.qualifiers);
      }
      expect(p.name).toBe(expected.name);
    });
  });

  describe('Punctuation & Noise (5 cases)', () => {
    test.each([
      {
        input: '1 (14 oz) can tomatoes',
        expected: { qty: 1, unit: 'can', name: 'tomatoes' },
        description: '1 (14 oz) can tomatoes → Parse correctly',
        flexible: true // Can accept either "can" as unit or part of name
      },
      {
        input: '2 x 200 g chicken',
        expected: { qty: 2, multiplier: 200, unit: 'g', name: 'chicken' },
        description: '2 x 200 g chicken → Handle multiplier correctly'
      },
      {
        input: '2x200g chicken',
        expected: { qty: 2, multiplier: 200, unit: 'g', name: 'chicken' },
        description: '2x200g chicken → Same as above (no space)'
      },
      {
        input: 'pinch of salt',
        expected: { qty: 1, unit: 'pinch', name: 'salt' },
        description: 'pinch of salt → Handle gracefully'
      },
      {
        input: 'to taste salt',
        expected: null,
        description: 'to taste salt → Returns null or low-confidence (no throw)'
      }
    ])('$description', ({ input, expected, flexible }) => {
      const p = parseIngredientLine(input);
      
      if (expected === null) {
        expect(p).toBeNull();
      } else {
        expect(p).not.toBeNull();
        expect(p!.qty).toBeCloseTo(expected.qty);
        if (expected.multiplier) {
          expect(p!.multiplier).toBeCloseTo(expected.multiplier);
        }
        if (expected.unit) {
          if (flexible) {
            // For flexible cases, accept either unit or part of name
            expect(p!.unit === expected.unit || p!.name.includes(expected.name)).toBe(true);
          } else {
            expect(p!.unit).toBe(expected.unit);
          }
        }
        if (expected.name) {
          if (flexible) {
            expect(p!.name).toContain(expected.name);
          } else {
            expect(p!.name).toBe(expected.name);
          }
        }
      }
    });
  });

  describe('Unicode & Edge Cases (5 cases)', () => {
    test.each([
      {
        input: '¼ tsp salt',
        expected: { qty: 0.25, unit: 'tsp', name: 'salt' },
        description: '¼ tsp salt → qty: 0.25, unit: tsp'
      },
      {
        input: '2 ½ tbsp butter',
        expected: { qty: 2.5, unit: 'tbsp', name: 'butter' },
        description: '2 ½ tbsp butter → qty: 2.5, unit: tbsp (thin space)'
      },
      {
        input: '1½–2 cups',
        expected: { qty: 1.75, unit: 'cup', name: '' },
        description: '1½–2 cups → qty: 1.75, unit: cup (dash + fraction combo)',
        flexible: true // Name might be empty or have some text
      },
      {
        input: '',
        expected: null,
        description: 'Empty line → Returns null (no throw)'
      },
      {
        input: '---',
        expected: null,
        description: '--- or emojis → Returns null (no throw)'
      }
    ])('$description', ({ input, expected, flexible }) => {
      const p = parseIngredientLine(input);
      
      if (expected === null) {
        expect(p).toBeNull();
      } else {
        expect(p).not.toBeNull();
        expect(p!.qty).toBeCloseTo(expected.qty);
        if (expected.unit) {
          expect(p!.unit).toBe(expected.unit);
        }
        if (expected.name !== undefined) {
          if (flexible) {
            // For flexible cases, just check that name exists
            expect(typeof p!.name).toBe('string');
          } else {
            expect(p!.name).toBe(expected.name);
          }
        }
      }
    });
  });
});

