/**
 * /api/nlp/parse - s447a: the solo fast path subtracts ONE fixed portion of a CARRIED generic
 * component from the billed head (`a cobb salad without the egg`), says so in `adjustments`, and
 * audits `nlp_parse.solo_subtraction`. Absent (no key, no audit) when there is no removal clause.
 * The pinned `nlp_parse.solo_removal` audit is unchanged.
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

const COBB_MAPPED = {
  foodId: 'fs_1', foodName: 'Cobb Salad', brandName: null, source: 'fatsecret', confidence: 0.9,
  servingDescription: '1 salad', grams: 300, kcal: 400, protein: 30, carbs: 12, fat: 28,
};

function cobbDetails(source = 'fatsecret') {
  return {
    name: 'Cobb Salad', brandName: null, source,
    nutritionPer100g: {
      kcal100: 133.33, protein100: 10, carbs100: 4, fat100: 9.33, fiber100: 1, sugar100: 1, sodium100: 0.3,
    },
    servingOptions: [{ label: '1 salad', grams: 300, type: 'count', isDefault: true }],
  };
}

function parseRequest(text: string, query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/nlp/parse${query}`, {
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

describe('/api/nlp/parse solo component subtraction', () => {
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
    mapIngredientWithFallback.mockResolvedValue(COBB_MAPPED);
    resolveFoodDetails.mockResolvedValue(cobbDetails());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a cobb salad without the egg: billed total drops, adjustments say so, both audits fire', async () => {
    const item = await parseOne('a cobb salad without the egg');
    expect(item.nutrition.calories).toBeCloseTo(323, 1);
    expect(item.nutritionPer100g.kcal100 * item.grams / 100).toBeCloseTo(item.nutrition.calories, 0);
    expect(item.adjustments).toHaveLength(1);
    expect(item.adjustments[0].component).toBe('egg');
    expect(item.adjustments[0].foodId).toBe('fs_3094');
    expect(item.foodName).toBe('Cobb Salad');
    expect(item.foodId).toBe('fs_1');
    expect(item.grams).toBe(300);
    expect(auditsNamed('nlp_parse.solo_subtraction')).toEqual([[
      'nlp_parse.solo_subtraction',
      { head: 'a cobb salad', clause: 'without the egg', subtracted: ['egg'], partSkips: [], skipped: null },
    ]]);
    expect(audit).toHaveBeenCalledWith('nlp_parse.solo_removal', { head: 'a cobb salad', clause: 'without the egg' });
  });

  test('the streamed item frame carries adjustments', async () => {
    const response = await POST(parseRequest('a cobb salad without the egg', '?stream=1'));
    expect(response.status).toBe(200);
    const { frames } = decodeSseFrames(await response.text());
    const itemFrames = frames.filter(f => f.type === 'item');
    expect(itemFrames).toHaveLength(1);
    const streamed = (itemFrames[0] as {
      item: { nutrition: { calories: number }; adjustments: { component: string }[] };
    }).item;
    expect(streamed.nutrition.calories).toBeCloseTo(323, 1);
    expect(streamed.adjustments[0].component).toBe('egg');
  });

  test('a cobb salad (no clause): no adjustments key, no subtraction audit, bill untouched', async () => {
    const item = await parseOne('a cobb salad');
    expect('adjustments' in item).toBe(false);
    expect(item.nutrition.calories).toBe(400);
    expect(auditsNamed('nlp_parse.solo_subtraction')).toHaveLength(0);
  });

  test('a hot dog without the bun on an ai_estimated winner: no adjustments, audit skipped unmapped', async () => {
    mapIngredientWithFallback.mockResolvedValue({ ...COBB_MAPPED, foodName: 'Hot Dog', kcal: 290, grams: 100 });
    resolveFoodDetails.mockResolvedValue({ ...cobbDetails('ai_estimated'), name: 'Hot Dog' });
    const item = await parseOne('a hot dog without the bun');
    expect('adjustments' in item).toBe(false);
    expect(item.nutrition.calories).toBe(290);
    expect(auditsNamed('nlp_parse.solo_subtraction')).toEqual([[
      'nlp_parse.solo_subtraction',
      { head: 'a hot dog', clause: 'without the bun', subtracted: [], partSkips: [], skipped: 'unmapped' },
    ]]);
  });

  test('a waffle without syrup (no carrier): bill untouched, audit skipped no_carrier', async () => {
    mapIngredientWithFallback.mockResolvedValue({ ...COBB_MAPPED, foodName: 'Waffles', kcal: 180, grams: 75, protein: 4, carbs: 25, fat: 7 });
    resolveFoodDetails.mockResolvedValue({
      ...cobbDetails(), name: 'Waffles',
      nutritionPer100g: { kcal100: 240, protein100: 5.33, carbs100: 33.33, fat100: 9.33, fiber100: null, sugar100: null, sodium100: null },
    });
    const item = await parseOne('a waffle without syrup');
    expect('adjustments' in item).toBe(false);
    expect(item.nutrition.calories).toBe(180);
    expect(auditsNamed('nlp_parse.solo_subtraction')[0][1].skipped).toBe('no_carrier');
  });
});
