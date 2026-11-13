/**
 * /api/nlp/parse - a dropped partial-eat clause scales the item it follows (S240, MGR route 4).
 * SegmentationCache-hit AND fresh-AI paths; the cache upsert carries the UNFOLDED split; a control line is unchanged.
 */

import { NextRequest } from 'next/server';
import { POST } from './route';
import { SEG_PARSER_VERSION } from '@/lib/nlp/ai-segmenter';

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

const SANDWICH = {
  text: 'a sandwich, i gave half to my friend',
  key: 'a sandwich, i gave half to my friend',
  split: [seg('a sandwich', 'sandwich')],
};
const CONTROL = {
  text: 'a muffin, a coffee, ate the top only',
  key: 'a muffin, a coffee, ate the top only',
  split: [seg('a muffin', 'muffin'), seg('a coffee', 'coffee')],
};

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

describe('/api/nlp/parse partial-eat fold', () => {
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

  test('SegmentationCache HIT: the mapper is called once with 1/2 sandwich', async () => {
    prisma.segmentationCache.findUnique.mockResolvedValue({
      lineKey: SANDWICH.key,
      parserVersion: SEG_PARSER_VERSION,
      segmentsJson: SANDWICH.split,
      hitCount: 3,
    });
    const response = await POST(parseRequest({ text: SANDWICH.text }));
    expect(response.status).toBe(200);
    expect(callStructuredLlm).not.toHaveBeenCalled();
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
    expect(mapperTexts()).toEqual(['1/2 sandwich']);
  });

  test('fresh LLM: 1/2 sandwich, and the cache upsert carries the UNFOLDED split', async () => {
    callStructuredLlm.mockResolvedValue({
      status: 'success',
      content: { items: SANDWICH.split },
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });
    const response = await POST(parseRequest({ text: SANDWICH.text }));
    expect(response.status).toBe(200);
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
    expect(mapperTexts()).toEqual(['1/2 sandwich']);
    expect(prisma.segmentationCache.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.segmentationCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lineKey_parserVersion: { lineKey: SANDWICH.key, parserVersion: SEG_PARSER_VERSION } },
        create: expect.objectContaining({ segmentsJson: SANDWICH.split }),
      }),
    );
    expect(mapperTexts()).not.toContain('a sandwich');
  });

  test('control: a muffin, a coffee, ate the top only - both items unchanged', async () => {
    callStructuredLlm.mockResolvedValue({
      status: 'success',
      content: { items: CONTROL.split },
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });
    const response = await POST(parseRequest({ text: CONTROL.text }));
    expect(response.status).toBe(200);
    expect(mapperTexts().sort()).toEqual(['a coffee', 'a muffin']);
  });
});
