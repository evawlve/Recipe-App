import { NextRequest } from 'next/server';
import { safeEqualSecret } from './safe-equal';
import { POST as rollupPOST } from '@/app/api/admin/cron/rollup/route';
import { POST as similarPOST } from '@/app/api/admin/cron/similar/route';

describe('safeEqualSecret', () => {
  test('equal non-empty strings match', () => {
    expect(safeEqualSecret('s3cret-value', 's3cret-value')).toBe(true);
  });

  test('different strings, including different lengths and a shared prefix, do not match', () => {
    expect(safeEqualSecret('s3cret-value', 's3cret-valuX')).toBe(false);
    expect(safeEqualSecret('s3cret', 's3cret-value')).toBe(false);
    expect(safeEqualSecret('s3cret-value-and-more', 's3cret-value')).toBe(false);
  });

  test('fails closed on an unset or empty side', () => {
    expect(safeEqualSecret('x', undefined)).toBe(false);
    expect(safeEqualSecret('x', '')).toBe(false);
    expect(safeEqualSecret(null, 'x')).toBe(false);
    expect(safeEqualSecret('', '')).toBe(false);
    expect(safeEqualSecret(undefined, undefined)).toBe(false);
  });
});

// The cron routes refuse before importing anything heavy, so the 401 path needs no mocks.
describe('cron routes keep failing closed', () => {
  const routes = [
    ['rollup', rollupPOST],
    ['similar', similarPOST],
  ] as const;

  function req(headers: Record<string, string>) {
    return new NextRequest('http://localhost/api/admin/cron/x', { method: 'POST', headers });
  }

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  test.each(routes)('%s: unset CRON_SECRET refuses even an empty header', async (_name, POST) => {
    delete process.env.CRON_SECRET;
    expect((await POST(req({ 'x-cron-secret': '' }))).status).toBe(401);
    expect((await POST(req({}))).status).toBe(401);
  });

  test.each(routes)('%s: a wrong secret is 401', async (_name, POST) => {
    process.env.CRON_SECRET = 'cron-test-secret';
    expect((await POST(req({ 'x-cron-secret': 'cron-test-secreX' }))).status).toBe(401);
    expect((await POST(req({ 'x-cron-secret': 'cron' }))).status).toBe(401);
  });
});
