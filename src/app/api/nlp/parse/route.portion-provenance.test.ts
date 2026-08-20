/**
 * /api/nlp/parse — the `portionProvenance` wire field.
 *
 * WHAT IT ASSERTS: the per-line response carries `portionProvenance: 'borrowed'`
 * when the mapper's `servingTier` is a BORROWED_OR_DEFAULTED member, `'floor'`
 * when it is a FLOOR_SERVING_TIERS member, and NO such key at all otherwise —
 * and that `portionEstimated` (#314) is untouched by the new field on the one
 * tier that carries both.
 *
 * WHY A ROUTE TEST AND NOT ONLY THE PREDICATE TESTS: the field is derived at
 * the route from `mapped.servingTier`, and `servingTier` itself never reaches
 * the wire (it is a MappingEventLog column). The predicate can be perfect and
 * the route can still forget to read it; this file is what goes red then. RED
 * on the pre-fix tree: the three positive assertions ('borrowed', 'floor', and
 * the key's presence on a #314 row) fail on master @ 83f426e; the absent-key
 * assertions and the `portionEstimated` assertions are the controls and pass on
 * both trees.
 *
 * Harness: same shape as route.seg-cache.test.ts — supabase and prisma mocked,
 * `mapIngredientWithFallback` mocked per test to return a mapped line stamped
 * with the tier under test, `resolveFoodDetails` mocked (the other resolve-payload
 * helpers run real). The single-item fast path is used so no segmenter runs.
 */

import { NextRequest } from 'next/server';
import { POST } from './route';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: jest.fn() } })),
}));

