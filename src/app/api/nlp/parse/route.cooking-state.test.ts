/**
 * /api/nlp/parse — the `cookingState` wire field (s456 CS).
 *
 * WHAT IT ASSERTS: a mapped meat/poultry/fish line carries `cookingState`
 * ('raw_default' | 'cooked' | 'raw') derived from the RESOLVED record's name
 * and source plus the line text, and NO such key at all when the record is
 * silent (fatsecret/fdc/ai) or out of scope (an apple). The streamed `item`
 * frame carries it too (one builder feeds both wires).
 *
 * s457 P1 adds three cases: the route passes the billed panel's kcal/100 g and the record's
 * brand, so a generic FatSecret cut with a cooked-level panel reads 'cooked', a branded one
 * reads nothing, and an OFF record whose panel no raw form of its cut reaches reads nothing.
 *
 * The last case pins that the route reads the RESOLVED record's source, not the
 * mapper's stage: a cache hit reports `source: 'early_cache'` but the record is
 * still the OFF row. The mapper is mocked, so it proves nothing about the cache
 * itself.
 *
 * Harness: same shape as route.portion-provenance.test.ts — supabase and prisma
 * mocked, `mapIngredientWithFallback` and `resolveFoodDetails` mocked per test.
 */
import { NextRequest } from 'next/server';
import { POST } from './route';
import { decodeSseFrames, type ParseStreamFrame } from '@/lib/nlp/parse-stream';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: jest.fn() } })),
}));
jest.mock('@/lib/db', () => ({
  prisma: {
    nlpRequestLog: { count: jest.fn(), create: jest.fn(), deleteMany: jest.fn(async () => ({ count: 0 })) },
    mappingEventLog: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  },
}));
jest.mock('@/lib/mapping/map-ingredient-with-fallback', () => ({ mapIngredientWithFallback: jest.fn() }));
jest.mock('@/lib/nlp/resolve-payload', () => ({
  ...jest.requireActual('@/lib/nlp/resolve-payload'),
  resolveFoodDetails: jest.fn(),
}));
jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), audit: jest.fn() },
}));

const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
const { resolveFoodDetails } = require('@/lib/nlp/resolve-payload');

function rec(foodId: string, foodName: string, source: string, kcal100 = 205, brandName: string | null = null) {
  mapIngredientWithFallback.mockResolvedValue({
    foodId, foodName, brandName, source: 'full_pipeline', confidence: 0.9,
    servingDescription: '100 g', grams: 230, kcal: kcal100 * 2.3, protein: 40, carbs: 0, fat: 30, servingTier: 'weight_unit',
  });
  resolveFoodDetails.mockResolvedValue({
    name: foodName, brandName, source,
    nutritionPer100g: { kcal100, protein100: 17.4, carbs100: 0, fat100: 13, fiber100: null, sugar100: null, sodium100: null },
    servingOptions: [{ label: '100 g', grams: 100, type: 'weight', isDefault: true }],
  });
}
function req(text: string, q = '') {
  return new NextRequest(`http://localhost:3000/api/nlp/parse${q}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
    body: JSON.stringify({ text }),
  });
}
async function one(text: string) { const r = await POST(req(text)); expect(r.status).toBe(200); return (await r.json())[0]; }

describe('cookingState trial', () => {
  beforeAll(() => {
    process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass';
    process.env.MAPPING_EVENT_LOG_ENABLED = 'false';
  });
  beforeEach(() => { jest.clearAllMocks(); });
  test('no-word beef OFF -> raw_default', async () => {
    rec('off_0211585214243', 'Beef Chuck', 'openfoodfacts');
    expect((await one('230g beef chuck')).cookingState).toBe('raw_default');
  });
  test('cooked beef chuck fs -> cooked', async () => {
    rec('fs_37555', 'Beef Chuck (Blade Roast, Trimmed to 1/8" Fat, Cooked, Braised)', 'fatsecret');
    expect((await one('230g cooked beef chuck')).cookingState).toBe('cooked');
  });
  test('raw chicken breast fdc -> raw', async () => {
    rec('fdc_171077', 'Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw', 'fdc');
    expect((await one('200g raw chicken breast')).cookingState).toBe('raw');
  });
  test('apple -> absent', async () => {
    rec('fdc_171688', 'Apples, raw, with skin', 'fdc');
    expect('cookingState' in (await one('an apple'))).toBe(false);
  });
  test('fs silent, panel under the raw ceiling -> absent', async () => {
    rec('fs_1641', 'Chicken Breast', 'fatsecret', 150);
    expect('cookingState' in (await one('100g chicken breast'))).toBe(false);
  });
  // s457 P1: the route hands cookingStateFor() the billed panel's kcal/100 g and the record's brand.
  test('fs generic, cooked-level panel -> cooked', async () => {
    rec('fs_1695', 'Chicken Thigh', 'fatsecret', 245);
    expect((await one('100g chicken thigh')).cookingState).toBe('cooked');
  });
  test('fs branded, same panel -> absent', async () => {
    rec('fs_32931817', 'Chicken Leg Quarter', 'fatsecret', 241, 'Perdue');
    expect('cookingState' in (await one('a chicken leg quarter'))).toBe(false);
  });
  test('off silent, panel no raw cut reaches -> absent', async () => {
    rec('off_0732153125377', 'Venison', 'openfoodfacts', 351, 'Epic');
    expect('cookingState' in (await one('venison'))).toBe(false);
  });
  test('fs generic, record row not there yet: kcal100 from the billed macros -> cooked', async () => {
    rec('fs_1741', 'Turkey', 'fatsecret', 186); // not in FatSecretFood: the merged block is the billed macros
    resolveFoodDetails.mockResolvedValue({
      name: 'Turkey', brandName: null, source: 'fatsecret',
      nutritionPer100g: { kcal100: 0, protein100: 0, carbs100: 0, fat100: 0, fiber100: null, sugar100: null, sodium100: null },
      servingOptions: [],
    });
    expect((await one('100g turkey')).cookingState).toBe('cooked');
  });
  test('stream item carries it', async () => {
    rec('off_0211585214243', 'Beef Chuck', 'openfoodfacts');
    const r = await POST(req('230g beef chuck', '?stream=1'));
    const { frames } = decodeSseFrames(await r.text());
    const items = frames.filter((f: ParseStreamFrame) => f.type === 'item') as any[];
    expect(items).toHaveLength(1);
    expect(items[0].item.cookingState).toBe('raw_default');
  });
  test('cache-hit stage still reads the resolved record source -> raw_default', async () => {
    rec('off_0211585214243', 'Beef Chuck', 'openfoodfacts');
    const base = await mapIngredientWithFallback('x');
    mapIngredientWithFallback.mockImplementation(async (_l: string, o: any) => {
      o.telemetry.cacheHit = 'early';
      return { ...base, source: 'early_cache' };
    });
    expect((await one('230g beef chuck')).cookingState).toBe('raw_default');
  });
});
