/**
 * /api/nlp/parse - a homemade dish named with its parts bills the dish, not the dish and every part.
 *
 * S192 row 4 (seat C69 S202 row 2), Diego's Option A (2026-10-17). The SHIPPED route layer with the mapper
 * mocked: it records every rawText it is called with. The pass runs on the SegmentationCache-hit AND the
 * fresh-LLM path (the cache upsert keeps the UNDROPPED split), and runs BEFORE the trailing-quantity fold.
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

const BOWL = {
  text: 'a burrito bowl i made with brown rice, black beans, chicken and salsa',
  key: 'a burrito bowl i made with brown rice, black beans, chicken and salsa',
  split: [
    seg('a burrito bowl', 'burrito bowl'),
    seg('brown rice', 'brown rice'),
    seg('black beans', 'black beans'),
    seg('chicken', 'chicken'),
    seg('salsa', 'salsa'),
  ],
  kept: ['a burrito bowl'],
};

const PIZZA = {
  text: 'a homemade pizza with pepperoni and mushrooms, two slices',
  key: 'a homemade pizza with pepperoni and mushrooms, two slices',
  split: [
    seg('a homemade pizza', 'homemade pizza'),
    seg('pepperoni', 'pepperoni'),
    seg('mushrooms', 'mushrooms'),
    seg('two slices', 'slices'),
  ],
};

function parseRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse dish part drop', () => {
  const { prisma } = require('@/lib/db');
  const { callStructuredLlm } = require('@/lib/ai/structured-client');
  const { requestAiNutrition } = require('@/lib/mapping/ai-nutrition-backfill');
  const { logger } = require('@/lib/logger');
  let spies: jest.SpyInstance[] = [];
  let infoSpy: jest.SpyInstance;

  const aiCalls = (): string[] => requestAiNutrition.mock.calls.map((c: unknown[]) => c[0] as string);
  const llmReturns = (items: Seg[]) =>
    callStructuredLlm.mockResolvedValue({
      status: 'success',
      content: { items },
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
    process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass';
    delete process.env.MAPPING_EVENT_LOG_ENABLED;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    spies = [
      infoSpy,
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

  test('SegmentationCache HIT: only the dish reaches the mapper', async () => {
    prisma.segmentationCache.findUnique.mockResolvedValue({
      lineKey: BOWL.key,
      parserVersion: SEG_PARSER_VERSION,
      segmentsJson: BOWL.split,
      hitCount: 3,
    });
    const response = await POST(parseRequest({ text: BOWL.text }));
    expect(response.status).toBe(200);
    expect(callStructuredLlm).not.toHaveBeenCalled();
    expect(aiCalls()).toEqual(BOWL.kept);
  });

  test('fresh LLM: same reading, and the cache upsert carries the UNDROPPED split', async () => {
    llmReturns(BOWL.split);
    const response = await POST(parseRequest({ text: BOWL.text }));
    expect(response.status).toBe(200);
    expect(aiCalls()).toEqual(BOWL.kept);
    expect(prisma.segmentationCache.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.segmentationCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lineKey_parserVersion: { lineKey: BOWL.key, parserVersion: SEG_PARSER_VERSION } },
        create: expect.objectContaining({ segmentsJson: BOWL.split }),
      }),
    );
  });

  test('one logger line per dropping request: event and count only - no user text', async () => {
    llmReturns(BOWL.split);
    await POST(parseRequest({ text: BOWL.text }));
    const lines = infoSpy.mock.calls.filter((c: unknown[]) => c[0] === 'nlp_parse.dish_part_drop');
    expect(lines).toHaveLength(1);
    expect(lines[0][1]).toEqual({ count: 4 });
  });

  test('a line with no trigger: every item still reaches the mapper, no drop line', async () => {
    llmReturns(BOWL.split);
    await POST(parseRequest({ text: 'a burrito bowl, brown rice, black beans, chicken and salsa' }));
    expect(aiCalls()).toHaveLength(5);
    expect(infoSpy.mock.calls.filter((c: unknown[]) => c[0] === 'nlp_parse.dish_part_drop')).toHaveLength(0);
  });

  test('ORDER drop -> dish -> fold: "a homemade pizza with pepperoni and mushrooms, two slices" -> one call, "2 slices of homemade pizza"', async () => {
    llmReturns(PIZZA.split);
    const response = await POST(parseRequest({ text: PIZZA.text }));
    expect(response.status).toBe(200);
    expect(aiCalls()).toEqual(['2 slices of homemade pizza']);
  });
});
