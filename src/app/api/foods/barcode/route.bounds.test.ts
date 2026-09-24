/**
 * /api/foods/barcode — the `code` bound (review M2's input half, 2026-09-24): 6-14 digits,
 * refused with a 400 BEFORE any upstream lookup, so a random string no longer costs a
 * FatSecret call and an Open Food Facts call. The bound is wider than anything the app
 * sends: the scanner reads ean13/ean8/upc_a/upc_e (`barcodeTypes` in mobile
 * src/app/scan.tsx) and `isPlausibleBarcode()` in mobile src/lib/barcode-hit.ts floors
 * the code at /^\d{8,14}$/.
 *
 * Harness: route.test.ts's module mocks, minus its fixtures (no lookup here resolves).
 */

// The route fails closed: authorization needs DEV_API_KEY set in the env.
process.env.DEV_API_KEY = 'test-barcode-key';

import { NextRequest } from 'next/server';
import { GET } from './route';

jest.mock('@/lib/db', () => ({
  prisma: {
    fatSecretFood: { findUnique: jest.fn().mockResolvedValue(null) },
    offFood: { findUnique: jest.fn().mockResolvedValue(null) },
    fdcFood: { findUnique: jest.fn().mockResolvedValue(null) },
    aiGeneratedFood: { findUnique: jest.fn().mockResolvedValue(null) },
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
  getOffProductByBarcode: jest.fn(),
}));

jest.mock('@/lib/openfoodfacts/hydrate', () => ({
  hydrateOffCandidate: jest.fn(),
}));

const { lookupFatSecretBarcode } = require('@/lib/mapping/barcode');
const { getOffProductByBarcode } = require('@/lib/openfoodfacts/client');

const call = (code: string) =>
  GET(new NextRequest(
    `http://localhost:3000/api/foods/barcode?code=${encodeURIComponent(code)}&api_key=test-barcode-key`,
  ));

describe('/api/foods/barcode code bound', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lookupFatSecretBarcode.mockResolvedValue(null);
    getOffProductByBarcode.mockResolvedValue(null);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  test.each(['abc', '12345', '123456789012345', '0380001384a6', '038-000-138416', '+038000138416', '1e10'])(
    '%p → 400 and no upstream lookup runs',
    async (code) => {
      const res = await call(code);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'code must be 6 to 14 digits' });
      expect(lookupFatSecretBarcode).not.toHaveBeenCalled();
      expect(getOffProductByBarcode).not.toHaveBeenCalled();
    },
  );

  test.each([
    ['UPC-E, 6 digits', '012345'],
    ['EAN-8', '96385074'],
    ['UPC-A', '038000138416'],
    ['EAN-13', '4006381333931'],
    ['GTIN-14', '10038000138413'],
    ['padded with spaces (trimmed, as before)', '  038000138416  '],
  ])('%s → admitted: the lookups run', async (_label, code) => {
    const res = await call(code);
    expect(res.status).not.toBe(400);
    expect(lookupFatSecretBarcode).toHaveBeenCalledWith(code.trim());
  });

  test('a missing code keeps its own 400', async () => {
    const res = await GET(new NextRequest('http://localhost:3000/api/foods/barcode?api_key=test-barcode-key'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'code query parameter is required' });
  });
});
