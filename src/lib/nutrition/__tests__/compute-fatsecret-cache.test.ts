// Mock Prisma
const mockPrisma = {
  ingredient: {
    findMany: jest.fn(),
  },
  fatSecretFoodCache: {
    findMany: jest.fn(),
  },
  userPortionOverride: {
    findMany: jest.fn(),
  },
};

jest.mock('../../db', () => ({
  prisma: mockPrisma,
}));

// Force cache mode helpers to prefer cache regardless of env timing
jest.mock('../../fatsecret/config', () => ({
  FATSECRET_CACHE_MODE: 'dual',
  FATSECRET_CACHE_MODE_HELPERS: { shouldServeCache: true },
}));

jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn(),
  },
}));

describe('computeTotals with FatSecret cache', () => {
  const originalEnv = process.env.FATSECRET_CACHE_MODE;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.FATSECRET_CACHE_MODE = 'dual';
    mockPrisma.fatSecretFoodCache.findMany.mockReset();
    mockPrisma.ingredient.findMany.mockReset();
    mockPrisma.userPortionOverride.findMany.mockReset();
  });

  afterEach(() => {
    process.env.FATSECRET_CACHE_MODE = originalEnv;
  });

  it('prefers FatSecret cache macros when available in dual mode', async () => {
    const now = new Date();
    const legacyFoodId = 'legacy-food-1';
    mockPrisma.fatSecretFoodCache.findMany.mockResolvedValue([
      {
        id: 'fs-1',
        legacyFoodId,
        name: 'Cache Food',
        brandName: null,
        foodType: 'Generic',
        country: null,
        description: null,
        defaultServingId: null,
        source: 'test',
        confidence: 0.9,
        nutrientsPer100g: {
          calories: 200,
          protein: 20,
          carbs: 10,
          fat: 5,
          fiber: 4,
          sugar: 1,
        },
        hash: null,
        syncedAt: now,
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
        servings: [
          {
            id: 'fs-1-serv',
            foodId: 'fs-1',
            measurementDescription: '100 g',
            numberOfUnits: 1,
            metricServingAmount: 100,
            metricServingUnit: 'g',
            servingWeightGrams: 100,
            volumeMl: null,
            isVolume: false,
            isDefault: true,
            derivedViaDensity: false,
            densityEstimateId: null,
            source: 'fatsecret',
            confidence: 1,
            note: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
        aliases: [],
        densityEstimates: [],
      },
    ]);

    mockPrisma.ingredient.findMany.mockResolvedValue([
      {
        id: 'ing-1',
        name: 'Test Ingredient',
        qty: 100,
        unit: 'g',
        foodMaps: [
          {
            isActive: true,
            confidence: 0.9,
            useOnce: false,
            food: {
              id: legacyFoodId,
              name: 'Legacy Food',
              kcal100: 0,
              protein100: 0,
              carbs100: 0,
              fat100: 0,
              fiber100: 0,
              sugar100: 0,
              densityGml: null,
              categoryId: null,
              units: [],
              portionOverrides: [],
            },
          },
        ],
      },
    ]);

    const { computeTotals } = await import('../compute');
    const { logger } = jest.requireMock('../../logger');
    const result = await computeTotals('recipe-cache');

    expect(result.calories).toBe(200);
    expect(result.proteinG).toBe(20);
    expect(result.carbsG).toBe(10);
    expect(result.fatG).toBe(5);
    expect(result.fiberG).toBe(4);
    expect(result.sugarG).toBe(1);
    expect(logger.info).toHaveBeenCalledWith(
      'fatsecret.nutrition.cache_usage',
      expect.objectContaining({ cacheHits: 1 }),
    );
  });

  it('falls back to legacy macros when cache is missing and logs miss', async () => {
    const { computeTotals } = await import('../compute');
    const { logger } = jest.requireMock('../../logger');
    mockPrisma.fatSecretFoodCache.findMany.mockResolvedValue([]); // cache miss

    mockPrisma.ingredient.findMany.mockResolvedValue([
      {
        id: 'ing-1',
        name: 'Legacy Only',
        qty: 50,
        unit: 'g',
        foodMaps: [
          {
            isActive: true,
            confidence: 0.9,
            useOnce: false,
            food: {
              id: 'legacy-2',
              name: 'Legacy Food',
              kcal100: 400,
              protein100: 40,
              carbs100: 20,
              fat100: 10,
              fiber100: 5,
              sugar100: 2,
              densityGml: null,
              categoryId: null,
              units: [],
              portionOverrides: [],
            },
          },
        ],
      },
    ]);

    const result = await computeTotals('recipe-cache-miss');

    expect(result.calories).toBe(200); // 50% of per-100g
    expect(result.proteinG).toBe(20);
    expect(result.carbsG).toBe(10);
    expect(result.fatG).toBe(5);
    expect(result.fiberG).toBe(2.5);
    expect(result.sugarG).toBe(1);
    expect(logger.info).toHaveBeenCalledWith(
      'fatsecret.nutrition.cache_usage',
      expect.objectContaining({ cacheMisses: 1 }),
    );
  });
});
