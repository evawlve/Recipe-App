/**
 * /api/nlp/parse - a trailing quantity clause never reaches the AI-nutrition lane.
 *
 * S192 row 2, acceptance (i): the SHIPPED route layer with `requestAiNutrition` mocked and reached by
 * EVERY item (the mapper mock forwards each item's rawText to it, as the real fallback does for an
 * unmapped item). Seven lines from the row-2 population (inputs verbatim from the driver draws in
 * row2/pop-base.tsv), on the SegmentationCache-hit path AND the fresh-LLM path, plus a heuristic
 * case (callStructuredLlm errors), the `two cookies` control, and the unfolded cache upsert.
 *
 * "The clause never reaches the AI lane" is DERIVED from this: no item carries the clause text, so
 * no mapper call carries it, so no requestAiNutrition() call does.
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

interface PopLine {
  name: string;
  text: string;
  key: string;
  split: Seg[];
  /** The clause text that must never reach the AI lane. */
  clause: string;
  folded: string;
}

const POP: PopLine[] = [
  {
    name: 'tuna salad, maybe a cup (clause as its own segment)',
    text: 'lunch was the leftover tuna salad, maybe a cup',
    key: 'lunch was the leftover tuna salad, maybe a cup',
    split: [seg('the leftover tuna salad', 'tuna salad'), seg('maybe a cup', '')],
    clause: 'maybe a cup',
    folded: '1 cup of leftover tuna salad',
  },
  {
    name: 'nuggets, maybe four (clause dropped)',
    text: "dinner was the kids' leftover chicken nuggets, maybe four",
    key: "dinner was the kids' leftover chicken nuggets, maybe four",
    split: [seg("the kids' leftover chicken nuggets", 'chicken nuggets')],
    clause: 'maybe four',
    folded: "4 kids' leftover chicken nuggets",
  },
  {
    name: 'tikka masala, maybe half',
    text: 'we ordered chicken tikka masala for dinner and i had maybe half',
    key: 'we ordered chicken tikka masala for dinner and i had maybe half',
    split: [seg('chicken tikka masala', 'chicken tikka masala'), seg('half', 'half')],
    clause: 'half',
    folded: '1/2 chicken tikka masala',
  },
  {
    name: 'hard boiled eggs, two of them (clause dropped)',
    text: 'brunch was hard boiled eggs, two of them, and some butter lettuce',
    key: 'brunch was hard boiled eggs, two of them, and some butter lettuce',
    split: [seg('hard boiled eggs', 'hard boiled eggs'), seg('butter lettuce', 'butter lettuce')],
    clause: 'two of them',
    folded: '2 hard boiled eggs',
  },
  {
    name: 'scrambled eggs, two eggs (restating segment)',
    text: 'scrambled eggs with spinach and mushrooms, two eggs',
    key: 'scrambled eggs with spinach and mushrooms, two eggs',
    split: [seg('scrambled eggs', 'scrambled eggs'), seg('spinach', 'spinach'), seg('mushrooms', 'mushrooms'), seg('two eggs', 'eggs')],
    clause: 'two eggs',
    folded: '2 scrambled eggs',
  },
  {
    name: 'soup, about two cups',
    text: 'homemade chicken noodle soup, about two cups',
    key: 'homemade chicken noodle soup, about two cups',
    split: [seg('homemade chicken noodle soup', 'chicken noodle soup'), seg('about two cups', '')],
    clause: 'about two cups',
    folded: '2 cups of homemade chicken noodle soup',
  },
  {
    name: 'hot dogs, i had one too (overlaps row 8i)',
    text: 'the kids had hot dogs and i had one too',
    key: 'the kids had hot dogs and i had one too',
    split: [seg('hot dogs', 'hot dogs'), seg('one hot dog', 'hot dog')],
    clause: 'one hot dog',
    folded: '1 hot dogs',
  },
];

