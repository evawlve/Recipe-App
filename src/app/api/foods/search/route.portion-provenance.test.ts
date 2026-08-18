/**
 * /api/foods/search — the `portionProvenance` wire field on the browse list.
 *
 * The browse lane runs no gram cascade, so the ONLY `servingTier` it can know is
 * the one `recoverMacroOnlyServing()` returns for a FatSecret macro-only record
 * (`fs_serving_macros_only_est`, a BORROWED_OR_DEFAULTED member). This file
 * asserts that such a row ships `portionProvenance: 'borrowed'` beside the
 * unchanged `portionEstimated: true`, and that an ordinary row ships neither key.
 * RED on the pre-fix tree: the 'borrowed' assertion fails on master @ 83f426e;
 * the honest-row control and the `portionEstimated` control pass on both.
 *
 * Harness: route.cache-ladder.test.ts's — `gatherCandidates` mocked, `local=true`
 * so the request goes straight to `runLocalSearch()`.
 */

import { NextRequest } from 'next/server';
import { GET } from './route';

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

/**
 * A FatSecret "1 serving" restaurant record in `gatherCandidates` shape: the lane
 * refused to derive per-100g (`nutrition` undefined) and filtered every serving
 * for lack of a weight (`servings: []`), but the macros sit on `rawData.servings`.
 * The API spelling: `calories`/`carbohydrate`, sodium in mg.
 */
const macroOnlyHit = {
  id: 'fs_68444899',
  name: 'Whopper Jr.',
  brandName: 'Burger King',
  source: 'fatsecret',
  score: 9.0,
  nutrition: undefined,
  servings: [],
  rawData: {
    nutrientsPer100g: {},
    servings: [{
      description: '1 serving', measurementDescription: null,
      calories: 340, protein: 15, carbohydrate: 30, fat: 18, fiber: 2, sugar: 7, sodium: 560,
    }],
  },
};

/** An OFF row with a real panel and a real weighed serving. */
const honestHit = {
  id: 'off_1234567890123',
  name: 'Olive Garden, Chicken Alfredo',
  brandName: 'Olive Garden',
  source: 'openfoodfacts',
  score: 9.1,
  nutrition: { kcal: 350, protein: 15, carbs: 30, fat: 19, fiber: 2, sugar: 3 },
  servings: [{ description: '1 serving', grams: 340 }],
  rawData: { nutrientsPer100g: { fiber: 2, sugars: 3, sodium: 0.5 } },
};

const call = (query: string) =>
  GET(
    new NextRequest(
      `http://localhost:3000/api/foods/search?s=${encodeURIComponent(query)}&local=true&api_key=adminAPI_dev_key_bypass`,
    ),
  );

describe('/api/foods/search portionProvenance', () => {
  beforeEach(() => jest.clearAllMocks());

  test("a macro-only FatSecret row ships portionProvenance: 'borrowed' beside portionEstimated: true", async () => {
    gatherCandidates.mockResolvedValue([macroOnlyHit]);

    const response = await call('whopper jr');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    const item = body.data[0];

    // #314's flag, unchanged — the pair rule from recoverMacroOnlyServing()'s header.
    expect(item.portionEstimated).toBe(true);
    // The badge's field, from the same tier through the shared derivation.
    expect(item.portionProvenance).toBe('borrowed');
    // And the recovery itself still did its job (the macros were never missing).
    expect(item.kcal100).toBe(200);
  });

  test('an honest row ships neither key — control', async () => {
    gatherCandidates.mockResolvedValue([honestHit]);

    const response = await call('olive garden chicken alfredo');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    const item = body.data[0];

    expect('portionEstimated' in item).toBe(false);
    expect('portionProvenance' in item).toBe(false);
  });
});
