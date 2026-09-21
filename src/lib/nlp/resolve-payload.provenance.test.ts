/**
 * Provenance floor for `resolveFoodDetails`.
 *
 * The defect this guards (live on the box until 2026-07-28): `source` was initialised to
 * `'fatsecret'`, and all four branches assign it only INSIDE their `if (record found)`
 * guard. So every foodId that resolves to nothing kept the initialiser and shipped
 * `source: 'fatsecret'` to the client, which renders FatSecret's licensed Web Badge on it —
 * while an attribution audit with them is open. The reachable case is `water_default`
 * (the zero-calorie fast path, `map-ingredient-with-fallback.ts:710`): it matches no prefix
 * and is not an AiGeneratedFood row, and `MappingEventLog` holds 127 such events.
 *
 * Contract: an unidentified record makes NO provider claim. `'ai_estimated'` is the floor
 * because it is the only non-badging member of the api-contract union (api-contract.md:506)
 * and the only one the `food_log_items` CHECK accepts (001_mobile_schema.sql:164).
 */
jest.mock('@/lib/mapping/fatsecret-lane', () => ({
  peekDeferredFatSecretHit: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  prisma: {
    fdcFood: { findUnique: jest.fn() },
    offFood: { findUnique: jest.fn() },
    fatSecretFood: { findUnique: jest.fn() },
    aiGeneratedFood: { findUnique: jest.fn() },
  },
}));

import { resolveFoodDetails } from './resolve-payload';
import { prisma } from '@/lib/db';
import { peekDeferredFatSecretHit } from '@/lib/mapping/fatsecret-lane';

const peek = peekDeferredFatSecretHit as unknown as jest.Mock;

const db = prisma as unknown as {
  fdcFood: { findUnique: jest.Mock };
  offFood: { findUnique: jest.Mock };
  fatSecretFood: { findUnique: jest.Mock };
  aiGeneratedFood: { findUnique: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
  db.fdcFood.findUnique.mockResolvedValue(null);
  db.offFood.findUnique.mockResolvedValue(null);
  db.fatSecretFood.findUnique.mockResolvedValue(null);
  db.aiGeneratedFood.findUnique.mockResolvedValue(null);
  peek.mockReturnValue(undefined);
});

describe('resolveFoodDetails provenance', () => {
  test('water_default — the live unresolvable id — claims no provider', async () => {
    const details = await resolveFoodDetails('water_default');
    // The assertion that dies if the initialiser goes back to 'fatsecret'.
    expect(details.source).not.toBe('fatsecret');
    expect(details.source).toBe('ai_estimated');
  });

  test('a stale fdc_ id whose record is gone does not fall back to fatsecret', async () => {
    const details = await resolveFoodDetails('fdc_999999999');
    expect(details.source).not.toBe('fatsecret');
    expect(details.source).toBe('ai_estimated');
  });

  test('a purged off_ barcode does not fall back to fatsecret', async () => {
    const details = await resolveFoodDetails('off_0000000000000');
    expect(details.source).not.toBe('fatsecret');
  });

  test('an fs_ id whose record is gone does not claim fatsecret either', async () => {
    const details = await resolveFoodDetails('fs_404404');
    expect(details.source).not.toBe('fatsecret');
  });

  test('a genuine FatSecret record still reports fatsecret — the badge must not be lost', async () => {
    db.fatSecretFood.findUnique.mockResolvedValue({
      fsId: '12345',
      name: 'Chicken Breast, Grilled',
      brandName: null,
      nutrientsPer100g: { calories: 165, protein: 31, carbs: 0, fat: 3.6 },
      servings: [{ description: '1 breast', grams: 172 }],
    });
    const details = await resolveFoodDetails('fs_12345');
    expect(details.source).toBe('fatsecret');
  });

  test('a genuine FDC record reports fdc', async () => {
    db.fdcFood.findUnique.mockResolvedValue({
      fdcId: 1,
      description: 'Broccoli, raw',
      brandName: null,
      nutrientsPer100g: { calories: 34, protein: 2.8, carbs: 6.6, fat: 0.4 },
      servings: [],
    });
    const details = await resolveFoodDetails('fdc_1');
    expect(details.source).toBe('fdc');
  });

  test('a genuine OFF record reports openfoodfacts', async () => {
    db.offFood.findUnique.mockResolvedValue({
      barcode: '123',
      name: 'Oat Milk',
      brandName: 'Oatly',
      nutrientsPer100g: { kcal: 46, protein: 1, carbs: 6.7, fat: 1.5 },
      servings: [],
    });
    const details = await resolveFoodDetails('off_123');
    expect(details.source).toBe('openfoodfacts');
  });
});

