/**
 * `/api/foods/barcode` — the FatSecret branch must actually resolve.
 *
 * The regression this guards (latent on the box until 2026-07-28, latent only
 * because no client calls the route — the mobile scanner is a hardcoded mock):
 * `lookupFatSecretBarcode` returns a BARE numeric FatSecret id
 * (`client.ts`, `id: String(raw.food_id)`), and the route handed it straight to
 * `resolveFoodDetails`, whose dispatch is purely by prefix — `fdc_` / `off_` /
 * `fs_`, else an `AiGeneratedFood` lookup. `AiGeneratedFood.id` is a cuid, so a
 * numeric id can never match, and every FatSecret barcode hit returned HTTP 200
 * with `name: ''`, all-zero nutrition and `servingOptions: []` — while
 * short-circuiting the OpenFoodFacts fallback that would otherwise have answered.
 *
 * Verified against the live DB before the fix: `resolveFoodDetails('95103')`
 * returns `{ name: '', kcal100: 0, servingOptions: 0 }`; `'fs_95103'` returns
 * `{ name: 'Original Potato Crisps', kcal100: 536, servingOptions: 12 }`.
 *
 * These tests run the REAL `resolveFoodDetails` over a mocked `@/lib/db`, so they
 * assert what the endpoint emits rather than restating how it is built. The
 * fixtures are the real rows for `FatSecretFood.fsId` 95103 and 4041569.
 */

process.env.DEV_API_KEY = 'test-barcode-key';

import { NextRequest } from 'next/server';
import { GET } from './route';

/** Real FatSecretFood rows (fsId 95103, 4041569), abbreviated servings. */
const mockFsRows: Record<string, unknown> = {
  '95103': {
    fsId: '95103',
    name: 'Original Potato Crisps',
    brandName: 'Pringles',
    nutrientsPer100g: {
      calories: 536, protein: 3.57, carbs: 60.71, fat: 32.14,
      fiber: 3.6, sugars: 0, sodium: 0.536, saturatedFat: 8.93,
    },
    defaultServingId: 'sv-crisps',
    fetchedAt: new Date(),
    servings: [
      { servingId: 'sv-crisps', description: '16 crisps', measurementDescription: 'crisps', grams: 28, volumeMl: null, numberOfUnits: 16, nutrients: {} },
      { servingId: 'sv-100', description: '100 g', measurementDescription: 'g', grams: 100, volumeMl: null, numberOfUnits: 100, nutrients: {} },
    ],
  },
  // A genuinely zero-calorie product. Every macro is a true 0, which is why
  // resolved-ness must be judged on the name and never on the nutrition.
  '4041569': {
    fsId: '4041569',
    name: 'Coke Zero (Can)',
    brandName: 'Coca-Cola',
    nutrientsPer100g: {
      calories: 0, protein: 0, carbs: 0, fat: 0,
      fiber: 0, sugars: 0, sodium: 0.012, saturatedFat: 0,
    },
    defaultServingId: 'sv-can',
    fetchedAt: new Date(),
    servings: [
      { servingId: 'sv-can', description: '1 can', measurementDescription: 'can', grams: 355, volumeMl: 355, numberOfUnits: 1, nutrients: {} },
      { servingId: 'sv-100', description: '100 g', measurementDescription: 'g', grams: 100, volumeMl: null, numberOfUnits: 100, nutrients: {} },
    ],
  },
  // A FatSecret "1 serving" restaurant record: per-serving macros on the serving
  // row, NO weight, and an EMPTY per-100g panel (fsId 68444899, the same record
  // resolve-payload-fs.test.ts and the search-lane test pin). The one branch of
  // resolveFoodDetails() that can know a serving tier — the macro-only recovery.
  '68444899': {
    fsId: '68444899',
    name: 'Whopper Jr.',
    brandName: 'Burger King',
    nutrientsPer100g: {},
    defaultServingId: '56035832',
    fetchedAt: new Date(),
    servings: [{
      servingId: '56035832', description: '1 serving', measurementDescription: null,
      grams: null, volumeMl: null, numberOfUnits: 1,
      nutrients: { calories: 340, protein: 15, carbohydrate: 30, fat: 18, fiber: 2, sugar: 7, sodium: 560 },
    }],
  },
};

