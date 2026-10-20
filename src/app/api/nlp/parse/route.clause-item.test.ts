/**
 * /api/nlp/parse - a partial-eat clause the segmenter emits as its own item is not a food (S240 rowMint, MGR 00:16Z).
 * `a muffin` + [`ate the top only`] -> the mapper is called once with `1/2 muffin`; a clause that holds another food
 * (`shared half and a coke`) is left as typed.
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

type Seg = { rawText: string; mealType: string; brand: string; normalizedForm: string };
const seg = (rawText: string, normalizedForm = ''): Seg => ({ rawText, mealType: 'lunch', brand: '', normalizedForm });

function parseRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'adminAPI_dev_key_bypass', // dev bypass: skips Supabase auth + rate limiting
    },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse clause-item fold', () => {
  const { prisma } = require('@/lib/db');
  const { callStructuredLlm } = require('@/lib/ai/structured-client');
  const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
  const { logger } = require('@/lib/logger');
  let spies: jest.SpyInstance[] = [];

  const mapperTexts = (): string[] => mapIngredientWithFallback.mock.calls.map((c: unknown[]) => c[0] as string);

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
    process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass';
    delete process.env.MAPPING_EVENT_LOG_ENABLED;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    spies = [
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

  const llm = (items: Seg[]) =>
    callStructuredLlm.mockResolvedValue({
      status: 'success',
      content: { items },
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });

  test('a muffin, ate the top only: the clause item is dropped, the mapper is called once with 1/2 muffin', async () => {
    llm([seg('a muffin', 'muffin'), seg('ate the top only', 'top of muffin')]);
    const response = await POST(parseRequest({ text: 'a muffin, ate the top only' }));
    expect(response.status).toBe(200);
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
    expect(mapperTexts()).toEqual(['1/2 muffin']);
  });

  test('control: a pizza, shared half and a coke - the clause holds a coke, both items reach the mapper as typed', async () => {
    llm([seg('a pizza', 'pizza'), seg('shared half and a coke', 'coke')]);
    const response = await POST(parseRequest({ text: 'a pizza, shared half and a coke' }));
    expect(response.status).toBe(200);
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(2);
    expect(mapperTexts()).toEqual(['a pizza', 'shared half and a coke']);
  });
});
