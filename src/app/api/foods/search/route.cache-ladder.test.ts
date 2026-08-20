/**
 * Ladder order for `/api/foods/search` under `FATSECRET_CACHE_MODE=primary`.
 *
 * The regression this guards (live on the box until 2026-07-28): the cache
 * branch — which reads `AiGeneratedFood`, measured at 127 `openai/gpt-4o-mini`
 * + 2 `mistralai/mistral-nemo` rows and ZERO fatsecret-derived rows — was
 * consulted FIRST, and any single hit short-circuited the 1.07M-row corpus.
 * `?s=olive garden chicken alfredo` returned one AI estimate while three real
 * Olive Garden records sat in OFF at confidence 0.88.
 *
 * Contract: AI estimates are a LAST RESORT, matching the mapper, where
 * `requestAiNutrition` fires only under `if (!winner)`.
 *
 * `FATSECRET_CACHE_MODE` is read at module load in `@/lib/mapping/config`, so it
 * must be set before anything imports it — hence this separate file.
 */
process.env.FATSECRET_CACHE_MODE = 'primary';
process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass'; // fail-closed route (2026-08-20): the key must come from the env

import { NextRequest } from 'next/server';
import { GET } from './route';

jest.mock('@/lib/db', () => ({
  prisma: { food: { findMany: jest.fn().mockResolvedValue([]) } },
}));

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
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
const { searchFatSecretCacheFoods } = require('@/lib/mapping/cache-search');

/** A real-corpus candidate that survives ranking, in `gatherCandidates` shape. */
const realCorpusHit = {
  id: 'off_1234567890123',
  name: 'Olive Garden, Chicken Alfredo',
  brandName: 'Olive Garden',
  source: 'openfoodfacts',
  score: 9.1,
  nutrition: { kcal: 350, protein: 15, carbs: 30, fat: 19, fiber: 2, sugar: 3 },
  servings: [{ description: '1 serving', grams: 340 }],
};

const call = (query: string) =>
  GET(
    new NextRequest(
      `http://localhost:3000/api/foods/search?s=${encodeURIComponent(query)}&api_key=adminAPI_dev_key_bypass`,
    ),
  );

describe('/api/foods/search ladder under cache mode "primary"', () => {
  beforeEach(() => jest.clearAllMocks());

  test('serves the real corpus and never touches the AI cache when the corpus answers', async () => {
    gatherCandidates.mockResolvedValue([realCorpusHit]);

    const response = await call('olive garden chicken alfredo');
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(gatherCandidates).toHaveBeenCalled();
    // The assertion that dies if the branch order is inverted back.
    expect(searchFatSecretCacheFoods).not.toHaveBeenCalled();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0].source).not.toBe('fatsecret-cache');
  });

  test('falls through to the AI cache only when the corpus returns nothing', async () => {
    gatherCandidates.mockResolvedValue([]);

    const response = await call('zzqqxx nonsense thing');
    expect(response.status).toBe(200);

    expect(gatherCandidates).toHaveBeenCalled();
    expect(searchFatSecretCacheFoods).toHaveBeenCalled();
  });

  test('an explicit local=true request still bypasses the AI cache entirely', async () => {
    gatherCandidates.mockResolvedValue([]);

    const response = await GET(
      new NextRequest(
        'http://localhost:3000/api/foods/search?s=anything&local=true&api_key=adminAPI_dev_key_bypass',
      ),
    );
    expect(response.status).toBe(200);
    expect(searchFatSecretCacheFoods).not.toHaveBeenCalled();
  });
});
