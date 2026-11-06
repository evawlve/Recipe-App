/**
 * `/api/foods/barcode` — the local OffFood mirror is read BEFORE OFF's live API.
 *
 * Real `resolveFoodDetails` and real `findLocalOffBarcode` over a mocked `@/lib/db`;
 * FatSecret, the OFF client and `hydrateOffCandidate` are mocked.
 */
process.env.DEV_API_KEY = 'test-barcode-key';

import { NextRequest } from 'next/server';
import { GET } from './route';

const offRow = (barcode: string, nutrientsPer100g: unknown = { calories: 53.3, protein: 5.3, carbs: 8, fat: 0, fiber: 0, sugars: 7.3, sodium: 0.05 }) => ({
  barcode,
  name: 'Greek Nonfat Yogurt (Strawberry)',
  brandName: 'Lucerne',
  nutrientsPer100g,
  servingGrams: 150,
  servingSize: '1 container (150g)',
  servings: [],
});

const mockOffRows: Record<string, unknown> = {};
const mockOffFindUnique = jest.fn((a: { where: { barcode: string } }) =>
  Promise.resolve(mockOffRows[a.where.barcode] ?? null),
);
const mockFsRows: Record<string, unknown> = {
  '95103': {
    fsId: '95103', name: 'Original Potato Crisps', brandName: 'Pringles',
    nutrientsPer100g: { calories: 536, protein: 3.57, carbs: 60.71, fat: 32.14, fiber: 3.6, sugars: 0, sodium: 0.536, saturatedFat: 8.93 },
    defaultServingId: 'sv-100', fetchedAt: new Date(),
    servings: [{ servingId: 'sv-100', description: '100 g', measurementDescription: 'g', grams: 100, volumeMl: null, numberOfUnits: 100, nutrients: {} }],
  },
};

jest.mock('@/lib/db', () => ({
  prisma: {
    fatSecretFood: { findUnique: (a: { where: { fsId: string } }) => Promise.resolve(mockFsRows[a.where.fsId] ?? null) },
    offFood: { findUnique: (a: { where: { barcode: string } }) => mockOffFindUnique(a) },
    fdcFood: { findUnique: jest.fn().mockResolvedValue(null) },
    aiGeneratedFood: { findUnique: jest.fn().mockResolvedValue(null) },
  },
}));
jest.mock('@/lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/mapping/barcode', () => ({ lookupFatSecretBarcode: jest.fn() }));
jest.mock('@/lib/mapping/cache', () => ({ ensureFoodCached: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/openfoodfacts/client', () => ({ getOffProductByBarcode: jest.fn() }));
jest.mock('@/lib/openfoodfacts/hydrate', () => ({ hydrateOffCandidate: jest.fn() }));

const { lookupFatSecretBarcode } = require('@/lib/mapping/barcode');
const { getOffProductByBarcode } = require('@/lib/openfoodfacts/client');
const { hydrateOffCandidate } = require('@/lib/openfoodfacts/hydrate');

const call = (code: string) =>
  GET(new NextRequest(`http://localhost:3000/api/foods/barcode?code=${encodeURIComponent(code)}&api_key=test-barcode-key`));

describe('/api/foods/barcode reads the local OffFood mirror before OFF live', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(mockOffRows)) delete mockOffRows[k];
    lookupFatSecretBarcode.mockResolvedValue(null);
    getOffProductByBarcode.mockResolvedValue(null);
    hydrateOffCandidate.mockResolvedValue(null);
  });

  test('(a) 12-digit scan finds the 13-digit stored row without any live call', async () => {
    mockOffRows['0038000138416'] = offRow('0038000138416');
    const res = await call('038000138416');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('off_0038000138416');
    expect(body.source).toBe('openfoodfacts');
    expect(getOffProductByBarcode).toHaveBeenCalledTimes(0);
    expect(hydrateOffCandidate).toHaveBeenCalledTimes(0);
  });

  test('(b) 13-digit scan of the same code behaves the same', async () => {
    mockOffRows['0038000138416'] = offRow('0038000138416');
    const res = await call('0038000138416');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('off_0038000138416');
    expect(body.source).toBe('openfoodfacts');
    expect(getOffProductByBarcode).toHaveBeenCalledTimes(0);
    expect(hydrateOffCandidate).toHaveBeenCalledTimes(0);
  });

  test('(c) no local row under any form: the live path runs once and its hydrate result is served', async () => {
    getOffProductByBarcode.mockResolvedValue({ code: '5000112637922', product_name: 'Live Product' });
    hydrateOffCandidate.mockImplementation((c: { id: string; name: string }) => {
      // Simulates the real upsert: the row appears in the mirror under the live code.
      mockOffRows['5000112637922'] = offRow('5000112637922');
      return Promise.resolve({ foodId: c.id, foodName: c.name, nutrientsPer100g: { calories: 53.3 } });
    });
    const res = await call(' 5000112637922 ');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('off_5000112637922');
    expect(getOffProductByBarcode).toHaveBeenCalledTimes(1);
    expect(getOffProductByBarcode).toHaveBeenCalledWith('5000112637922');
    expect(hydrateOffCandidate).toHaveBeenCalledTimes(1);
  });

  test('(d) a local row with a null panel is no_usable_panel and OFF live is never asked', async () => {
    mockOffRows['0038000138416'] = offRow('0038000138416', null);
    const res = await call('038000138416');
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('no_usable_panel');
    expect(getOffProductByBarcode).toHaveBeenCalledTimes(0);
  });

  test('(e) a FatSecret hit with a FatSecretFood row is served without touching OffFood', async () => {
    lookupFatSecretBarcode.mockResolvedValue({ foodId: '95103', name: 'x', brandName: null, source: 'fatsecret', servings: [] });
    mockOffRows['0038000138416'] = offRow('0038000138416');
    const res = await call('038000138416');
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe('fs_95103');
    expect(mockOffFindUnique).toHaveBeenCalledTimes(0);
  });

  test('(f) a throttled OFF live API (null) no longer 404s a barcode we hold', async () => {
    mockOffRows['0038000138416'] = offRow('0038000138416');
    getOffProductByBarcode.mockResolvedValue(null);
    const res = await call('038000138416');
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe('off_0038000138416');
  });
});
