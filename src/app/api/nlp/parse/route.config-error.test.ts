/**
 * /api/nlp/parse — a missing required env var is a 500 with a FIXED body (review L7,
 * 2026-09-24). The variable's name is logged server-side, never returned to the caller.
 *
 * Harness: route.rate-limit.test.ts's mocks, driven through the dev key.
 */
import { NextRequest } from 'next/server';
import { POST } from './route';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: jest.fn() } })),
}));

jest.mock('@/lib/db', () => ({
  prisma: {
    nlpRequestLog: { count: jest.fn(), create: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn(),
    mappingEventLog: { createMany: jest.fn() },
    segmentationCache: { findUnique: jest.fn(), update: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
  },
}));

jest.mock('@/lib/ai/structured-client', () => ({ callStructuredLlm: jest.fn() }));
jest.mock('@/lib/mapping/map-ingredient-with-fallback', () => ({ mapIngredientWithFallback: jest.fn() }));

describe('/api/nlp/parse configuration error', () => {
  const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
  const saved = { db: process.env.DATABASE_URL, key: process.env.DEV_API_KEY };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass';
    delete process.env.DATABASE_URL;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => {
    if (saved.db === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved.db;
    if (saved.key === undefined) delete process.env.DEV_API_KEY; else process.env.DEV_API_KEY = saved.key;
  });

  test('DATABASE_URL unset → 500 { error: "Configuration error" }, the name only in the log', async () => {
    const res = await POST(new NextRequest('http://localhost:3000/api/nlp/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
      body: JSON.stringify({ items: ['egg'] }),
    }));
    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({ error: 'Configuration error' });
    expect(raw).not.toContain('DATABASE_URL');
    expect(console.error).toHaveBeenCalledWith(
      'NLP Parse API Error: Missing environment variables:', ['DATABASE_URL'],
    );
    expect(mapIngredientWithFallback).not.toHaveBeenCalled();
  });
});
