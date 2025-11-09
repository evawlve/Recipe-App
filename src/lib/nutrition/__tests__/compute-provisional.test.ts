// Mock Prisma
const mockPrisma = {
  ingredient: {
    findMany: jest.fn()
  }
};

jest.mock('../../db', () => ({
  prisma: mockPrisma
}));

import { computeTotals } from '../compute';

// Mock logger
jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn()
  }
}));

const macroFood = (
  kcal: number,
  macros: {
    protein?: number;
    carbs?: number;
    fat?: number;
    fiber?: number;
    sugar?: number;
  }
) => ({
  kcal100: kcal,
  protein100: macros.protein ?? 0,
  carbs100: macros.carbs ?? 0,
  fat100: macros.fat ?? 0,
  fiber100: macros.fiber ?? 0,
  sugar100: macros.sugar ?? 0,
  calories: kcal,
  proteinG: macros.protein ?? 0,
  carbsG: macros.carbs ?? 0,
  fatG: macros.fat ?? 0,
  fiberG: macros.fiber ?? 0,
  sugarG: macros.sugar ?? 0
});

describe('Provisional tracking in computeTotals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('unmapped ingredients make totals provisional', async () => {
    mockPrisma.ingredient.findMany.mockResolvedValue([
      {
        id: 'ing1',
        name: 'flour',
        qty: 100,
        unit: 'g',
        foodMaps: [
          {
            confidence: 0.8,
            useOnce: false,
          food: macroFood(364, {
            protein: 10,
            carbs: 76,
            fat: 1,
            fiber: 3,
            sugar: 1
          })
          }
        ]
      },
      {
        id: 'ing2',
        name: 'unmapped ingredient',
        qty: 50,
        unit: 'g',
        foodMaps: [] // No mappings
      }
    ]);

    const result = await computeTotals('recipe-123');

    expect(result.provisional.provisional).toBe(true);
    expect(result.provisional.provisionalReasons).toContain('1 unmapped ingredient');
    expect(result.unmappedCount).toBe(1);
  });

  test('use-once mappings with ≥30% calories make totals provisional', async () => {
    mockPrisma.ingredient.findMany.mockResolvedValue([
      {
        id: 'ing1',
        name: 'flour',
        qty: 100,
        unit: 'g',
        foodMaps: [
          {
            confidence: 0.8,
            useOnce: false,
          food: macroFood(100, {
            protein: 10,
            carbs: 20,
            fat: 1,
            fiber: 3,
            sugar: 1
          }) // Low calorie food
          }
        ]
      },
      {
        id: 'ing2',
        name: 'oil',
        qty: 50,
        unit: 'g',
        foodMaps: [
          {
            confidence: 0.9,
            useOnce: true, // Use-once mapping
          food: macroFood(800, {
            fat: 100
          }) // High calorie food (800 * 0.5 = 400 calories)
          }
        ]
      }
    ]);

    const result = await computeTotals('recipe-123');

    // Total calories: 100 + 400 = 500
    // Low confidence calories: 400 (from use-once oil)
    // Share: 400/500 = 0.8 = 80% > 30%
    expect(result.provisional.provisional).toBe(true);
    expect(result.provisional.provisionalReasons).toContain('80% from low-confidence mappings');
    expect(result.unmappedCount).toBe(0);
  });

  test('low confidence mappings with ≥30% calories make totals provisional', async () => {
    mockPrisma.ingredient.findMany.mockResolvedValue([
      {
        id: 'ing1',
        name: 'flour',
        qty: 100,
        unit: 'g',
        foodMaps: [
          {
            confidence: 0.8,
            useOnce: false,
          food: macroFood(100, {
            protein: 10,
            carbs: 20,
            fat: 1,
            fiber: 3,
            sugar: 1
          }) // Low calorie food
          }
        ]
      },
      {
        id: 'ing2',
        name: 'oil',
        qty: 50,
        unit: 'g',
        foodMaps: [
          {
            confidence: 0.3, // Low confidence
            useOnce: false,
          food: macroFood(800, {
            fat: 100
          }) // High calorie food (800 * 0.5 = 400 calories)
          }
        ]
      }
    ]);

    const result = await computeTotals('recipe-123');

    // Total calories: 100 + 400 = 500
    // Low confidence calories: 400 (from low confidence oil)
    // Share: 400/500 = 0.8 = 80% > 30%
    expect(result.provisional.provisional).toBe(true);
    expect(result.provisional.provisionalReasons).toContain('80% from low-confidence mappings');
    expect(result.unmappedCount).toBe(0);
  });

  test('high confidence mappings with no unmapped ingredients are not provisional', async () => {
    mockPrisma.ingredient.findMany.mockResolvedValue([
      {
        id: 'ing1',
        name: 'flour',
        qty: 100,
        unit: 'g',
        foodMaps: [
          {
            confidence: 0.8,
            useOnce: false,
          food: macroFood(364, {
            protein: 10,
            carbs: 76,
            fat: 1,
            fiber: 3,
            sugar: 1
          })
          }
        ]
      },
      {
        id: 'ing2',
        name: 'oil',
        qty: 50,
        unit: 'g',
        foodMaps: [
          {
            confidence: 0.9,
            useOnce: false,
          food: macroFood(400, {
            fat: 50
          })
          }
        ]
      }
    ]);

    const result = await computeTotals('recipe-123');

    expect(result.provisional.provisional).toBe(false);
    expect(result.provisional.provisionalReasons).toEqual([]);
    expect(result.unmappedCount).toBe(0);
  });

  test('low confidence share below 30% is not provisional', async () => {
    mockPrisma.ingredient.findMany.mockResolvedValue([
      {
        id: 'ing1',
        name: 'flour',
        qty: 100,
        unit: 'g',
        foodMaps: [
          {
            confidence: 0.8,
            useOnce: false,
          food: macroFood(800, {
            protein: 10,
            carbs: 76,
            fat: 1,
            fiber: 3,
            sugar: 1
          }) // High calorie food
          }
        ]
      },
      {
        id: 'ing2',
        name: 'oil',
        qty: 10, // Small amount
        unit: 'g',
        foodMaps: [
          {
            confidence: 0.3, // Low confidence
            useOnce: false,
          food: macroFood(800, {
            fat: 100
          }) // High calorie food (800 * 0.1 = 80 calories)
          }
        ]
      }
    ]);

    const result = await computeTotals('recipe-123');

    // Total calories: 800 + 80 = 880
    // Low confidence calories: 80 (from low confidence oil)
    // Share: 80/880 = 0.091 = 9.1% < 30%
    expect(result.provisional.provisional).toBe(false);
    expect(result.provisional.provisionalReasons).toEqual([]);
    expect(result.unmappedCount).toBe(0);
  });

  test('multiple reasons are combined', async () => {
    mockPrisma.ingredient.findMany.mockResolvedValue([
      {
        id: 'ing1',
        name: 'flour',
        qty: 100,
        unit: 'g',
        foodMaps: [
          {
            confidence: 0.3, // Low confidence
            useOnce: false,
          food: macroFood(800, {
            protein: 10,
            carbs: 76,
            fat: 1,
            fiber: 3,
            sugar: 1
          }) // High calorie food
          }
        ]
      },
      {
        id: 'ing2',
        name: 'unmapped ingredient',
        qty: 50,
        unit: 'g',
        foodMaps: [] // No mappings
      }
    ]);

    const result = await computeTotals('recipe-123');

    expect(result.provisional.provisional).toBe(true);
    expect(result.provisional.provisionalReasons).toContain('1 unmapped ingredient');
    expect(result.provisional.provisionalReasons).toContain('100% from low-confidence mappings');
    expect(result.unmappedCount).toBe(1);
  });

  test('empty recipe with no ingredients is provisional', async () => {
    mockPrisma.ingredient.findMany.mockResolvedValue([]);

    const result = await computeTotals('recipe-123');

    expect(result.provisional.provisional).toBe(false); // No ingredients = no provisional
    expect(result.provisional.provisionalReasons).toEqual([]);
    expect(result.unmappedCount).toBe(0);
  });
});
