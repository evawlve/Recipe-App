import { prisma } from '../../db';
import { logger } from '../../logger';

// Mock Prisma
const mockPrisma = {
  ingredient: {
    findMany: jest.fn(),
  },
  fdcFood: {
    findMany: jest.fn(),
  },
  offFood: {
    findMany: jest.fn(),
  },
  aiGeneratedFood: {
    findMany: jest.fn(),
  },
  userPortionOverride: {
    findMany: jest.fn(),
  },
};

jest.mock('../../db', () => ({
  prisma: mockPrisma,
}));

jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

describe('computeTotals with consolidated tables', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockPrisma.ingredient.findMany.mockReset();
    mockPrisma.fdcFood.findMany.mockReset();
    mockPrisma.offFood.findMany.mockReset();
    mockPrisma.aiGeneratedFood.findMany.mockReset();
    mockPrisma.userPortionOverride.findMany.mockReset();
  });

  it('computes totals using FdcFood when fdcId is present', async () => {
    mockPrisma.ingredient.findMany.mockResolvedValue([
      {
        id: 'ing-1',
        name: 'Test Fdc Ingredient',
        qty: 200,
        unit: 'g',
        foodMaps: [
          {
            isActive: true,
            confidence: 0.9,
            useOnce: false,
            fdcId: 1001,
          },
        ],
      },
    ]);

    mockPrisma.fdcFood.findMany.mockResolvedValue([
      {
        fdcId: 1001,
        description: 'FDC Food Description',
        nutrientsPer100g: {
          calories: 150,
          protein: 10,
          carbs: 5,
          fat: 2,
          fiber: 1,
          sugar: 0.5,
        },
        servings: [],
      },
    ]);

    const { computeTotals } = await import('../compute');
    const result = await computeTotals('recipe-fdc');

    expect(result.calories).toBe(300); // 150 * 2
    expect(result.proteinG).toBe(20);
    expect(result.carbsG).toBe(10);
    expect(result.fatG).toBe(4);
  });

  it('computes totals using OffFood when offBarcode is present', async () => {
    mockPrisma.ingredient.findMany.mockResolvedValue([
      {
        id: 'ing-2',
        name: 'Test Off Ingredient',
        qty: 50,
        unit: 'g',
        foodMaps: [
          {
            isActive: true,
            confidence: 0.85,
            useOnce: false,
            offBarcode: '123456789',
          },
        ],
      },
    ]);

    mockPrisma.offFood.findMany.mockResolvedValue([
      {
        barcode: '123456789',
        name: 'OFF Food Name',
        nutrientsPer100g: {
          calories: 400,
          protein: 20,
          carbs: 40,
          fat: 10,
          fiber: 2,
          sugar: 5,
        },
        servings: [],
      },
    ]);

    const { computeTotals } = await import('../compute');
    const result = await computeTotals('recipe-off');

    expect(result.calories).toBe(200); // 400 * 0.5
    expect(result.proteinG).toBe(10);
    expect(result.carbsG).toBe(20);
    expect(result.fatG).toBe(5);
  });
});

