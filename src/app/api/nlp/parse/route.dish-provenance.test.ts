/**
 * /api/nlp/parse - a whole provenance phrase (`from last night's dinner`) does not end the dish-part list.
 *
 * S240 cloud-36 C12. Mirrors route.dish-part.test.ts: the SHIPPED route layer with the mapper mocked,
 * on the SegmentationCache-hit AND the fresh-LLM path.
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

jest.mock('@/lib/mapping/ai-nutrition-backfill', () => ({
  ...jest.requireActual('@/lib/mapping/ai-nutrition-backfill'),
  requestAiNutrition: jest.fn(),
}));

jest.mock('@/lib/mapping/map-ingredient-with-fallback', () => ({
  mapIngredientWithFallback: jest.fn(async (rawText: string) => {
    const { requestAiNutrition } = require('@/lib/mapping/ai-nutrition-backfill');
    await requestAiNutrition(rawText);
    return { status: 'no_match' };
  }),
}));

jest.mock('@/lib/nlp/resolve-payload', () => ({
  resolveFoodDetails: jest.fn(),
}));

type Seg = { rawText: string; mealType: string; brand: string; normalizedForm: string };
const seg = (rawText: string, normalizedForm = ''): Seg => ({ rawText, mealType: 'lunch', brand: '', normalizedForm });

const PROV = {
  text: "a homemade burrito with chicken from last night's dinner and rice",
  split: [seg('a homemade burrito', 'burrito'), seg('chicken', 'chicken'), seg('rice', 'rice')],
  kept: ['a homemade burrito'],
};

const CONTROL = {
  text: 'a homemade burrito with eggs and cheese. later steak',
  split: [seg('a homemade burrito', 'burrito'), seg('eggs', 'eggs'), seg('cheese', 'cheese'), seg('steak', 'steak')],
  kept: ['a homemade burrito', 'steak'],
};

function parseRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse dish part drop - provenance phrase', () => {
  const { prisma } = require('@/lib/db');
  const { callStructuredLlm } = require('@/lib/ai/structured-client');
  const { requestAiNutrition } = require('@/lib/mapping/ai-nutrition-backfill');
  const { logger } = require('@/lib/logger');
  let spies: jest.SpyInstance[] = [];

  const aiCalls = (): string[] => requestAiNutrition.mock.calls.map((c: unknown[]) => c[0] as string);
  const llmReturns = (items: Seg[]) =>
    callStructuredLlm.mockResolvedValue({
      status: 'success',
      content: { items },
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });
  const cacheHit = (text: string, split: Seg[]) =>
    prisma.segmentationCache.findUnique.mockResolvedValue({
      lineKey: text,
      parserVersion: SEG_PARSER_VERSION,
      segmentsJson: split,
      hitCount: 3,
    });

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

  test('SegmentationCache HIT: the burrito is billed once, chicken and rice are parts', async () => {
    cacheHit(PROV.text, PROV.split);
    const response = await POST(parseRequest({ text: PROV.text }));
    expect(response.status).toBe(200);
    expect(callStructuredLlm).not.toHaveBeenCalled();
    expect(aiCalls()).toEqual(PROV.kept);
  });

  test('fresh LLM: same reading', async () => {
    llmReturns(PROV.split);
    const response = await POST(parseRequest({ text: PROV.text }));
    expect(response.status).toBe(200);
    expect(aiCalls()).toEqual(PROV.kept);
  });

  test('control, SegmentationCache HIT: a clause word after a sentence boundary still ends the list', async () => {
    cacheHit(CONTROL.text, CONTROL.split);
    await POST(parseRequest({ text: CONTROL.text }));
    expect(aiCalls()).toEqual(CONTROL.kept);
  });

  test('control, fresh LLM: a clause word after a sentence boundary still ends the list', async () => {
    llmReturns(CONTROL.split);
    await POST(parseRequest({ text: CONTROL.text }));
    expect(aiCalls()).toEqual(CONTROL.kept);
  });
});
