/**
 * /api/fatsecret/barcode spends FatSecret API quota on every call. It was anonymous until
 * the 2026-09-24 security review; these pins keep it behind the key/bearer chokepoint and
 * keep upstream error text out of the 500 body.
 */

const mockLookup = jest.fn();
jest.mock('@/lib/mapping/barcode', () => ({
  lookupFatSecretBarcode: (...a: unknown[]) => mockLookup(...a),
}));
jest.mock('@/lib/mapping/config', () => ({ FATSECRET_ENABLED: true }));
jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn() } }));

const mockGetUser = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: (...a: unknown[]) => mockGetUser(...a) } })),
}));

import { NextRequest } from 'next/server';
import { GET } from './route';

process.env.DEV_API_KEY = 'test-fs-barcode-key';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://unit.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-test';

function req(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/fatsecret/barcode?barcode=0123456789012', {
    method: 'GET',
    headers,
  });
}

beforeEach(() => {
  mockLookup.mockReset();
  mockGetUser.mockReset();
});

test('anonymous caller is 401 and FatSecret is never called', async () => {
  const res = await GET(req());
  expect(res.status).toBe(401);
  expect(mockLookup).not.toHaveBeenCalled();
});

test('a rejected bearer is 401 and FatSecret is never called', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } });
  const res = await GET(req({ Authorization: 'Bearer nope' }));
  expect(res.status).toBe(401);
  expect(mockLookup).not.toHaveBeenCalled();
});

test('a valid bearer reaches the lookup', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'u1@example.org' } }, error: null });
  mockLookup.mockResolvedValue({ foodId: '1', name: 'x', brandName: null, source: 'fatsecret', servings: [] });
  const res = await GET(req({ Authorization: 'Bearer ok' }));
  expect(res.status).toBe(200);
  expect(mockLookup).toHaveBeenCalledWith('0123456789012');
});

test('an upstream throw is a 500 whose body carries no error text', async () => {
  mockLookup.mockRejectedValue(new Error('upstream secret detail'));
  const res = await GET(req({ 'x-api-key': 'test-fs-barcode-key' }));
  expect(res.status).toBe(500);
  const body = await res.json();
  expect(body).toEqual({ error: 'Internal server error' });
  expect(JSON.stringify(body)).not.toContain('upstream secret detail');
});