const CONTROL = {
  text: 'a turkey sandwich, two cookies',
  split: [seg('a turkey sandwich', 'turkey sandwich'), seg('two cookies', 'cookies')],
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

describe('/api/nlp/parse trailing quantity fold', () => {
  const { prisma } = require('@/lib/db');
  const { callStructuredLlm } = require('@/lib/ai/structured-client');
  const { requestAiNutrition } = require('@/lib/mapping/ai-nutrition-backfill');
  const { logger } = require('@/lib/logger');
  let spies: jest.SpyInstance[] = [];
  let infoSpy: jest.SpyInstance;

  const aiCalls = (): string[] => requestAiNutrition.mock.calls.map((c: unknown[]) => c[0] as string);

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

  describe.each(POP)('$name', (line) => {
    test('SegmentationCache HIT: the clause never reaches requestAiNutrition, the folded text does', async () => {
      prisma.segmentationCache.findUnique.mockResolvedValue({
        lineKey: line.key,
        parserVersion: SEG_PARSER_VERSION,
        segmentsJson: line.split,
        hitCount: 3,
      });
      const response = await POST(parseRequest({ text: line.text }));
      expect(response.status).toBe(200);
      expect(callStructuredLlm).not.toHaveBeenCalled();

      const calls = aiCalls();
      expect(calls).not.toContain(line.clause);
      expect(calls.some(c => c === line.folded || c.startsWith(line.folded))).toBe(true);
      // Every call is one of the folded split's items (one fewer than the base split when the clause was a segment).
      expect(calls.length).toBe(line.split.length - (line.split.some(s => s.rawText === line.clause) ? 1 : 0));
    });

    test('fresh LLM: same reading, and the cache upsert carries the UNFOLDED split', async () => {
      callStructuredLlm.mockResolvedValue({
        status: 'success',
        content: { items: line.split },
        provider: 'openrouter',
        model: 'openai/gpt-4o-mini',
      });
      const response = await POST(parseRequest({ text: line.text }));
      expect(response.status).toBe(200);

      const calls = aiCalls();
      expect(calls).not.toContain(line.clause);
      expect(calls.some(c => c === line.folded || c.startsWith(line.folded))).toBe(true);
      expect(prisma.segmentationCache.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.segmentationCache.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { lineKey_parserVersion: { lineKey: line.key, parserVersion: SEG_PARSER_VERSION } },
          create: expect.objectContaining({ segmentsJson: line.split }),
        }),
      );
    });
  });

  test('one logger line per folding request: event, count and kinds only - no user text', async () => {
    callStructuredLlm.mockResolvedValue({
      status: 'success',
      content: { items: POP[1].split },
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });
    await POST(parseRequest({ text: POP[1].text }));
    const lines = infoSpy.mock.calls.filter((c: unknown[]) => c[0] === 'nlp_parse.trailing_quantity_fold');
    expect(lines).toHaveLength(1);
    expect(lines[0][1]).toEqual({ count: 1, kinds: ['gap'] });
  });

  test('the control logs no fold line', async () => {
    callStructuredLlm.mockResolvedValue({
      status: 'success',
      content: { items: CONTROL.split },
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });
    await POST(parseRequest({ text: CONTROL.text }));
    expect(infoSpy.mock.calls.filter((c: unknown[]) => c[0] === 'nlp_parse.trailing_quantity_fold')).toHaveLength(0);
  });

  test('heuristic path (callStructuredLlm errors): the clause does not reach the AI lane, nothing is cached', async () => {
    callStructuredLlm.mockResolvedValue({ status: 'error', error: 'provider exploded', provider: 'openrouter', model: 'openai/gpt-4o-mini' });
    const response = await POST(parseRequest({ text: POP[0].text }));
    expect(response.status).toBe(200);

    const calls = aiCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls).not.toContain('maybe a cup');
    expect(calls.some(c => /^1 cup of /.test(c))).toBe(true);
    expect(prisma.segmentationCache.upsert).not.toHaveBeenCalled();
  });

  test('control: "a turkey sandwich, two cookies" keeps both items - two cookies reaches the AI lane', async () => {
    callStructuredLlm.mockResolvedValue({
      status: 'success',
      content: { items: CONTROL.split },
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });
    const response = await POST(parseRequest({ text: CONTROL.text }));
    expect(response.status).toBe(200);
    expect(aiCalls().filter(c => c === 'two cookies').length).toBeGreaterThanOrEqual(1);
    expect(aiCalls()).toContain('a turkey sandwich');
  });
});
