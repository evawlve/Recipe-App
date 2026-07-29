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