jest.mock('@/lib/db', () => ({
  prisma: {
    nlpRequestLog: { count: jest.fn(), create: jest.fn() },
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

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
const { resolveFoodDetails } = require('@/lib/nlp/resolve-payload');

/** A mapped line as the mapper returns it, with the tier under test stamped on. */
function mappedLine(servingTier: string | undefined, overrides: Record<string, unknown> = {}) {
  return {
    foodId: 'off_0000000000001',
    foodName: 'Fixture Food',
    brandName: null,
    source: 'openfoodfacts',
    confidence: 0.9,
    servingDescription: '1 serving',
    grams: 236,
    kcal: 55,
    protein: 6,
    carbs: 8,
    fat: 0.5,
    servingTier,
    ...overrides,
  };
}

/** A resolved record with a real (non-degenerate) panel, so the route takes the
 *  ordinary branch and neither re-derives per-100g nor logs a repair. */
const honestDetails = {
  name: 'Fixture Food',
  brandName: null,
  source: 'openfoodfacts',
  nutritionPer100g: {
    kcal100: 23.3, protein100: 2.5, carbs100: 3.4, fat100: 0.2,
    fiber100: 1.0, sugar100: 0.5, sodium100: 0.05,
  },
  servingOptions: [{ label: '100 g', grams: 100, type: 'weight', isDefault: true }],
};

function parseRequest(text: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'adminAPI_dev_key_bypass', // dev bypass: skips Supabase auth + rate limiting
    },
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

describe('/api/nlp/parse portionProvenance', () => {
  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
    // Fail-closed route (2026-08-20): the bypass key must come from the env — there is no
    // fallback literal to fall back onto — so pin the exact key the requests below send.
    process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass';
    // Telemetry off: this file is about the wire, and the mocked createMany
    // would accept anything anyway.
    process.env.MAPPING_EVENT_LOG_ENABLED = 'false';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    resolveFoodDetails.mockResolvedValue(honestDetails);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---- the three values, one per Phase B probe line ---------------------------

  test("a BORROWED_OR_DEFAULTED tier ships portionProvenance: 'borrowed' (the 'spinach' probe)", async () => {
    // bare_name_sibling_serving_tight: the median declared serving of OTHER OFF
    // rows sharing this row's name — another product's label by construction.
    mapIngredientWithFallback.mockResolvedValue(mappedLine('bare_name_sibling_serving_tight'));

    const item = await parseOne('spinach');
    expect(item.portionProvenance).toBe('borrowed');
    // A borrowed weight is a REAL weight (someone's label), so the #314 flag —
    // which means "the grams are an invention" — must NOT appear here.
    expect('portionEstimated' in item).toBe(false);
  });

  test("a FLOOR tier ships portionProvenance: 'floor' (the 'a shot of espresso' probe)", async () => {
    // count_unresolved_floor: no piece weight resolved, a flat 100 g was billed.
    mapIngredientWithFallback.mockResolvedValue(mappedLine('count_unresolved_floor', { grams: 100 }));

    const item = await parseOne('a shot of espresso');
    expect(item.portionProvenance).toBe('floor');
    expect('portionEstimated' in item).toBe(false);
  });

  test("a USER tier ships NO portionProvenance key at all (the '100 g chicken breast' probe) — control", async () => {
    // weight_unit: grams = the number the user typed x an oz->g constant.
    mapIngredientWithFallback.mockResolvedValue(mappedLine('weight_unit', { grams: 100 }));

    const item = await parseOne('100 g chicken breast');
    // Not `null`, not `undefined`-as-a-value: the KEY is absent, so an honest
    // row's JSON is byte-identical to what it was before the field existed.
    expect('portionProvenance' in item).toBe(false);
    expect(Object.keys(item)).not.toContain('portionProvenance');
    expect('portionEstimated' in item).toBe(false);
  });

  // ---- the shape of an honest row is unchanged ------------------------------------

  test('an OWN-tier row carries exactly the keys it carried before the field — control', async () => {
    mapIngredientWithFallback.mockResolvedValue(mappedLine('bare_label_serving'));

    const item = await parseOne('spinach');
    // The complete key set of a mapped, honest line as /api/nlp/parse emitted it
    // before this field (funnelStage/dropReason are undefined here and JSON drops
    // them). If this list changes, the wire changed for EVERY honest row.
    expect(Object.keys(item).sort()).toEqual([
      'brandName', 'foodId', 'foodName', 'grams', 'matchConfidence', 'mealType',
      'nutrition', 'nutritionPer100g', 'quantity', 'rawText', 'servingConfidence',
      'servingOptions', 'source', 'unit',
    ]);
  });

  test('a line the legacy cascade left unstamped (servingTier undefined) ships no field — control', async () => {
    mapIngredientWithFallback.mockResolvedValue(mappedLine(undefined));

    const item = await parseOne('spinach');
    expect('portionProvenance' in item).toBe(false);
  });

  // ---- portionEstimated (#314) is unchanged ---------------------------------------

  test("the #314 fixture still ships portionEstimated: true, and now 'borrowed' beside it", async () => {
    // fs_serving_macros_only_est: a FatSecret "1 serving" record with per-serving
    // macros, no weight and no panel; grams = kcal / 2.0. It is the sole
    // SYNTHETIC_GRAMS member AND a BORROWED_OR_DEFAULTED member (the overlap
    // serving-ai-tiers.ts calls deliberate), so it is the one row that carries
    // both fields. `portionEstimated` here is derived exactly as before — by
    // `isSyntheticGramsTier()` — and the new field does not touch it.
    mapIngredientWithFallback.mockResolvedValue(mappedLine('fs_serving_macros_only_est', {
      foodId: 'fs_68444899',
      foodName: 'Whopper Jr.',
      brandName: 'Burger King',
      source: 'fatsecret',
      grams: 170,
      kcal: 340, protein: 15, carbs: 30, fat: 18,
    }));
    // The #314 shape: a degenerate panel from the resolver, so the route
    // re-derives per-100g from the billed macros — the path #314 shipped on.
    resolveFoodDetails.mockResolvedValue({
      ...honestDetails,
      name: 'Whopper Jr.', brandName: 'Burger King', source: 'fatsecret',
      nutritionPer100g: { kcal100: 0, protein100: 0, carbs100: 0, fat100: 0, fiber100: 0, sugar100: 0, sodium100: 0 },
    });

    const item = await parseOne('whopper jr');
    // Byte-identical for the flag: same key, same value, same `true as const`.
    expect(item.portionEstimated).toBe(true);
    expect(JSON.stringify({ portionEstimated: item.portionEstimated })).toBe('{"portionEstimated":true}');
    // And the new field rides beside it without displacing it.
    expect(item.portionProvenance).toBe('borrowed');
  });

  test('portionEstimated does NOT appear on the merely-borrowed or the floored rows', async () => {
    // The two populations the flicker report said `portionEstimated` must not be
    // widened to — the field exists so they can be named WITHOUT touching it.
    const cases: Array<[string, 'borrowed' | 'floor']> = [
      ['bare_sibling_serving', 'borrowed'],
      ['volume_unit', 'borrowed'],
      ['flat_100g_default', 'floor'],
      ['fdc_unknown_unit', 'floor'],
    ];
    for (const [tier, want] of cases) {
      mapIngredientWithFallback.mockResolvedValue(mappedLine(tier));
      const item = await parseOne('spinach');
      expect([tier, 'portionEstimated' in item]).toEqual([tier, false]);
      expect([tier, item.portionProvenance]).toEqual([tier, want]);
    }
  });
});