/** An OffFood row that is perfectly healthy and must not be shadowed. */
const mockOffRows: Record<string, unknown> = {
  '021130126026': {
    barcode: '021130126026',
    name: 'Greek Nonfat Yogurt (Strawberry)',
    brandName: 'Lucerne',
    nutrientsPer100g: { kcal: 53.3, protein: 5.3, carbs: 8, fat: 0, fiber: 0, sugars: 7.3, sodium: 0.05 },
    servingGrams: 150,
    servingSize: '1 container (150g)',
    servings: [],
  },
};

const mockAiFindUnique = jest.fn().mockResolvedValue(null);

jest.mock('@/lib/db', () => ({
  prisma: {
    fatSecretFood: {
      findUnique: (args: { where: { fsId: string } }) =>
        Promise.resolve(mockFsRows[args.where.fsId] ?? null),
    },
    offFood: {
      findUnique: (args: { where: { barcode: string } }) =>
        Promise.resolve(mockOffRows[args.where.barcode] ?? null),
    },
    fdcFood: { findUnique: jest.fn().mockResolvedValue(null) },
    aiGeneratedFood: {
      findUnique: (...args: unknown[]) => mockAiFindUnique(...args),
    },
  },
}));

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/mapping/barcode', () => ({
  lookupFatSecretBarcode: jest.fn(),
}));

jest.mock('@/lib/mapping/cache', () => ({
  ensureFoodCached: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/lib/openfoodfacts/client', () => ({
  getOffProductByBarcode: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/lib/openfoodfacts/hydrate', () => ({
  hydrateOffCandidate: jest.fn().mockResolvedValue(null),
}));

const { lookupFatSecretBarcode } = require('@/lib/mapping/barcode');
const { ensureFoodCached } = require('@/lib/mapping/cache');
const { getOffProductByBarcode } = require('@/lib/openfoodfacts/client');
const { hydrateOffCandidate } = require('@/lib/openfoodfacts/hydrate');

/** `lookupFatSecretBarcode` shape — note the bare, unprefixed foodId. */
const fsHit = (foodId: string) => ({
  foodId,
  name: 'whatever the API said',
  brandName: null,
  source: 'fatsecret' as const,
  servings: [],
});

const call = (code: string) =>
  GET(
    new NextRequest(
      `http://localhost:3000/api/foods/barcode?code=${encodeURIComponent(code)}&api_key=test-barcode-key`,
    ),
  );

