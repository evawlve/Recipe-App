/**
 * /api/nlp/parse — an undeclared sugar or sodium is `null` on the wire, never a
 * fabricated 0. The sibling of route.fiber-null.test.ts, one PR later (#134).
 *
 * WHAT IT ASSERTS. When the resolved record's `sugar100`/`sodium100` is null,
 * the billed `nutrition.sugar`/`.sodium` is null and `nutritionPer100g.*100` is
 * null — the KEY present, the value null, so a client can tell "no claim" from
 * "0 g". A declared 0 bills 0; a declared number scales as before. The
 * unresolved shape is null too. The degenerate-panel repair re-derives only the
 * four macros and must not resurrect a 0. The `?stream=1` item frame carries the
 * same values, because `buildParsedItem()` is shared.
 *
 * WHY A ROUTE TEST. resolve-payload-sugar-sodium-null.test.ts proves the
 * resolver returns null; the route then read `(sugar100 ?? 0) * scale` and
 * folded it straight back to 0, so the resolver could be perfect and the wire
 * still wrong. This file is what goes red then.
 *
 * WHY 0-IN-0-OUT IS PINNED PER FIELD. A null-only pin also passes on a
 * `|| null` implementation, and `0 || null` is null — which would silently
 * delete every DECLARED zero. Sugar has many real ones (a diet soda's 0 g is a
 * measurement, not a silence), so the control is the more valuable half.
 *
 * RED on the pre-fix tree: every `toBeNull()` here fails on master @ 4a1ca59.
 *
 * Harness: route.fiber-null.test.ts's, unchanged.
 */

import { NextRequest } from 'next/server';
import { POST } from './route';
import { decodeSseFrames } from '@/lib/nlp/parse-stream';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: jest.fn() } })),
}));

