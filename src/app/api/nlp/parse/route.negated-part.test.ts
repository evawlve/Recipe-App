/**
 * /api/nlp/parse - a negated / removed / excluded part never reaches the AI-nutrition lane.
 *
 * S192 row 3, acceptance (i): the SHIPPED route layer with `requestAiNutrition` mocked and reached by
 * EVERY item (the mapper mock forwards each item's rawText to it, as the real fallback does for an
 * unmapped item). Six true-positive lines (inputs verbatim from the driver draws in
 * row3/neg-base.tsv) on the SegmentationCache-hit AND the fresh-LLM path, the drop-then-fold
 * composition line, the parfait false-positive line (20.2 tuples) that keeps both items, and the
 * heuristic path as a pinned KNOWN MISS (forceSegmentText() sets normalizedForm '' and keeps removal
 * phrases inside rawText, so nothing drops there).
 *
 * "Therefore never billed / never minted" is DERIVED: no mapper call carries the dropped text.
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

// The mapper mock require()s the backfill module INSIDE the function (jest.mock hoisting) and
// forwards every item's rawText to requestAiNutrition, then reports no match.
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

interface Line {
  name: string;
  text: string;
  key: string;
  split: Seg[];
  /** rawTexts that must never reach the AI lane. */
  dropped: string[];
  /** rawTexts that must still reach it, exactly these. */
  kept: string[];
}

const TP: Line[] = [
  {
    name: 'a double cheeseburger, no bun',
    text: 'a double cheeseburger, no bun',
    key: 'a double cheeseburger, no bun',
    split: [seg('a double cheeseburger', 'double cheeseburger'), seg('no bun', 'bun')],
    dropped: ['no bun'],
    kept: ['a double cheeseburger'],
  },
  {
    name: 'a burrito bowl, no rice and no beans',
    text: 'a burrito bowl, no rice and no beans',
    key: 'a burrito bowl, no rice and no beans',
    split: [seg('a burrito bowl', 'burrito bowl'), seg('no rice', 'rice'), seg('no beans', 'beans')],
    dropped: ['no rice', 'no beans'],
    kept: ['a burrito bowl'],
  },
  {
    name: 'breakfast sandwich, no sausage',
    text: 'an egg and cheese breakfast sandwich, no sausage',
    key: 'an egg and cheese breakfast sandwich, no sausage',
    split: [seg('an egg and cheese breakfast sandwich', 'egg and cheese breakfast sandwich'), seg('no sausage', 'sausage')],
    dropped: ['no sausage'],
    kept: ['an egg and cheese breakfast sandwich'],
  },
  {
    name: 'a club sandwich, i took off the bacon',
    text: 'a club sandwich, i took off the bacon',
    key: 'a club sandwich, i took off the bacon',
    split: [seg('a club sandwich', 'club sandwich'), seg('bacon', 'bacon')],
    dropped: ['bacon'],
    kept: ['a club sandwich'],
  },
  {
    name: 'spaghetti and meatballs but i picked out the meatballs',
    text: 'spaghetti and meatballs but i picked out the meatballs',
    key: 'spaghetti and meatballs but i picked out the meatballs',
    split: [seg('spaghetti and meatballs', 'spaghetti'), seg('meatballs', 'meatballs')],
    dropped: ['meatballs'],
    kept: ['spaghetti and meatballs'],
  },
  {
    name: 'a baked potato with everything except sour cream',
    text: 'a baked potato with everything except sour cream',
    key: 'a baked potato with everything except sour cream',
    split: [seg('a baked potato', 'baked potato'), seg('everything except sour cream', 'everything except sour cream')],
    dropped: ['everything except sour cream'],
    kept: ['a baked potato'],
  },
];

const COMPOSITION = {
  text: 'a double cheeseburger, no bun, two of them',
  split: [seg('a double cheeseburger', 'double cheeseburger'), seg('no bun', 'bun')],
};

