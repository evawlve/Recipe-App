/**
 * /api/nlp/parse - S240 (MGR 17:30Z relay 3): a removal clause on the single-item fast path
 * (`a cobb salad without the egg`) never reaches the mapper; the segmenter never runs; the clause is audited.
 * Controls (absence tail, size word) keep the line as typed.
 */

import { NextRequest } from 'next/server';
import { POST } from './route';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: jest.fn() } })),
}));

jest.mock('@/lib/db', () => ({
  prisma: {
    nlpRequestLog: { count: jest.fn(), create: jest.fn(), deleteMany: jest.fn(async () => ({ count: 0 })) },
    mappingEventLog: { createMany: jest.fn() },
    segmentationCache: {
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/ai/structured-client', () => ({
  callStructuredLlm: jest.fn(),
}));

jest.mock('@/lib/mapping/map-ingredient-with-fallback', () => ({
  mapIngredientWithFallback: jest.fn(async () => ({ status: 'no_match' })),
}));

jest.mock('@/lib/nlp/resolve-payload', () => ({
  resolveFoodDetails: jest.fn(),
}));

function parseRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse solo removal clause on the fast path', () => {
  const { prisma } = require('@/lib/db');
  const { callStructuredLlm } = require('@/lib/ai/structured-client');
  const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
  const { logger } = require('@/lib/logger');
  let spies: jest.SpyInstance[] = [];
  let audit: jest.SpyInstance;

  const mapperCalls = (): string[] => mapIngredientWithFallback.mock.calls.map((c: unknown[]) => c[0] as string);
  const soloAudits = () => audit.mock.calls.filter((c: unknown[]) => c[0] === 'nlp_parse.solo_removal');

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
    process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass';
    delete process.env.MAPPING_EVENT_LOG_ENABLED;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    audit = jest.spyOn(logger, 'audit').mockImplementation(() => undefined);
    spies = [
      audit,
      jest.spyOn(logger, 'info').mockImplementation(() => undefined),
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
    ];
    prisma.segmentationCache.findUnique.mockResolvedValue(null);
    prisma.segmentationCache.update.mockResolvedValue({});
    prisma.segmentationCache.upsert.mockResolvedValue({});
    prisma.mappingEventLog.createMany.mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    for (const s of spies) s.mockRestore();
  });

  test('a cobb salad without the egg -> mapper once with the head, no segmenter, audited', async () => {
    const response = await POST(parseRequest({ text: 'a cobb salad without the egg' }));
    expect(response.status).toBe(200);
    expect(callStructuredLlm).not.toHaveBeenCalled();
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
    expect(mapperCalls()).toEqual(['a cobb salad']);
    expect(audit).toHaveBeenCalledWith('nlp_parse.solo_removal', { head: 'a cobb salad', clause: 'without the egg' });
  });

  test('a burger without onions or pickles -> a burger', async () => {
    const response = await POST(parseRequest({ text: 'a burger without onions or pickles' }));
    expect(response.status).toBe(200);
    expect(callStructuredLlm).not.toHaveBeenCalled();
    expect(mapperCalls()).toEqual(['a burger']);
    expect(soloAudits()).toHaveLength(1);
  });

  test.each([
    ['absence control', 'a coke without sugar'],
    ['size control', 'coffee without cream lg'],
  ])('%s: %s stays as typed', async (_name, text) => {
    const response = await POST(parseRequest({ text }));
    expect(response.status).toBe(200);
    expect(callStructuredLlm).not.toHaveBeenCalled();
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
    expect(mapperCalls()).toEqual([text]);
    expect(soloAudits()).toHaveLength(0);
  });
});