jest.mock('@/lib/db', () => ({
  prisma: {
    nlpRequestLog: { count: jest.fn(), create: jest.fn() },
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

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
const { resolveFoodDetails } = require('@/lib/nlp/resolve-payload');

/** off_0850003023175 "Blueberry" as the mapper bills it: 148 g of a 72 kcal/100 g panel. */
const BLUEBERRY_MAPPED = {
  foodId: 'off_0850003023175',
  foodName: 'Blueberry',
  brandName: null,
  source: 'openfoodfacts',
  confidence: 0.9,
  servingDescription: '1 cup',
  grams: 148,
  kcal: 106.6,
  protein: 1.2,
  carbs: 21.3,
  fat: 2.4,
  servingTier: 'bare_label_serving',
};

function blueberryDetails(sugar100: number | null, sodium100: number | null) {
  return {
    name: 'Blueberry',
    brandName: null,
    source: 'openfoodfacts',
    nutritionPer100g: {
      kcal100: 72, protein100: 0.8, carbs100: 14.4, fat100: 1.6,
      fiber100: 2.4, sugar100, sodium100,
    },
    servingOptions: [{ label: '1 cup', grams: 148, type: 'volume', isDefault: true }],
  };
}

function parseRequest(text: string, query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/nlp/parse${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'adminAPI_dev_key_bypass',
    },
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

describe('/api/nlp/parse sugar and sodium: null is not 0', () => {
  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
    process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass';
    process.env.MAPPING_EVENT_LOG_ENABLED = 'false';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mapIngredientWithFallback.mockResolvedValue(BLUEBERRY_MAPPED);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('an undeclared sugar bills `sugar: null` and ships `sugar100: null`, present-and-null', async () => {
    resolveFoodDetails.mockResolvedValue(blueberryDetails(null, 0.01));

    const item = await parseOne('1 cup blueberries');
    expect(item.nutrition.sugar).toBeNull();
    expect(item.nutritionPer100g.sugar100).toBeNull();
    // JSON drops `undefined`, so the distinction is only real if it is `null`.
    expect(JSON.stringify(item.nutrition)).toContain('"sugar":null');
    expect(JSON.stringify(item.nutritionPer100g)).toContain('"sugar100":null');
    // The other fields are untouched, sodium included.
    expect(item.nutrition.calories).toBe(106.6);
    expect(item.nutrition.sodium).toBeCloseTo(0, 1);
    expect(item.nutrition.fiber).toBeCloseTo(3.6, 5);
  });

  test('an undeclared sodium bills `sodium: null` and ships `sodium100: null`', async () => {
    resolveFoodDetails.mockResolvedValue(blueberryDetails(7.2, null));

    const item = await parseOne('1 cup blueberries');
    expect(item.nutrition.sodium).toBeNull();
    expect(item.nutritionPer100g.sodium100).toBeNull();
    expect(JSON.stringify(item.nutrition)).toContain('"sodium":null');
    expect(JSON.stringify(item.nutritionPer100g)).toContain('"sodium100":null');
    // Sugar is declared on this row and must NOT be nulled: 7.2 x 1.48 = 10.656.
    expect(item.nutrition.sugar).toBe(10.7);
  });

  test('both undeclared: both null, and only those two', async () => {
    resolveFoodDetails.mockResolvedValue(blueberryDetails(null, null));

    const item = await parseOne('1 cup blueberries');
    expect(item.nutrition.sugar).toBeNull();
    expect(item.nutrition.sodium).toBeNull();
    expect(item.nutrition.calories).toBe(106.6);
    expect(item.nutrition.protein).toBeCloseTo(1.2, 5);
    expect(item.nutrition.carbs).toBeCloseTo(21.3, 5);
    expect(item.nutrition.fat).toBeCloseTo(2.4, 5);
  });

  test('DECLARED zeros bill 0 — the control the null rule must not destroy', async () => {
    resolveFoodDetails.mockResolvedValue(blueberryDetails(0, 0));

    const item = await parseOne('1 cup blueberries');
    expect(item.nutrition.sugar).toBe(0);
    expect(item.nutrition.sodium).toBe(0);
    expect(item.nutritionPer100g.sugar100).toBe(0);
    expect(item.nutritionPer100g.sodium100).toBe(0);
    // …and they are numbers on the wire, not nulls that happen to compare equal.
    expect(JSON.stringify(item.nutrition)).toContain('"sugar":0');
    expect(JSON.stringify(item.nutrition)).toContain('"sodium":0');
  });

  test('declared values scale by grams exactly as before — control', async () => {
    resolveFoodDetails.mockResolvedValue(blueberryDetails(7.2, 0.5));

    const item = await parseOne('1 cup blueberries');
    expect(item.nutrition.sugar).toBe(10.7);   // 7.2 x 1.48 = 10.656
    expect(item.nutrition.sodium).toBe(0.7);   // 0.5 x 1.48 = 0.74
    expect(item.nutritionPer100g.sugar100).toBe(7.2);
    expect(item.nutritionPer100g.sodium100).toBe(0.5);
  });

  test('the degenerate-panel repair re-derives the macros and does NOT resurrect a 0', async () => {
    resolveFoodDetails.mockResolvedValue({
      ...blueberryDetails(null, null),
      nutritionPer100g: { kcal100: 0, protein100: 0, carbs100: 0, fat100: 0, fiber100: null, sugar100: null, sodium100: null },
    });

    const item = await parseOne('1 cup blueberries');
    // The repair ran: kcal100 x grams == the billed kcal.
    expect(item.nutritionPer100g.kcal100 * 1.48).toBeCloseTo(106.6, 0);
    // And the two micros are still "no claim".
    expect(item.nutrition.sugar).toBeNull();
    expect(item.nutrition.sodium).toBeNull();
    expect(item.nutritionPer100g.sugar100).toBeNull();
    expect(item.nutritionPer100g.sodium100).toBeNull();
  });

  test('the UNRESOLVED shape (nothing mapped) declares nothing', async () => {
    mapIngredientWithFallback.mockResolvedValue(null);

    const item = await parseOne('xqzv');
    expect(item.foodId).toBeUndefined();
    expect(item.grams).toBe(0);
    expect(item.nutrition.sugar).toBeNull();
    expect(item.nutrition.sodium).toBeNull();
    expect(item.nutritionPer100g.sugar100).toBeNull();
    expect(item.nutritionPer100g.sodium100).toBeNull();
    // The macros keep their 0 — a 0 kcal card at grams 0 is the existing shape.
    expect(item.nutrition.calories).toBe(0);
    expect(item.nutritionPer100g.kcal100).toBe(0);
    expect(resolveFoodDetails).not.toHaveBeenCalled();
  });

  test('the ?stream=1 item frame carries the same nulls — the builder is shared', async () => {
    resolveFoodDetails.mockResolvedValue(blueberryDetails(null, null));

    const response = await POST(parseRequest('1 cup blueberries', '?stream=1'));
    expect(response.status).toBe(200);
    const { frames, rest } = decodeSseFrames(await response.text());
    expect(rest).toBe('');
    const itemFrames = frames.filter(f => f.type === 'item');
    expect(itemFrames).toHaveLength(1);
    const streamed = (itemFrames[0] as {
      item: { nutrition: { sugar: unknown; sodium: unknown }; nutritionPer100g: { sugar100: unknown; sodium100: unknown } };
    }).item;
    expect(streamed.nutrition.sugar).toBeNull();
    expect(streamed.nutrition.sodium).toBeNull();
    expect(streamed.nutritionPer100g.sugar100).toBeNull();
    expect(streamed.nutritionPer100g.sodium100).toBeNull();
    expect(frames[frames.length - 1].type).toBe('done');
  });
});