describe('/api/foods/barcode FatSecret branch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lookupFatSecretBarcode.mockResolvedValue(null);
    ensureFoodCached.mockResolvedValue(null);
    getOffProductByBarcode.mockResolvedValue(null);
    hydrateOffCandidate.mockResolvedValue(null);
    mockAiFindUnique.mockResolvedValue(null);
  });

  test('a FatSecret hit resolves to a real name and real nutrition, not an empty 200', async () => {
    lookupFatSecretBarcode.mockResolvedValue(fsHit('95103'));

    const response = await call('038000138416');
    expect(response.status).toBe(200);
    const body = await response.json();

    // The assertions that die when the `fs_` prefix is dropped.
    expect(body.name).toBe('Original Potato Crisps');
    expect(body.name).not.toBe('');
    expect(body.source).toBe('fatsecret');
    expect(body.brand).toBe('Pringles');
    expect(body.nutritionPer100g.kcal100).toBe(536);
    expect(body.nutritionPer100g.protein100).toBeCloseTo(3.57);
    expect(body.nutritionPer100g.fat100).toBeCloseTo(32.14);
    expect(body.servingOptions.length).toBeGreaterThan(0);

    // The id handed back must be the one that resolves on a later round-trip.
    expect(body.id).toBe('fs_95103');

    // A FatSecret food must never be resolved through the AI-estimate table —
    // that lookup is exactly where the unprefixed id used to land.
    expect(mockAiFindUnique).not.toHaveBeenCalled();
  });

  test('a resolvable FatSecret hit does not reach for OpenFoodFacts', async () => {
    lookupFatSecretBarcode.mockResolvedValue(fsHit('95103'));

    const response = await call('038000138416');
    expect(response.status).toBe(200);
    expect(getOffProductByBarcode).not.toHaveBeenCalled();
    expect(hydrateOffCandidate).not.toHaveBeenCalled();
  });

  test('caching stays local: ensureFoodCached is called with the bare id and NO live client', async () => {
    lookupFatSecretBarcode.mockResolvedValue(fsHit('95103'));
    await call('038000138416');

    // The bare id is correct here — ensureFoodCached keys AiGeneratedFood, it does not
    // dispatch by prefix. Passing an `options.client` is the trap: it would fetch live and
    // write FatSecret data into AiGeneratedFood as `aiModel: 'fatsecret-live-import'`,
    // which cache-search now reports as ai_generated/ai_estimated — real vendor data
    // relabelled as an AI estimate. This dies the moment a client is threaded through.
    expect(ensureFoodCached).toHaveBeenCalledWith('95103');
  });

  test('a genuinely zero-calorie FatSecret product is served, not mistaken for unresolved', async () => {
    lookupFatSecretBarcode.mockResolvedValue(fsHit('4041569'));

    const response = await call('049000028911');
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.name).toBe('Coke Zero (Can)');
    expect(body.source).toBe('fatsecret');
    expect(body.nutritionPer100g.kcal100).toBe(0);
    expect(body.servingOptions.length).toBeGreaterThan(0);
    // All-zero macros are a real value here. Gating the fallback on nutrition
    // (isDegenerateNutrition) instead of on the name would discard this correct hit.
    expect(getOffProductByBarcode).not.toHaveBeenCalled();
  });

  test('an unresolvable FatSecret id no longer shadows a healthy OpenFoodFacts answer', async () => {
    // FatSecret answers the barcode, but nothing for that fsId is in our Postgres yet
    // (fatsecret rows are written by a background task, so a first sighting resolves cold).
    lookupFatSecretBarcode.mockResolvedValue(fsHit('999999999'));
    getOffProductByBarcode.mockResolvedValue({
      code: '021130126026',
      product_name: 'Greek Nonfat Yogurt (Strawberry)',
    });

    const response = await call('021130126026');
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(getOffProductByBarcode).toHaveBeenCalledWith('021130126026');
    expect(body.id).toBe('off_021130126026');
    expect(body.source).toBe('openfoodfacts');
    expect(body.name).toBe('Greek Nonfat Yogurt (Strawberry)');
    expect(body.nutritionPer100g.kcal100).toBeGreaterThan(0);
  });

  test('OpenFoodFacts still answers on its own when FatSecret has no hit at all', async () => {
    lookupFatSecretBarcode.mockResolvedValue(null);
    getOffProductByBarcode.mockResolvedValue({
      code: '021130126026',
      product_name: 'Greek Nonfat Yogurt (Strawberry)',
    });

    const response = await call('021130126026');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.source).toBe('openfoodfacts');
    expect(body.nutritionPer100g.kcal100).toBeGreaterThan(0);
  });

  /**
   * `portionProvenance` — passed through from resolveFoodDetails(). This route
   * has no mapper result, so the ONLY tier it can ever learn is the macro-only
   * recovery's (`fs_serving_macros_only_est`, a BORROWED_OR_DEFAULTED member):
   * `'borrowed'` there, no key anywhere else. RED on the pre-fix tree for the
   * 'borrowed' assertion; the two absent-key controls pass on both trees.
   */
  test("a macro-only FatSecret record ships portionProvenance: 'borrowed' beside portionEstimated: true", async () => {
    lookupFatSecretBarcode.mockResolvedValue(fsHit('68444899'));

    const response = await call('000000068444');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe('Whopper Jr.');
    // #314's flag, unchanged.
    expect(body.portionEstimated).toBe(true);
    // The badge's field, from the recovery's tier through the shared derivation.
    expect(body.portionProvenance).toBe('borrowed');
  });

  test('a record that resolved through its own panel ships neither key — control', async () => {
    lookupFatSecretBarcode.mockResolvedValue(fsHit('95103'));

    const body = await (await call('038000138416')).json();
    expect('portionEstimated' in body).toBe(false);
    expect('portionProvenance' in body).toBe(false);
  });

  test('when nothing resolves the answer is a 404, never a 200 with an empty name', async () => {
    lookupFatSecretBarcode.mockResolvedValue(fsHit('999999999'));
    getOffProductByBarcode.mockResolvedValue(null);

    const response = await call('000000000000');
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe('Food not found for barcode');
    expect(body.name).toBeUndefined();
  });
});
