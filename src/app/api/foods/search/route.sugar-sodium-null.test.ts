/**
 * /api/foods/search (corpus lane) — an undeclared sugar or sodium is null,
 * never 0. The sibling of route.fiber-null.test.ts, one PR later (#134).
 *
 * WHY THIS LANE MATTERS AND NOT THE OTHER TWO. The route has three lanes and
 * this is the ONLY one the mobile client can reach: all three of its call sites
 * send `&local=true`. A fold left here would have kept the browse list saying
 * "0 g sugar" about the same record the parse wire now says nothing about. The
 * legacy lane reads `Food.sugar100`, already `Float?`, and passes it through;
 * the AI-cache lane is `buildCacheFoodResponse()`, pinned in
 * src/lib/mapping/__tests__/cache-search-sugar-null.test.ts.
 *
 * `sodium100` HAS NO `buildImpact()` PARAMETER and does not need one — the
 * impact preview reads five fields and sodium is not among them. `sugar100`
 * does, and it is already declared `number | null`.
 *
 * RED on the pre-fix tree: the `toBeNull()` calls fail on master @ 4a1ca59
 * (`nutrients.sugars ?? nutrients.sugar ?? 0`, `nutrients.sodium ?? 0`); the
 * declared-0 rows are the controls.
 *
 * Harness: route.fiber-null.test.ts's — `gatherCandidates` mocked, `local=true`.
 */

import { NextRequest } from 'next/server';
import { GET } from './route';

process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass'; // fail-closed route (2026-08-20)

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

/** OffFood 6922877745423 "Skippy Peanut Butter" as stored on the box: sugars and sodium both null. */
function skippyHit(sugars: number | null, sodium: number | null) {
  return {
    id: 'off_6922877745423',
    name: 'Skippy Peanut Butter',
    brandName: 'Skippy',
    source: 'openfoodfacts',
    score: 9.0,
    nutrition: { kcal: 609, protein: 24.3, carbs: 21.8, fat: 47 },
    servings: [{ description: '2 tbsp', grams: 32 }],
    rawData: {
      nutrientsPer100g: {
        fat: 47, carbs: 21.79999923706055, fiber: null, sodium, sugars,
        protein: 24.29999923706055, calories: 609,
      },
    },
  };
}

const call = (query: string) =>
  GET(
    new NextRequest(
      `http://localhost:3000/api/foods/search?s=${encodeURIComponent(query)}&local=true&api_key=adminAPI_dev_key_bypass`,
    ),
  );

describe('/api/foods/search sugar100 and sodium100: null is not 0', () => {
  beforeEach(() => jest.clearAllMocks());

  test('the measured row — both keys present-and-null — ships both as null', async () => {
    gatherCandidates.mockResolvedValue([skippyHit(null, null)]);

    const response = await call('skippy peanut butter');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    const item = body.data[0];

    expect(item.sugar100).toBeNull();
    expect(item.sodium100).toBeNull();
    expect(JSON.stringify(item)).toContain('"sugar100":null');
    expect(JSON.stringify(item)).toContain('"sodium100":null');
    // Untouched.
    expect(item.kcal100).toBe(609);
    expect(item.protein100).toBeCloseTo(24.3, 5);
  });

  test('DECLARED zeros stay 0 — control', async () => {
    gatherCandidates.mockResolvedValue([skippyHit(0, 0)]);

    const item = (await (await call('skippy peanut butter')).json()).data[0];
    expect(item.sugar100).toBe(0);
    expect(item.sodium100).toBe(0);
    expect(JSON.stringify(item)).toContain('"sugar100":0');
  });

  test('declared values pass through unchanged — control', async () => {
    gatherCandidates.mockResolvedValue([skippyHit(9.4, 0.43)]);

    const item = (await (await call('skippy peanut butter')).json()).data[0];
    expect(item.sugar100).toBe(9.4);
    expect(item.sodium100).toBe(0.43);
  });

  test('one field declared and one not — the two are independent', async () => {
    gatherCandidates.mockResolvedValue([skippyHit(9.4, null)]);

    const item = (await (await call('skippy peanut butter')).json()).data[0];
    expect(item.sugar100).toBe(9.4);
    expect(item.sodium100).toBeNull();
  });

  test('the `sugar` spelling is read when `sugars` is absent — both keys occur in OFF', async () => {
    const hit = skippyHit(null, null);
    delete (hit.rawData.nutrientsPer100g as Record<string, unknown>).sugars;
    (hit.rawData.nutrientsPer100g as Record<string, unknown>).sugar = 3.3;
    gatherCandidates.mockResolvedValue([hit]);

    const item = (await (await call('skippy peanut butter')).json()).data[0];
    expect(item.sugar100).toBe(3.3);
  });
});
