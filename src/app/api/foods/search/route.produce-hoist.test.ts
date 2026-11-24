/**
 * /api/foods/search rule 1 (produce hoist) reads USDA's food category.
 *
 * "onion" used to put fdc "Bagels, plain (includes onion, poppy, sesame)" first: it covers
 * every query token, so the hoist lifted it. USDA files it under Baked Products, so now only
 * Vegetables / Fruits / Spices and Herbs rows are hoisted. The onion powder is the first row.
 *
 * Harness: route.fiber-null.test.ts's — `gatherCandidates` mocked, `local=true`.
 */

import { NextRequest } from 'next/server';
import { GET } from './route';

process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass';

jest.mock('@/lib/db', () => ({
  prisma: { food: { findMany: jest.fn().mockResolvedValue([]) } },
}));

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/mapping/gather-candidates', () => ({
  gatherCandidates: jest.fn(),
}));

jest.mock('@/lib/mapping/cache-search', () => ({
  searchFatSecretCacheFoods: jest.fn().mockResolvedValue([]),
  buildCacheCandidate: jest.fn(),
  buildCacheFoodResponse: jest.fn(),
}));

const { gatherCandidates } = require('@/lib/mapping/gather-candidates');

const row = (id: string, name: string, source: string, score: number, foodCategory?: string) => ({
  id,
  name,
  brandName: null,
  source,
  score,
  nutrition: { kcal: 100, protein: 2, carbs: 20, fat: 1 },
  servings: [{ description: '100 g', grams: 100 }],
  rawData: foodCategory ? { foodCategory } : {},
});

describe('/api/foods/search produce hoist reads the USDA category', () => {
  beforeEach(() => jest.clearAllMocks());

  test('"onion": the bagel is not hoisted, the onion powder is first', async () => {
    gatherCandidates.mockResolvedValue([
      row('fdc_175051', 'Bagels, plain (includes onion, poppy, sesame)', 'fdc', 1.5, 'Baked Products'),
      row('fdc_171327', 'Spices, onion powder', 'fdc', 0.9, 'Spices and Herbs'),
      row('fs_1', 'Onions', 'fatsecret', 1.5),
    ]);
    const response = await GET(
      new NextRequest(
        'http://localhost:3000/api/foods/search?s=onion&local=true&api_key=adminAPI_dev_key_bypass',
      ),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].id).toBe('fdc_171327');
  });

  test('only produce queries pass fdcDepth to the gather', async () => {
    gatherCandidates.mockResolvedValue([]);
    const call = (s: string) =>
      GET(
        new NextRequest(
          `http://localhost:3000/api/foods/search?s=${s}&local=true&api_key=adminAPI_dev_key_bypass`,
        ),
      );
    await call('onion');
    expect(gatherCandidates.mock.calls[0][3].fdcDepth).toBe(100);
    gatherCandidates.mockClear();
    await call('chicken%20breast');
    expect(gatherCandidates.mock.calls[0][3].fdcDepth).toBeUndefined();
  });
});

describe('/api/foods/search serves USDA names as USDA wrote them', () => {
  beforeEach(() => jest.clearAllMocks());
  const call = (s: string) =>
    GET(
      new NextRequest(
        `http://localhost:3000/api/foods/search?s=${s}&local=true&api_key=adminAPI_dev_key_bypass`,
      ),
    );

  test('an fdc row serves rawData.description; a fatsecret row keeps its name', async () => {
    gatherCandidates.mockResolvedValue([
      { ...row('fdc_1', 'raw onions', 'fdc', 1.5, 'Vegetables and Vegetable Products'), rawData: { description: 'Onions, raw', foodCategory: 'Vegetables and Vegetable Products' } },
      row('fs_1', 'Onions', 'fatsecret', 1.4),
    ]);
    const body = await (await call('onion')).json();
    const byId = Object.fromEntries(body.data.map((d: any) => [d.id, d.name]));
    expect(byId.fdc_1).toBe('Onions, raw');
    expect(byId.fs_1).toBe('Onions');
  });

  test('an fdc row with no rawData.description serves c.name', async () => {
    gatherCandidates.mockResolvedValue([row('fdc_2', 'raw onions', 'fdc', 1.5)]);
    const body = await (await call('onion')).json();
    expect(body.data[0].name).toBe('raw onions');
  });
});
