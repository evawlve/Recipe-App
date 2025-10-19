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

describe('Provisional Totals Demo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('demo: recipe with mixed confidence mappings', async () => {
    // Simulate a recipe with:
    // - 1 high confidence mapping (flour, 100g, 364 cal)
    // - 1 low confidence mapping (oil, 50g, 400 cal) 
    // - 1 unmapped ingredient
    mockPrisma.ingredient.findMany.mockResolvedValue([
      {
        id: 'ing1',
        name: 'flour',
        qty: 100,
        unit: 'g',
        foodMaps: [
          {
            confidence: 0.8, // High confidence
            useOnce: false,
            food: {
              calories: 364,
              proteinG: 10,
              carbsG: 76,
              fatG: 1,
              fiberG: 3,
              sugarG: 1
            }
          }
        ]
      },
      {
        id: 'ing2',
        name: 'olive oil',
        qty: 50,
        unit: 'g',
        foodMaps: [
          {
            confidence: 0.3, // Low confidence
            useOnce: false,
            food: {
              calories: 800, // 800 * 0.5 = 400 calories
              proteinG: 0,
              carbsG: 0,
              fatG: 100,
              fiberG: 0,
              sugarG: 0
            }
          }
        ]
      },
      {
        id: 'ing3',
        name: 'unmapped spice',
        qty: 5,
        unit: 'g',
        foodMaps: [] // No mappings
      }
    ]);

    const result = await computeTotals('recipe-123');

    console.log('=== Provisional Totals Demo ===');
    console.log('Recipe: Mixed confidence mappings');
    console.log('Total calories:', result.calories);
    console.log('Provisional:', result.provisional.provisional);
    console.log('Reasons:', result.provisional.provisionalReasons);
    console.log('Unmapped count:', result.unmappedCount);
    console.log('Low confidence share:', result.lowConfidenceShare);
    
    // Total calories: 364 + 400 = 764
    // Low confidence calories: 400 (from oil)
    // Share: 400/764 = 0.524 = 52.4% > 30%
    // Plus 1 unmapped ingredient
    expect(result.provisional.provisional).toBe(true);
    expect(result.provisional.provisionalReasons).toContain('1 unmapped ingredient');
    expect(result.provisional.provisionalReasons).toContain('52% from low-confidence mappings');
    expect(result.unmappedCount).toBe(1);
    expect(result.lowConfidenceShare).toBeCloseTo(0.524, 2);
  });

  test('demo: recipe with use-once mappings', async () => {
    // Simulate a recipe with use-once mappings
    mockPrisma.ingredient.findMany.mockResolvedValue([
      {
        id: 'ing1',
        name: 'flour',
        qty: 200,
        unit: 'g',
        foodMaps: [
          {
            confidence: 0.9, // High confidence
            useOnce: false,
            food: {
              calories: 364, // 364 * 2 = 728 calories
              proteinG: 10,
              carbsG: 76,
              fatG: 1,
              fiberG: 3,
              sugarG: 1
            }
          }
        ]
      },
      {
        id: 'ing2',
        name: 'oil',
        qty: 100,
        unit: 'g',
        foodMaps: [
          {
            confidence: 0.8, // High confidence
            useOnce: true, // Use-once mapping
            food: {
              calories: 800, // 800 * 1 = 800 calories
              proteinG: 0,
              carbsG: 0,
              fatG: 100,
              fiberG: 0,
              sugarG: 0
            }
          }
        ]
      }
    ]);

    const result = await computeTotals('recipe-123');

    console.log('=== Use-Once Demo ===');
    console.log('Recipe: Use-once mappings');
    console.log('Total calories:', result.calories);
    console.log('Provisional:', result.provisional.provisional);
    console.log('Reasons:', result.provisional.provisionalReasons);
    console.log('Low confidence share:', result.lowConfidenceShare);
    
    // Total calories: 728 + 800 = 1528
    // Low confidence calories: 800 (from use-once oil)
    // Share: 800/1528 = 0.524 = 52.4% > 30%
    expect(result.provisional.provisional).toBe(true);
    expect(result.provisional.provisionalReasons).toContain('52% from low-confidence mappings');
    expect(result.unmappedCount).toBe(0);
    expect(result.lowConfidenceShare).toBeCloseTo(0.524, 2);
  });

  test('demo: high confidence recipe is not provisional', async () => {
    // Simulate a recipe with all high confidence mappings
    mockPrisma.ingredient.findMany.mockResolvedValue([
      {
        id: 'ing1',
        name: 'flour',
        qty: 100,
        unit: 'g',
        foodMaps: [
          {
            confidence: 0.9, // High confidence
            useOnce: false,
            food: {
              calories: 364,
              proteinG: 10,
              carbsG: 76,
              fatG: 1,
              fiberG: 3,
              sugarG: 1
            }
          }
        ]
      },
      {
        id: 'ing2',
        name: 'butter',
        qty: 50,
        unit: 'g',
        foodMaps: [
          {
            confidence: 0.8, // High confidence
            useOnce: false,
            food: {
              calories: 400, // 400 * 0.5 = 200 calories
              proteinG: 0,
              carbsG: 0,
              fatG: 50,
              fiberG: 0,
              sugarG: 0
            }
          }
        ]
      }
    ]);

    const result = await computeTotals('recipe-123');

    console.log('=== High Confidence Demo ===');
    console.log('Recipe: All high confidence');
    console.log('Total calories:', result.calories);
    console.log('Provisional:', result.provisional.provisional);
    console.log('Reasons:', result.provisional.provisionalReasons);
    console.log('Low confidence share:', result.lowConfidenceShare);
    
    // Total calories: 364 + 200 = 564
    // Low confidence calories: 0 (all high confidence)
    // Share: 0/564 = 0% < 30%
    expect(result.provisional.provisional).toBe(false);
    expect(result.provisional.provisionalReasons).toEqual([]);
    expect(result.unmappedCount).toBe(0);
    expect(result.lowConfidenceShare).toBe(0);
  });
});
