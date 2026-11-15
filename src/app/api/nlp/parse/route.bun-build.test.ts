/**
 * /api/nlp/parse - s459 MF-a: a bun-replacing build in an item (`lettuce wrap`, `bunless`, `protein style`) bills as
 * `no bun` through applyComponentSubtraction(); the mapper still sees the line as typed. A winner whose name already says the
 * bun was replaced (`Protein Style`, `Lettuce Wraps`) is skipped `already_removed`. Mocks: route.clause-subtraction.test.ts.
 */


import { NextRequest } from 'next/server';
import { POST } from './route';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: jest.fn() } })),
}));

jest.mock('@/lib/db', () => ({
  prisma: {
    nlpRequestLog: { count: jest.fn(), create: jest.fn(), deleteMany: jest.fn(async () => ({ count: 0 })) },
    mappingEventLog: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  },
}));

jest.mock('@/lib/mapping/map-ingredient-with-fallback', () => ({
  mapIngredientWithFallback: jest.fn(),
}));

jest.mock('@/lib/nlp/resolve-payload', () => ({
  ...jest.requireActual('@/lib/nlp/resolve-payload'),
  resolveFoodDetails: jest.fn(),
}));

const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
const { resolveFoodDetails } = require('@/lib/nlp/resolve-payload');
const { logger } = require('@/lib/logger');

const MAPPED = {
  foodId: 'fs_1', foodName: 'Cheeseburger', brandName: null, source: 'fatsecret', confidence: 0.9,
  servingDescription: '1 burger', grams: 150, kcal: 300, protein: 15, carbs: 30, fat: 15,
};

function details(name: string) {
  return {
    name, brandName: null, source: 'fatsecret',
    nutritionPer100g: { kcal100: 200, protein100: 10, carbs100: 20, fat100: 10, fiber100: 1, sugar100: 1, sodium100: 0.3 },
    servingOptions: [{ label: '1 burger', grams: 150, type: 'count', isDefault: true }],
  };
}

function parseRequest(text: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
    body: JSON.stringify({ text }),
  });
}

async function parseOne(text: string) {
  const response = await POST(parseRequest(text));
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data).toHaveLength(1);
  return data[0];
}

describe('/api/nlp/parse bun-replacing build (s459 MF-a)', () => {
  let audit: jest.SpyInstance;
  const auditsNamed = (name: string) => audit.mock.calls.filter((c: unknown[]) => c[0] === name);

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
    process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass';
    process.env.MAPPING_EVENT_LOG_ENABLED = 'false';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    audit = jest.spyOn(logger, 'audit').mockImplementation(() => undefined);
    jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mapIngredientWithFallback.mockResolvedValue(MAPPED);
    resolveFoodDetails.mockResolvedValue(details('Cheeseburger'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });


  const winner = (foodName: string, brandName: string | null) => {
    resolveFoodDetails.mockResolvedValue(details(foodName));
    mapIngredientWithFallback.mockResolvedValue({ ...MAPPED, foodName, brandName });
  };

  test('burger king whopper lettuce wrap on Whopper / Burger King: mapper sees the line as typed, the bun is subtracted', async () => {
    winner('Whopper', 'Burger King');
    const item = await parseOne('burger king whopper lettuce wrap');
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
    expect(mapIngredientWithFallback.mock.calls[0][0]).toBe('burger king whopper lettuce wrap');
    expect(item.adjustments.map((a: { component: string }) => a.component)).toEqual(['bun']);
    expect(item.nutrition.calories).toBeCloseTo(180, 0);
    expect(auditsNamed('nlp_parse.clause_subtraction')).toEqual([[
      'nlp_parse.clause_subtraction',
      { head: 'burger king whopper lettuce wrap', clause: 'no bun', subtracted: ['bun'], partSkips: [], skipped: null },
    ]]);
  });

  test('a whopper no bun on Whopper / Burger King: the item grammar feeds bun, a chain winner carries it', async () => {
    winner('Whopper', 'Burger King');
    const item = await parseOne('a whopper no bun');
    expect(item.adjustments[0].component).toBe('bun');
  });

  test('in-n-out cheeseburger protein style on the published Protein Style record: already_removed', async () => {
    winner('Cheeseburger with Onion Protein Style (Bun replaced with Lettuce)', 'In-N-Out');
    const item = await parseOne('in-n-out cheeseburger protein style');
    expect('adjustments' in item).toBe(false);
    expect(item.nutrition.calories).toBe(300);
    expect(auditsNamed('nlp_parse.clause_subtraction')[0][1].skipped).toBe('already_removed');
  });

  test("pf changs chicken lettuce wraps (a dish) on Chicken Lettuce Wraps: already_removed, bill unchanged", async () => {
    winner('Chicken Lettuce Wraps', "P.F. Chang's");
    const item = await parseOne('pf changs chicken lettuce wraps');
    expect('adjustments' in item).toBe(false);
    expect(auditsNamed('nlp_parse.clause_subtraction')[0][1].skipped).toBe('already_removed');
  });

  test('a five guys hamburger (no build): no clause audit', async () => {
    winner('Hamburger', 'Five Guys');
    const item = await parseOne('a five guys hamburger');
    expect('adjustments' in item).toBe(false);
    expect(auditsNamed('nlp_parse.clause_subtraction')).toHaveLength(0);
  });
});
