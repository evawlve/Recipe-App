/**
 * /api/foods/search — the corpus lane's OFF serving label (punch #298).
 *
 * `off_0260664307833` and `off_0200947019732` store `servingSize` as
 * `4 4.0 (112 g)` / `4 1 (112 g)`, and this lane shipped those strings as the
 * option label verbatim. This pins the WIRING: the route runs the label through
 * displayServingLabel(), and an ordinary OFF label passes through unchanged.
 *
 * Harness: route.portion-provenance.test.ts's — `gatherCandidates` mocked,
 * `local=true` so the request goes straight to `runLocalSearch()`.
 */

import { NextRequest } from 'next/server';
import { GET } from './route';

process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass'; // fail-closed route (2026-08-20): the key must come from the env

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

/** An OFF candidate in `mapOffRowToCandidate()`'s shape: no `servings`, the label on `rawData`. */
const offHit = (barcode: string, name: string, servingSize: string, servingGrams: number, score: number) => ({
  id: `off_${barcode}`,
  name,
  brandName: 'Chicken',
  source: 'openfoodfacts',
  score,
  nutrition: { kcal: 190, protein: 20, carbs: 0, fat: 12, per100g: true },
  rawData: {
    barcode,
    name,
    brandName: 'Chicken',
    nutrientsPer100g: { calories: 190, protein: 20, carbs: 0, fat: 12 },
    servingGrams,
    servingSize,
  },
});

const call = (query: string) =>
  GET(
    new NextRequest(
      `http://localhost:3000/api/foods/search?s=${encodeURIComponent(query)}&local=true&api_key=adminAPI_dev_key_bypass`,
    ),
  );

describe('/api/foods/search OFF serving label', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a label whose unit is a second bare number ships as `1 serving (112 g)`', async () => {
    gatherCandidates.mockResolvedValue([
      offHit('0260664307833', 'Rotisserie chicken breast', '4 4.0 (112 g)', 112, 9.2),
      offHit('0200947019732', 'Rotisserie chicken thigh', '4 1 (112 g)', 112, 9.1),
    ]);

    const response = await call('rotisserie chicken');
    expect(response.status).toBe(200);
    const body = await response.json();
    const byId = Object.fromEntries(body.data.map((d: any) => [d.id, d]));

    expect(byId.off_0260664307833.servingOptions).toEqual([{ label: '1 serving (112 g)', grams: 112 }]);
    expect(byId.off_0200947019732.servingOptions).toEqual([{ label: '1 serving (112 g)', grams: 112 }]);
  });

  test('control: an ordinary OFF label ships byte-unchanged', async () => {
    gatherCandidates.mockResolvedValue([
      offHit('1234567890123', 'Rotisserie chicken', '1 container (170 g)', 170, 9.0),
    ]);

    const response = await call('rotisserie chicken');
    expect(response.status).toBe(200);
    const item = (await response.json()).data[0];
    expect(item.servingOptions).toEqual([{ label: '1 container (170 g)', grams: 170 }]);
  });
});
