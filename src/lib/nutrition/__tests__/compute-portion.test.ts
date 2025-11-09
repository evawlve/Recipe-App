const mockPrisma = {
  ingredient: {
    findMany: jest.fn()
  },
  userPortionOverride: {
    findMany: jest.fn()
  }
};

jest.mock('../../db', () => ({
  prisma: mockPrisma
}));

jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn()
  }
}));

import { computeTotals } from '../compute';

describe('computeTotals portion resolver integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.ingredient.findMany.mockReset();
    mockPrisma.userPortionOverride.findMany.mockReset();
    mockPrisma.userPortionOverride.findMany.mockResolvedValue([]);
  });

  function buildIngredient() {
    return [
      {
        id: 'ing-egg-whites',
        name: 'egg whites',
        qty: 3,
        unit: 'white',
        foodMaps: [
          {
            confidence: 0.9,
            useOnce: false,
            food: {
              id: 'food-egg',
              name: 'Egg, whole, raw, fresh',
              densityGml: null,
              categoryId: null,
              kcal100: 143,
              protein100: 13,
              carbs100: 1,
              fat100: 10,
              fiber100: 0,
              sugar100: 0,
              portionOverrides: [
                { unit: 'white', grams: 33, label: null }
              ],
              units: []
            }
          }
        ]
      }
    ];
  }

  test('uses curated portion overrides when flag enabled', async () => {
    mockPrisma.ingredient.findMany.mockResolvedValue(buildIngredient());

    const result = await computeTotals('recipe-egg', {
      enablePortionV2: true
    });

    expect(mockPrisma.userPortionOverride.findMany).not.toHaveBeenCalled();
    expect(result.calories).toBeGreaterThan(0);
    expect(result.portionStats?.bySource['portion_override']).toBe(1);
    expect(result.portionStats?.resolvedCount).toBe(1);
  });

  test('prefers user overrides when available', async () => {
    mockPrisma.ingredient.findMany.mockResolvedValue(buildIngredient());
    mockPrisma.userPortionOverride.findMany.mockResolvedValue([
      {
        id: 'upo-1',
        userId: 'user-1',
        foodId: 'food-egg',
        unit: 'white',
        grams: 35,
        label: null
      }
    ]);

    const result = await computeTotals('recipe-egg', {
      enablePortionV2: true,
      userId: 'user-1'
    });

    expect(mockPrisma.userPortionOverride.findMany).toHaveBeenCalled();
    expect(result.portionStats?.bySource['user_override']).toBe(1);
    expect(result.portionStats?.resolvedCount).toBe(1);
    // 3 whites * 35g -> 105g -> calories = 1.43 * grams
    expect(result.calories).toBeGreaterThan(0);
  });
});

