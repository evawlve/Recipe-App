/**
 * /api/foods/search (corpus lane) — an undeclared fibre is `fiber100: null`, never 0.
 *
 * The same rule as /api/nlp/parse (ResolvedNutritionPer100g.fiber100 in
 * src/lib/nlp/resolve-payload.ts), on the lane that does not go through
 * resolveFoodDetails: `runLocalSearch()` reads the candidate's raw panel and shipped
 * `nutrients.fiber ?? 0`. OffFood 6922877745423 "Skippy Peanut Butter" is the measured
 * row — its stored panel is `"fiber": null` (box, 2026-09-05) and this lane reported it
 * as `fiber100: 0`. A declared 0 stays 0. The legacy lane and /api/foods/[id] already
 * pass a nullable `Food.fiber100` through, so this makes the three agree.
 *
 * RED on the pre-fix tree: the `toBeNull()` fails on master @ 5411f7e; the declared-0
 * row is the control.
 *
 * Harness: route.portion-provenance.test.ts's — `gatherCandidates` mocked, `local=true`.
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

/** OffFood 6922877745423 as stored on the box 2026-09-05, in the lane's candidate shape. */
function skippyHit(fiber: number | null) {
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
        fat: 47, carbs: 21.79999923706055, fiber, sodium: null, sugars: null,
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

describe('/api/foods/search fiber100: null is not 0', () => {
  beforeEach(() => jest.clearAllMocks());

  test('the measured row — "fiber": null in the stored panel — ships fiber100: null', async () => {
    gatherCandidates.mockResolvedValue([skippyHit(null)]);

    const response = await call('skippy peanut butter');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    const item = body.data[0];

    expect(item.fiber100).toBeNull();
    expect(JSON.stringify(item)).toContain('"fiber100":null');
    // Untouched: the macros, and the sugar/sodium fold (same shape, not this change).
    expect(item.kcal100).toBe(609);
    expect(item.sugar100).toBe(0);
    expect(item.sodium100).toBe(0);
  });

  test('a DECLARED 0 stays 0 — control', async () => {
    gatherCandidates.mockResolvedValue([skippyHit(0)]);

    const body = await (await call('skippy peanut butter')).json();
    expect(body.data[0].fiber100).toBe(0);
  });

  test('a declared value passes through unchanged — control', async () => {
    gatherCandidates.mockResolvedValue([skippyHit(6.1)]);

    const body = await (await call('skippy peanut butter')).json();
    expect(body.data[0].fiber100).toBe(6.1);
  });
});
