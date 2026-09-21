/**
 * `/api/foods/barcode` — the attribution chokepoint.
 *
 * Attribution is a legal boundary in BOTH directions: a licensed mark on data the
 * provider never supplied, and a dropped credit an open licence requires, are the same
 * class of defect. Until 2026-09-21 this route was the FOURTH `source` emitter and the
 * only one with no guard — it imported neither `toClientSource()` nor a whitelist of its
 * own and returned `details.source` raw, straight into the mobile detail sheet's
 * `SourceAttribution`.
 *
 * It was safe only by the PRODUCER's discipline, and the compiler does not enforce that
 * discipline. `resolveFoodDetails()` builds `source` as a plain `let source =
 * 'ai_estimated'` — inferred `string` — and launders it at the return with
 * `source as 'fatsecret' | 'fdc' | 'openfoodfacts' | 'ai_estimated'`. Measured
 * 2026-09-21: adding a fifth assignment of an unlisted value to that function
 * typechecks CLEAN (0 errors, against a 0-error control on the same tree). So "a fifth
 * value is a type error" is false, and this suite is what actually catches one.
 *
 * WHY THESE TESTS MOCK THE RESOLVER, when `route.test.ts` deliberately runs the real one.
 * That suite asserts what the endpoint emits for REAL rows and must keep doing so. The
 * question here is the opposite one — what the route does with a value the resolver
 * cannot produce TODAY — and there is no fixture that makes the real resolver emit one,
 * because it dispatches on the id prefix. Mocking the resolver is the only way to reach
 * the branch; mocking it in a separate file is what keeps `route.test.ts` honest.
 *
 * THE FLOOR IS `ai_estimated`, NOT `null`. `BarcodeLookupResponse.source` is typed
 * NON-NULLABLE in the wire contract (`plans/v1/api-contract.md`, "API Response Types"),
 * so a `null` here would be a contract violation rather than a quieter claim — the
 * playbook's §14 rule is "pick the floor that makes no claim WITHIN the constraint the
 * field actually has", and `ai_estimated` is the only non-badging member of that union.
 * It is also exactly the floor `/api/nlp/parse` already uses for the same field shape.
 */

process.env.DEV_API_KEY = 'test-barcode-key';

