import { NextRequest } from 'next/server';
import { POST } from './route';

// Mock Prisma
jest.mock('@/lib/db', () => ({
  prisma: {
    food: {
      create: jest.fn(),
    },
  },
}));

describe('/api/foods/quick-create', () => {
  const { prisma } = require('@/lib/db');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should create food with valid payload', async () => {
    const mockFood = { id: 'new-food-123' };
    prisma.food.create.mockResolvedValue(mockFood);

    const request = new NextRequest('http://localhost:3000/api/foods/quick-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Food',
        brand: 'Test Brand',
        categoryId: 'powder',
        servingLabel: '1 scoop',
        gramsPerServing: 30,
        kcal: 120,
        protein: 20,
        carbs: 5,
        fat: 2,
        fiber: 1,
        sugar: 1,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
    
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.foodId).toBe('new-food-123');
    
    expect(prisma.food.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Test Food',
        brand: 'Test Brand',
        categoryId: 'powder',
        source: 'community',
        verification: 'unverified',
        kcal100: 400, // 120 / 30 * 100
        protein100: expect.closeTo(66.67, 1), // 20 / 30 * 100
        carbs100: expect.closeTo(16.67, 1), // 5 / 30 * 100
        fat100: expect.closeTo(6.67, 1), // 2 / 30 * 100
        fiber100: expect.closeTo(3.33, 1), // 1 / 30 * 100
        sugar100: expect.closeTo(3.33, 1), // 1 / 30 * 100
        createdById: null,
        popularity: 0,
        units: { create: [{ label: '1 scoop', grams: 30 }] },
      }),
      select: { id: true },
    });
  });

  test('should infer grams from servingLabel', async () => {
    const mockFood = { id: 'new-food-456' };
    prisma.food.create.mockResolvedValue(mockFood);

    const request = new NextRequest('http://localhost:3000/api/foods/quick-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Food',
        servingLabel: '100 g',
        kcal: 350,
        protein: 10,
        carbs: 70,
        fat: 5,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
    
    expect(prisma.food.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        units: { create: [{ label: '100 g', grams: 100 }] },
      }),
      select: { id: true },
    });
  });

  test('should return 400 for invalid payload', async () => {
    const request = new NextRequest('http://localhost:3000/api/foods/quick-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'A', // too short
        servingLabel: '1 scoop',
        kcal: 120,
        protein: 20,
        carbs: 5,
        fat: 2,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  });

  test('should return 400 for implausible kcal/100g', async () => {
    const request = new NextRequest('http://localhost:3000/api/foods/quick-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Food',
        servingLabel: '1 g',
        gramsPerServing: 1,
        kcal: 1000, // 1000 kcal per 1g = 100,000 kcal per 100g (implausible but passes Zod)
        protein: 10,
        carbs: 10,
        fat: 10,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(422);
    
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('implausible kcal/100g');
  });

  test('should return 400 when grams cannot be inferred', async () => {
    const request = new NextRequest('http://localhost:3000/api/foods/quick-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Food',
        servingLabel: '1 piece', // no grams specified or inferable
        kcal: 120,
        protein: 20,
        carbs: 5,
        fat: 2,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('gramsPerServing required or inferable from servingLabel (e.g., "100 g")');
  });
});