// FP line: the parfait (20.2 tuples) - the "no sugar added" item is a real food, both survive.
const PARFAIT = {
  text: 'a parfait with no sugar added greek yogurt',
  key: 'a parfait with no sugar added greek yogurt',
  split: [seg('a parfait', 'parfait'), seg('no sugar added greek yogurt', 'greek yogurt')],
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

describe('/api/nlp/parse negated part drop', () => {
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

  describe.each(TP)('$name', (line) => {
    test('SegmentationCache HIT: the dropped part never reaches requestAiNutrition', async () => {
      prisma.segmentationCache.findUnique.mockResolvedValue({
        lineKey: line.key,
        parserVersion: SEG_PARSER_VERSION,
        segmentsJson: line.split,
        hitCount: 3,
      });
      const response = await POST(parseRequest({ text: line.text }));
      expect(response.status).toBe(200);
      expect(callStructuredLlm).not.toHaveBeenCalled();
      expect(aiCalls()).toEqual(line.kept);
      for (const d of line.dropped) expect(aiCalls()).not.toContain(d);
    });

    test('fresh LLM: same reading, and the cache upsert carries the UNDROPPED split', async () => {
      llmReturns(line.split);
      const response = await POST(parseRequest({ text: line.text }));
      expect(response.status).toBe(200);
      expect(aiCalls()).toEqual(line.kept);
      for (const d of line.dropped) expect(aiCalls()).not.toContain(d);
      expect(prisma.segmentationCache.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.segmentationCache.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { lineKey_parserVersion: { lineKey: line.key, parserVersion: SEG_PARSER_VERSION } },
          create: expect.objectContaining({ segmentsJson: line.split }),
        }),
      );
    });
  });

  test('one logger line per dropping request: event, count and kinds only - no user text', async () => {
    llmReturns(TP[1].split);
    await POST(parseRequest({ text: TP[1].text }));
    const lines = infoSpy.mock.calls.filter((c: unknown[]) => c[0] === 'nlp_parse.negated_part_drop');
    expect(lines).toHaveLength(1);
    expect(lines[0][1]).toEqual({ count: 2, kinds: ['negated', 'negated'] });
  });

  // DEVIATION from design.md r2 (`2 double cheeseburger`): the fold reads lineKey, so `no bun` is still
  // the first gap piece and `two of them` is not reached. Pinned: one call, and never `2 no bun`.
  test('composition: "a double cheeseburger, no bun, two of them" -> one call, the cheeseburger, never 2 no bun', async () => {
    llmReturns(COMPOSITION.split);
    const response = await POST(parseRequest({ text: COMPOSITION.text }));
    expect(response.status).toBe(200);
    expect(aiCalls()).toEqual(['a double cheeseburger']);
    expect(aiCalls()).not.toContain('2 no bun');
  });

  test('FP line (parfait, 20.2 tuples): both items reach the AI lane, no drop line', async () => {
    llmReturns(PARFAIT.split);
    const response = await POST(parseRequest({ text: PARFAIT.text }));
    expect(response.status).toBe(200);
    expect(aiCalls()).toEqual(['a parfait', 'no sugar added greek yogurt']);
    expect(infoSpy.mock.calls.filter((c: unknown[]) => c[0] === 'nlp_parse.negated_part_drop')).toHaveLength(0);
  });

  test('heuristic path is a pinned KNOWN MISS: both items still sent, nothing cached', async () => {
    callStructuredLlm.mockResolvedValue({ status: 'error', error: 'provider exploded', provider: 'openrouter', model: 'openai/gpt-4o-mini' });
    const response = await POST(parseRequest({ text: 'a double cheeseburger, no bun' }));
    expect(response.status).toBe(200);
    const calls = aiCalls();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.some(c => /no bun/.test(c))).toBe(true);
    expect(prisma.segmentationCache.upsert).not.toHaveBeenCalled();
  });
});
