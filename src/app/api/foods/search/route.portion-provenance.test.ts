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

/**
 * A FatSecret "1 serving" restaurant record in the lane's PRE-A8-row-1 shape:
 * `nutrition` undefined (no weight, so no per-100g derivation) and every serving
 * filtered out for lack of one (`servings: []`), with the macros surviving only
 * on `rawData.servings`. The API spelling: `calories`/`carbohydrate`, sodium in mg.
 *
 * KEPT DELIBERATELY. The lane no longer emits this shape — see `macroOnlyHitLive`
 * below — but a cached or replayed candidate can still carry it, and it is the
 * shape every one of this route's recovery assertions was written against.
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

/**
 * The SAME record in the lane's shape since A8 row 1 (2026-08-25): the gram-less
 * serving is no longer deleted, and it carries its own macros. The route must
 * still reach `recoverMacroOnlyServing()` — which it does because the grams
 * filter moved from the lane into the route, where the requirement actually
 * lives. Without that move `servingOptions` would be `[{ '1 serving', 100 }]`, a
 * fabricated weight, the recovery would never fire, and "Whopper Jr." would ship
 * to the browse list at 0 kcal again — the exact regression this route's comment
 * block describes.
 */
const macroOnlyHitLive = {
  ...macroOnlyHit,
  servings: [{
    description: '1 serving',
    grams: null,
    nutrients: { calories: 340, protein: 15, carbohydrate: 30, fat: 18, fiber: 2, sugar: 7, sodium: 560 },
  }],
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

  test("the lane's post-A8 shape recovers identically — a gram-less serving is not a 100 g portion", async () => {
    gatherCandidates.mockResolvedValue([macroOnlyHitLive]);

    const response = await call('whopper jr');
    expect(response.status).toBe(200);
    const item = (await response.json()).data[0];

    expect(item.portionEstimated).toBe(true);
    expect(item.portionProvenance).toBe('borrowed');
    expect(item.kcal100).toBe(200);
    // The record's OWN serving, not a fabricated `100 g`: 340 kcal / 2.0.
    expect(item.servingOptions).toEqual([{ label: '1 serving', grams: 170 }]);
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
