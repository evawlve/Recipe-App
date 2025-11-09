import { resolvePortion } from '../portion';
import { parseIngredientLine } from '../../parse/ingredient-line';

function baseFood(overrides: Partial<Parameters<typeof resolvePortion>[0]['food']> = {}) {
  return {
    id: 'food_1',
    name: 'Test Food',
    densityGml: undefined,
    categoryId: null,
    units: [],
    portionOverrides: [],
    ...overrides
  };
}

describe('resolvePortion', () => {
  test('prefers direct mass units', () => {
    const parsed = parseIngredientLine('100 g flour');
    const res = resolvePortion({
      food: baseFood(),
      parsed,
      userOverrides: []
    });

    expect(res.source).toBe('direct_mass');
    expect(res.grams).toBeCloseTo(100);
    expect(res.confidence).toBe(1);
  });

  test('uses user overrides before curated overrides', () => {
    const parsed = parseIngredientLine('3 egg whites');
    const res = resolvePortion({
      food: baseFood({
        portionOverrides: [
          { unit: 'white', grams: 33, label: null }
        ]
      }),
      parsed,
      userOverrides: [
        { unit: 'white', grams: 34, label: null }
      ]
    });

    expect(res.source).toBe('user_override');
    expect(res.grams).toBeCloseTo(102); // 3 * 34
    expect(res.confidence).toBe(1);
  });

  test('matches curated overrides with label qualifiers', () => {
    const parsed = parseIngredientLine('2 jumbo eggs');
    const res = resolvePortion({
      food: baseFood({
        portionOverrides: [
          { unit: 'whole', grams: 63, label: 'jumbo' },
          { unit: 'whole', grams: 50, label: 'large' }
        ]
      }),
      parsed,
      userOverrides: []
    });

    expect(res.source).toBe('portion_override');
    expect(res.grams).toBeCloseTo(126); // 2 * 63
    expect(res.matchedLabel).toBe('jumbo');
  });

  test('falls back to food unit labels', () => {
    const parsed = parseIngredientLine('1 cup chicken breast');
    const res = resolvePortion({
      food: baseFood({
        units: [
          { label: '1 slice', grams: 28 },
          { label: '1 cup, diced', grams: 140 }
        ]
      }),
      parsed,
      userOverrides: []
    });

    expect(res.source).toBe('food_unit');
    expect(res.grams).toBeCloseTo(140);
  });

  test('uses density conversion for volume units', () => {
    const parsed = parseIngredientLine('0.5 cup olive oil');
    const res = resolvePortion({
      food: baseFood({
        densityGml: 0.91
      }),
      parsed,
      userOverrides: []
    });

    expect(res.source).toBe('density');
    expect(res.grams).toBeCloseTo(0.5 * 240 * 0.91, 1);
  });

  test('applies heuristics as last resort', () => {
    const parsed = parseIngredientLine('2 cloves garlic');
    const res = resolvePortion({
      food: baseFood(),
      parsed,
      userOverrides: []
    });

    expect(res.source).toBe('heuristic');
    expect(res.grams).toBeCloseTo(6); // 2 * 3g heuristic
  });
});