import { NextRequest } from 'next/server';
import { GET } from './route';

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/mapping/barcode', () => ({ lookupFatSecretBarcode: jest.fn() }));
jest.mock('@/lib/mapping/cache', () => ({ ensureFoodCached: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/openfoodfacts/client', () => ({ getOffProductByBarcode: jest.fn() }));
jest.mock('@/lib/openfoodfacts/hydrate', () => ({ hydrateOffCandidate: jest.fn() }));
jest.mock('@/lib/nlp/resolve-payload', () => ({ resolveFoodDetails: jest.fn() }));

const { lookupFatSecretBarcode } = require('@/lib/mapping/barcode');
const { getOffProductByBarcode } = require('@/lib/openfoodfacts/client');
const { hydrateOffCandidate } = require('@/lib/openfoodfacts/hydrate');
const { resolveFoodDetails } = require('@/lib/nlp/resolve-payload');

/**
 * The real `resolveFoodDetails` return shape, fields and all: the four-macro panel with
 * the three NULLABLE declared-nutrient slots, and `portionEstimated` /
 * `portionProvenance` OMITTED rather than false/null. Only `source` varies per test.
 */
const resolved = (rawSource: unknown) => ({
  name: 'Original Potato Crisps',
  brandName: 'Pringles',
  source: rawSource,
  nutritionPer100g: {
    kcal100: 536, protein100: 3.57, carbs100: 60.71, fat100: 32.14,
    fiber100: 3.6, sugar100: 0, sodium100: 0.536,
  },
  servingOptions: [{ label: '16 crisps', grams: 28, isDefault: true }],
});

const call = () =>
  GET(
    new NextRequest(
      'http://localhost:3000/api/foods/barcode?code=038000138416&api_key=test-barcode-key',
    ),
  );

describe('/api/foods/barcode attribution chokepoint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lookupFatSecretBarcode.mockResolvedValue({
      foodId: '95103', name: 'whatever the API said', brandName: null,
      source: 'fatsecret' as const, servings: [],
    });
    getOffProductByBarcode.mockResolvedValue(null);
    hydrateOffCandidate.mockResolvedValue(null);
  });

  /**
   * THE PIN. Each of these is a value the route would have shipped RAW to the client
   * before the chokepoint. `fatsecret-cache` is the one that matters most: §Attribution
   * names it explicitly as an `AiGeneratedFood` label containing ZERO FatSecret-derived
   * rows, so it must never reach the badge — and a client that matches on a substring,
   * or a future one that does, is not a backstop the backend may lean on.
   */
  test.each([
    ['fatsecret-cache', 'an AiGeneratedFood label with zero FatSecret content'],
    ['template', 'an unconstrained legacy Food column value'],
    ['verified', 'an unconstrained legacy Food column value'],
    ['cache', 'a pipeline STAGE, not a provider'],
    ['full_pipeline', 'a pipeline STAGE, not a provider'],
  ])('an unrecognised source (%s) floors to ai_estimated, never reaching the wire raw', async (raw) => {
    resolveFoodDetails.mockResolvedValue(resolved(raw));

    const body = await (await call()).json();
    expect(body.source).toBe('ai_estimated');
    expect(body.source).not.toBe(raw);
    // The direction that would be a licensing breach rather than a lost credit.
    expect(body.source).not.toBe('fatsecret');
  });

  /**
   * A non-string is the shape the four-value `as` cast cannot catch either, and it is
   * the one that serialises as `"source": {}` for a client doing `source.toLowerCase()`.
   * `toClientSource`'s null-prototype lookup is what makes the two prototype keys safe.
   */
  test.each([[null], [undefined], [42], [{}], ['constructor'], ['__proto__']])(
    'a non-source value (%p) floors to ai_estimated rather than escaping as-is',
    async (raw) => {
      resolveFoodDetails.mockResolvedValue(resolved(raw));

      const body = await (await call()).json();
      expect(body.source).toBe('ai_estimated');
      expect(typeof body.source).toBe('string');
    },
  );

  /**
   * THE CONTROLS — green on BOTH trees. These four are every value
   * `resolveFoodDetails()` can actually return today, so the change is byte-neutral in
   * production and what it alters is only what a future fifth value does.
   */
  test.each([['fatsecret'], ['fdc'], ['openfoodfacts'], ['ai_estimated']])(
    'the canonical value %s passes through byte-identical — control',
    async (raw) => {
      resolveFoodDetails.mockResolvedValue(resolved(raw));

      const body = await (await call()).json();
      expect(body.source).toBe(raw);
    },
  );

  /**
   * The alias spellings, which are why `toClientSource()` is strictly stronger here than
   * copying `/api/nlp/parse`'s `STANDARD_SOURCES` array: an `includes()` test would floor
   * these to `ai_estimated` and so silently DROP a true USDA or Open Food Facts credit —
   * under-attribution, which is a licence defect of its own and not merely the safe side.
   */
  test.each([
    ['usda', 'fdc'],
    ['off', 'openfoodfacts'],
    ['ai_generated', 'ai_estimated'],
    ['FatSecret', 'fatsecret'],
  ])('the alias %s normalises to %s rather than being floored', async (raw, expected) => {
    resolveFoodDetails.mockResolvedValue(resolved(raw));

    const body = await (await call()).json();
    expect(body.source).toBe(expected);
  });

  /**
   * The rest of the payload must not move. The chokepoint is a one-field change, and a
   * barcode scan's card is built from all of these.
   */
  test('nothing but source changes: the rest of the payload is untouched', async () => {
    resolveFoodDetails.mockResolvedValue(resolved('fatsecret-cache'));

    const body = await (await call()).json();
    expect(body.id).toBe('fs_95103');
    expect(body.name).toBe('Original Potato Crisps');
    expect(body.brand).toBe('Pringles');
    expect(body.nutritionPer100g).toEqual({
      kcal100: 536, protein100: 3.57, carbs100: 60.71, fat100: 32.14,
      fiber100: 3.6, sugar100: 0, sodium100: 0.536,
    });
    expect(body.servingOptions).toEqual([{ label: '16 crisps', grams: 28, isDefault: true }]);
    // Omitted-not-false, the #314 convention, unchanged by this row.
    expect('portionEstimated' in body).toBe(false);
    expect('portionProvenance' in body).toBe(false);
  });
});
