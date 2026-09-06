/**
 * /api/nlp/parse — an undeclared fibre is `null` on the wire, never a fabricated 0.
 *
 * WHAT IT ASSERTS. When the resolved record's `fiber100` is null (its panel does not
 * declare fibre), the item's billed `nutrition.fiber` is `null` and `nutritionPer100g
 * .fiber100` is `null` — the KEY is present, the value is null, so a client can tell
 * "no claim" from "0 g". A declared 0 bills 0; a declared number scales as before.
 * The unresolved shape (nothing mapped) is null too. The degenerate-panel repair
 * (`per100gFromBilledMacros`) re-derives only the four macros and must not resurrect
 * a 0. And the `?stream=1` item frame carries the same value, because the builder is
 * shared (`buildParsedItem()`), pinned here once so a route edit cannot fork them.
 *
 * WHY A ROUTE TEST. resolve-payload's own pins prove the resolver returns null; the
 * route then read `(fiber100 ?? 0) * scale` and folded it straight back to 0, so the
 * resolver could be perfect and the wire still wrong. This file is what goes red then.
 * RED on the pre-fix tree: the null assertions fail on master @ 5411f7e; the
 * declared-0 and declared-number rows are the controls and pass on both trees.
 *
 * Harness: route.portion-provenance.test.ts's — supabase and prisma mocked, the mapper
 * mocked per test, `resolveFoodDetails` mocked (the other resolve-payload helpers run
 * real). Single-item fast path, so no segmenter runs.
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

/**
 * off_0850003023175 "Blueberry" as the mapper bills it: 148 g (1 cup) of a 72 kcal/100 g
 * panel. The record is the measured row — its stored panel is `"fiber": null`.
 */
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

/** The resolver's output for that row, fibre as stored. */
function blueberryDetails(fiber100: number | null) {
  return {
    name: 'Blueberry',
    brandName: null,
    source: 'openfoodfacts',
    nutritionPer100g: {
      kcal100: 72, protein100: 0.8, carbs100: 14.4, fat100: 1.6,
      fiber100, sugar100: 7.2, sodium100: 0,
    },
    servingOptions: [{ label: '1 cup', grams: 148, type: 'volume', isDefault: true }],
  };
}

function parseRequest(text: string, query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/nlp/parse${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'adminAPI_dev_key_bypass', // dev bypass: skips Supabase auth + rate limiting
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

describe('/api/nlp/parse fibre: null is not 0', () => {
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

  test('an undeclared fibre bills `fiber: null` and ships `fiber100: null` — the key present, the value null', async () => {
    resolveFoodDetails.mockResolvedValue(blueberryDetails(null));

    const item = await parseOne('1 cup blueberries');
    expect(item.nutrition.fiber).toBeNull();
    expect(item.nutritionPer100g.fiber100).toBeNull();
    // Present-and-null, not absent: a client must be able to read "no claim" off the
    // key, and JSON drops `undefined`, so the distinction is only real if it is `null`.
    expect(JSON.stringify(item.nutrition)).toContain('"fiber":null');
    expect(JSON.stringify(item.nutritionPer100g)).toContain('"fiber100":null');
    // The rest of the bill is untouched.
    expect(item.nutrition.calories).toBe(106.6);
    expect(item.nutrition.sugar).toBeCloseTo(10.7, 5); // 7.2 x 1.48
  });

  test('a DECLARED 0 bills 0 — control', async () => {
    resolveFoodDetails.mockResolvedValue(blueberryDetails(0));

    const item = await parseOne('1 cup blueberries');
    expect(item.nutrition.fiber).toBe(0);
    expect(item.nutritionPer100g.fiber100).toBe(0);
  });

  test('a declared value scales by grams exactly as before — control', async () => {
    resolveFoodDetails.mockResolvedValue(blueberryDetails(2.4));

    const item = await parseOne('1 cup blueberries');
    // 2.4 g/100 g x 148 g = 3.552 -> toFixed(1) -> 3.6
    expect(item.nutrition.fiber).toBe(3.6);
    expect(item.nutritionPer100g.fiber100).toBe(2.4);
  });

  test('sugar and sodium keep their 0 fold — the change is fibre only', async () => {
    resolveFoodDetails.mockResolvedValue({
      ...blueberryDetails(null),
      nutritionPer100g: { kcal100: 72, protein100: 0.8, carbs100: 14.4, fat100: 1.6, fiber100: null, sugar100: 0, sodium100: 0 },
    });

    const item = await parseOne('1 cup blueberries');
    expect(item.nutrition.fiber).toBeNull();
    expect(item.nutrition.sugar).toBe(0);
    expect(item.nutrition.sodium).toBe(0);
  });

  test('the degenerate-panel repair re-derives the macros and does NOT resurrect a 0 fibre', async () => {
    // The first-sighting shape: the food row is not there yet, so the resolver
    // returns all-zero macros (and a null fibre, its initializer). The route
    // re-derives per-100g from the billed line — four macros, nothing else.
    resolveFoodDetails.mockResolvedValue({
      ...blueberryDetails(null),
      nutritionPer100g: { kcal100: 0, protein100: 0, carbs100: 0, fat100: 0, fiber100: null, sugar100: 0, sodium100: 0 },
    });

    const item = await parseOne('1 cup blueberries');
    // The repair ran: kcal100 x grams == the billed kcal.
    expect(item.nutritionPer100g.kcal100 * 1.48).toBeCloseTo(106.6, 0);
    // And fibre is still "no claim".
    expect(item.nutrition.fiber).toBeNull();
    expect(item.nutritionPer100g.fiber100).toBeNull();
  });

  test('the UNRESOLVED shape (nothing mapped) is null too — nothing declared anything', async () => {
    mapIngredientWithFallback.mockResolvedValue(null);

    const item = await parseOne('xqzv');
    expect(item.foodId).toBeUndefined();
    expect(item.grams).toBe(0);
    expect(item.nutrition.fiber).toBeNull();
    expect(item.nutritionPer100g.fiber100).toBeNull();
    // The macros keep their 0 — a 0 kcal card at grams 0 is the existing shape.
    expect(item.nutrition.calories).toBe(0);
    expect(item.nutritionPer100g.kcal100).toBe(0);
    expect(resolveFoodDetails).not.toHaveBeenCalled();
  });

  test('the ?stream=1 item frame carries the same null — the builder is shared', async () => {
    resolveFoodDetails.mockResolvedValue(blueberryDetails(null));

    const response = await POST(parseRequest('1 cup blueberries', '?stream=1'));
    expect(response.status).toBe(200);
    const { frames, rest } = decodeSseFrames(await response.text());
    expect(rest).toBe('');
    const itemFrames = frames.filter(f => f.type === 'item');
    expect(itemFrames).toHaveLength(1);
    const streamed = (itemFrames[0] as { item: { nutrition: { fiber: unknown }; nutritionPer100g: { fiber100: unknown } } }).item;
    expect(streamed.nutrition.fiber).toBeNull();
    expect(streamed.nutritionPer100g.fiber100).toBeNull();
    expect(frames[frames.length - 1].type).toBe('done');
  });
});
