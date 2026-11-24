/**
 * /api/nlp/parse — the wire `foodName` of a USDA (fdc) winner (s465 A3b).
 *
 * WHAT IT ASSERTS: an fdc winner is named displayFdcName(details.name) ("Onions, raw"), the name
 * /api/foods/search serves, on the one-shot item AND the streamed `item` frame; a fatsecret / off
 * winner keeps mapped.foodName; cookingStateFor() still receives mapped.foodName, not the wire name.
 * The fixture gives mapped.foodName ('raw onions') and details.name ('Onions, raw') different values,
 * which route.cooking-state.test.ts's rec() (both equal) cannot tell apart.
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
jest.mock('@/lib/nlp/cooking-state', () => ({ cookingStateFor: jest.fn(() => null) }));
jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), audit: jest.fn() },
}));

const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
const { resolveFoodDetails } = require('@/lib/nlp/resolve-payload');
const { cookingStateFor } = require('@/lib/nlp/cooking-state');

function rec(foodId: string, mappedName: string, detailsName: string, source: string) {
  mapIngredientWithFallback.mockResolvedValue({
    foodId, foodName: mappedName, brandName: null, source: 'full_pipeline', confidence: 0.9,
    servingDescription: '100 g', grams: 100, kcal: 40, protein: 1, carbs: 9, fat: 0, servingTier: 'weight_unit',
  });
  resolveFoodDetails.mockResolvedValue({
    name: detailsName, brandName: null, source,
    nutritionPer100g: { kcal100: 40, protein100: 1, carbs100: 9, fat100: 0, fiber100: null, sugar100: null, sodium100: null },
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

describe('wire foodName for a USDA winner', () => {
  beforeAll(() => {
    process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass';
    process.env.MAPPING_EVENT_LOG_ENABLED = 'false';
  });
  beforeEach(() => { jest.clearAllMocks(); });

  test('fdc winner -> displayFdcName(details.name)', async () => {
    rec('fdc_170000', 'raw onions', 'Onions, raw', 'fdc');
    expect((await one('100g onions')).foodName).toBe('Onions, raw');
  });
  test('fdc ALL-CAPS part is title-cased like search', async () => {
    rec('fdc_170001', 'raw onions', 'Onions, RAW', 'fdc');
    expect((await one('100g onions')).foodName).toBe('Onions, Raw');
  });
  test('fatsecret winner keeps mapped.foodName', async () => {
    rec('fs_1', 'Onion', 'Onion (Raw)', 'fatsecret');
    expect((await one('100g onion')).foodName).toBe('Onion');
  });
  test('off winner keeps mapped.foodName', async () => {
    rec('off_1', 'Onion Rings', 'Onion Rings Deluxe', 'openfoodfacts');
    expect((await one('100g onion rings')).foodName).toBe('Onion Rings');
  });
  test('streamed item frame carries the same name as the one-shot item', async () => {
    rec('fdc_170000', 'raw onions', 'Onions, raw', 'fdc');
    const r = await POST(req('100g onions', '?stream=1'));
    const { frames } = decodeSseFrames(await r.text());
    const items = frames.filter((f: ParseStreamFrame) => f.type === 'item') as any[];
    expect(items).toHaveLength(1);
    expect(items[0].item.foodName).toBe('Onions, raw');
  });
  test('cookingStateFor still receives mapped.foodName, not the wire name', async () => {
    rec('fdc_170000', 'raw onions', 'Onions, raw', 'fdc');
    await one('100g onions');
    expect(cookingStateFor).toHaveBeenCalled();
    expect(cookingStateFor.mock.calls[0][0].foodName).toBe('raw onions');
  });
});
