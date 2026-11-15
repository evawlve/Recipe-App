/**
 * /api/nlp/parse - s458 RM-a: a `no X` clause in an ITEM's own text (the line is never stripped, the mapper still
 * sees it) subtracts like `without X` does, and audits `nlp_parse.clause_subtraction`. A winner whose name already
 * lacks the part (`(No Mayo)`) is skipped `already_removed`. No clause, no audit.
 *
 * Mocks: the supabase / db / mapper / resolve-payload mocks of route.sugar-sodium-null.test.ts;
 * the REAL logger with a spy, as route.solo-removal.test.ts does.
 */

import { NextRequest } from 'next/server';
import { POST } from './route';
import { decodeSseFrames } from '@/lib/nlp/parse-stream';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: jest.fn() } })),
}));

jest.mock('@/lib/db', () => ({
  prisma: {
    nlpRequestLog: { count: jest.fn(), create: jest.fn(), deleteMany: jest.fn(async () => ({ count: 0 })) },
    mappingEventLog: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  },
}));

jest.mock('@/lib/mapping/map-ingredient-with-fallback', () => ({
  mapIngredientWithFallback: jest.fn(),
}));

jest.mock('@/lib/nlp/resolve-payload', () => ({
  ...jest.requireActual('@/lib/nlp/resolve-payload'),
  resolveFoodDetails: jest.fn(),
}));

const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
const { resolveFoodDetails } = require('@/lib/nlp/resolve-payload');
const { logger } = require('@/lib/logger');

const MAPPED = {
  foodId: 'fs_1', foodName: 'Cheeseburger', brandName: null, source: 'fatsecret', confidence: 0.9,
  servingDescription: '1 burger', grams: 150, kcal: 300, protein: 15, carbs: 20, fat: 15,
};

function details(name: string) {
  return {
    name, brandName: null, source: 'fatsecret',
    nutritionPer100g: { kcal100: 200, protein100: 10, carbs100: 13.33, fat100: 10, fiber100: 1, sugar100: 1, sodium100: 0.3 },
    servingOptions: [{ label: '1 burger', grams: 150, type: 'count', isDefault: true }],
  };
}

function parseRequest(text: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
    body: JSON.stringify({ text }),
  });
}

async function parseOne(text: string) {
  const response = await POST(parseRequest(text));
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data).toHaveLength(1);
  return data[0];
}

describe('/api/nlp/parse item clause subtraction (no X)', () => {
  let audit: jest.SpyInstance;
  const auditsNamed = (name: string) => audit.mock.calls.filter((c: unknown[]) => c[0] === name);

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
    process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass';
    process.env.MAPPING_EVENT_LOG_ENABLED = 'false';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    audit = jest.spyOn(logger, 'audit').mockImplementation(() => undefined);
    jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mapIngredientWithFallback.mockResolvedValue(MAPPED);
    resolveFoodDetails.mockResolvedValue(details('Cheeseburger'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a cheeseburger no cheese: mapper sees the whole line, bill drops, clause_subtraction audit, no solo audits', async () => {
    const item = await parseOne('a cheeseburger no cheese');
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
    expect(mapIngredientWithFallback.mock.calls[0][0]).toBe('a cheeseburger no cheese');
    expect(item.nutrition.calories).toBeCloseTo(229.2, 1);
    expect(item.adjustments[0].component).toBe('cheese');
    expect(auditsNamed('nlp_parse.clause_subtraction')).toEqual([[
      'nlp_parse.clause_subtraction',
      { head: 'a cheeseburger no cheese', clause: 'no cheese', subtracted: ['cheese'], partSkips: [], skipped: null },
    ]]);
    expect(auditsNamed('nlp_parse.solo_removal')).toHaveLength(0);
    expect(auditsNamed('nlp_parse.solo_subtraction')).toHaveLength(0);
  });

  test('wendys baconator no mayo on a winner already named (No Mayo): no adjustments, skipped already_removed', async () => {
    resolveFoodDetails.mockResolvedValue(details('Crispy Chicken Sandwich (No Mayo)'));
    mapIngredientWithFallback.mockResolvedValue({ ...MAPPED, foodName: 'Crispy Chicken Sandwich (No Mayo)' });
    const item = await parseOne('wendys baconator no mayo');
    expect('adjustments' in item).toBe(false);
    expect(item.nutrition.calories).toBe(300);
    const audits = auditsNamed('nlp_parse.clause_subtraction');
    expect(audits).toHaveLength(1);
    expect(audits[0][1].skipped).toBe('already_removed');
  });

  test('a cheeseburger (no clause): no clause audit', async () => {
    const item = await parseOne('a cheeseburger');
    expect('adjustments' in item).toBe(false);
    expect(auditsNamed('nlp_parse.clause_subtraction')).toHaveLength(0);
  });
});
