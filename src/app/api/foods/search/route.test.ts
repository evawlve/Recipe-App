import { NextRequest } from 'next/server';
import { GET } from './route';

// Mock Prisma
jest.mock('@/lib/db', () => ({
  prisma: {
    food: {
      findMany: jest.fn(),
    },
  },
}));

// Mock logger
jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
  },
}));

describe('/api/foods/search', () => {
  const { prisma } = require('@/lib/db');
  const { logger } = require('@/lib/logger');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should return foods with servingOptions for olive oil', async () => {
    // Mock olive oil data
    const mockOliveOil = {
      id: 'seed_olive_oil',
      name: 'Olive Oil',
      brand: null,
      categoryId: 'oil',
      source: 'template',
      verification: 'verified',
      densityGml: 0.91,
      kcal100: 884,
      protein100: 0,
      carbs100: 0,
      fat100: 100,
      fiber100: 0,
      sugar100: 0,
      popularity: 100,
      units: [
        { label: '1 tbsp', grams: 13.6 }
      ]
    };

    prisma.food.findMany.mockResolvedValue([mockOliveOil]);

    const request = new NextRequest('http://localhost:3000/api/foods/search?s=olive');
    const response = await GET(request);
    
    expect(response.status).toBe(200);
    const data = await response.json();
    
    expect(data.success).toBe(true);
    expect(data.data).toHaveLength(1);
    
    const item = data.data[0];
    expect(item.id).toBe('seed_olive_oil');
    expect(item.name).toBe('Olive Oil');
    expect(item.servingOptions).toBeDefined();
    
    // Check confidence exists and is reasonable
    expect(item.confidence).toBeDefined();
    expect(item.confidence).toBeGreaterThan(0);
    expect(item.confidence).toBeLessThanOrEqual(1);
    
    // Check serving options include expected labels
    const labels = item.servingOptions.map((o: any) => o.label);
    expect(labels).toEqual(expect.arrayContaining(['100 g', '1 oz', '1 tbsp']));
    
    // Check 1 tbsp has correct grams for oil density
    const tbsp = item.servingOptions.find((o: any) => o.label === '1 tbsp');
    expect(tbsp).toBeDefined();
    expect(tbsp.grams).toBeGreaterThan(13);
    expect(tbsp.grams).toBeLessThan(14.5);
    
    // Check structured logging was called
    expect(logger.info).toHaveBeenCalledWith('mapping_v2', {
      feature: 'mapping_v2',
      step: 'search_rank',
      q: 'olive',
      resultCount: expect.any(Number),
      topId: 'seed_olive_oil',
      topConfidence: expect.any(Number)
    });
  });

  test('should return 400 for short query', async () => {
    const request = new NextRequest('http://localhost:3000/api/foods/search?s=a');
    const response = await GET(request);
    
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Search query must be at least 2 characters');
  });

  test('should return empty array when no foods found', async () => {
    prisma.food.findMany.mockResolvedValue([]);

    const request = new NextRequest('http://localhost:3000/api/foods/search?s=nonexistent');
    const response = await GET(request);
    
    expect(response.status).toBe(200);
    const data = await response.json();
    
    expect(data.success).toBe(true);
    expect(data.data).toEqual([]);
  });
});