/**
 * PUNCH #210 — the badge withheld from real FatSecret data (Lane A S52).
 *
 * `resolveFoodDetails()` reads `FatSecretFood` to decide provenance, and with
 * `FATSECRET_PERSIST_RUNNERS_UP` at its default 0 that row is written only by
 * `ensureFatSecretParentPersisted()`, which `saveValidatedMapping()` calls and which every
 * save gate above it returns before — and which `skipSave` skips outright. So a FatSecret
 * winner whose save was REJECTED, and every `nosave=1` request (every cold golden run
 * included), shipped `source: 'ai_estimated'` on a genuine FatSecret record.
 *
 * Measured read-only on the box 2026-09-20, `MappingEventLog` `noCache = false` with an
 * `fs_` winner LEFT JOINed to `FatSecretFood`: 9,258 events, **170 of them (64 distinct
 * fsIds) with no parent row at all**, and 161 more (130 fsIds) whose parent was created
 * AFTER the event; 44 events / 6 fsIds in the last 14 days. Owner, with the SQL:
 * `KindaHealthyMobile:sync-docs/reports/2026-09-20_lane-a-s52-the-produce-floor-picks-the-milk.md`
 * § ROW 3.
 *
 * The rule these pins encode: "the record is GONE" and "the record is known upstream and we
 * chose not to store it" are DIFFERENT states, and the lane's in-process deferred map is the
 * only thing that can tell them apart. The floor stays exactly where it was for the first.
 */
describe('resolveFoodDetails — an fs_ record the lane holds but never persisted', () => {
  const HIT = {
    id: '71193430',
    name: 'Galletas Marias',
    brandName: 'Gamesa',
    foodType: 'Brand',
    servings: [],
  };

  test('claims fatsecret when the lane still holds the hit — the badge is not withheld', async () => {
    peek.mockReturnValue(HIT);
    const details = await resolveFoodDetails('fs_71193430');
    expect(details.source).toBe('fatsecret');
    expect(peek).toHaveBeenCalledWith('71193430');
  });

  test('takes NOTHING but the source — the barcode route\'s `if (resolved.name)` gate stays shut', async () => {
    // `src/app/api/foods/barcode/route.ts` reads an empty name as "matched no row" and
    // falls through to Open Food Facts. Filling `name` here would make that gate pass on
    // this branch and ship FatSecret's badge over the all-zero `nutritionPer100g`
    // INITIALIZER, shadowing a healthy OFF answer — over-attribution, and the regression
    // that route's own anti-shadow test was written to close. Provenance was the defect;
    // identity was not.
    peek.mockReturnValue(HIT);
    const details = await resolveFoodDetails('fs_71193430');
    expect(details.name).toBe('');
    expect(details.brandName).toBeNull();
    expect(details.servingOptions).toEqual([]);
    expect(details.nutritionPer100g.kcal100).toBe(0);
  });

  test('keeps the floor when the lane has nothing either — fs_404404 is unchanged', async () => {
    peek.mockReturnValue(undefined);
    const details = await resolveFoodDetails('fs_404404');
    expect(details.source).toBe('ai_estimated');
    expect(details.source).not.toBe('fatsecret');
  });

  test('a persisted record never consults the lane — the DB stays the first answer', async () => {
    db.fatSecretFood.findUnique.mockResolvedValue({
      fsId: '4554283',
      name: 'Premium Chunk Chicken Breast',
      brandName: 'Swanson',
      nutrientsPer100g: { calories: 110, protein: 23, carbs: 0, fat: 2 },
      defaultServingId: null,
      servings: [],
    });
    const details = await resolveFoodDetails('fs_4554283');
    expect(details.source).toBe('fatsecret');
    expect(details.name).toBe('Premium Chunk Chicken Breast');
    expect(peek).not.toHaveBeenCalled();
  });

  test('a hit with no brand still claims fatsecret — the claim is about the SOURCE, not the name', async () => {
    peek.mockReturnValue({ ...HIT, brandName: undefined });
    const details = await resolveFoodDetails('fs_71193430');
    expect(details.source).toBe('fatsecret');
    expect(details.brandName).toBeNull();
  });

  test('the peek cannot rescue a non-fs id — an off_ miss still makes no claim', async () => {
    peek.mockReturnValue(HIT);
    const details = await resolveFoodDetails('off_0000000000000');
    expect(details.source).toBe('ai_estimated');
    expect(peek).not.toHaveBeenCalled();
  });
});
