/**
 * gatherCandidates({ fdcDepth }) — the search route's produce lane fetches the USDA
 * index deep, orders by priority (processed forms capped) and scores position in that
 * order. Without fdcDepth the fetch is unchanged (maxPerSource * 2 = 16).
 */

jest.mock('../../db', () => ({
  prisma: { fdcFood: { findMany: jest.fn().mockResolvedValue([]) } },
}));
jest.mock('../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../openfoodfacts/search', () => ({
  searchOffSimple: jest.fn().mockResolvedValue([]),
  searchOffSemantic: jest.fn().mockResolvedValue([]),
}));
jest.mock('../fatsecret-lane', () => ({
  searchFatSecretLane: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../search/query-embedding', () => ({
  SEMANTIC_SEARCH_ENABLED: false,
  warmupEmbedder: jest.fn(),
}));
jest.mock('../../search/typesense-client', () => ({
  searchTypesense: jest.fn(),
}));

import { gatherCandidates } from '../gather-candidates';

const { searchTypesense } = require('../../search/typesense-client');

const hit = (fdcId: number, description: string) => ({
  fdcId,
  description,
  dataType: 'SR Legacy',
  brandName: null,
  nutrientsPer100g: { calories: 40 },
  servings: [],
});

describe('gatherCandidates fdcDepth', () => {
  beforeEach(() => jest.clearAllMocks());

  test('absent: the primary FDC search asks Typesense for 16', async () => {
    searchTypesense.mockResolvedValue([hit(1, 'Onions, raw')]);
    await gatherCandidates('onion', null, 'onion', { skipOff: true });
    expect(searchTypesense).toHaveBeenCalledWith('fdc_foods', 'onion', 'description,brandName', 16);
  });

  test('onion at fetch index 36: depth 100 brings it first, scored as position 0', async () => {
    const soups = Array.from({ length: 36 }, (_, i) => hit(i + 1, 'Soup, onion, canned, condensed'));
    searchTypesense.mockResolvedValue([...soups, hit(170000, 'Onions, raw')]);
    const result = await gatherCandidates('onion', null, 'onion', { skipOff: true, fdcDepth: 100 });
    expect(searchTypesense).toHaveBeenCalledWith('fdc_foods', 'onion', 'description,brandName', 100);
    expect(result[0].id).toBe('fdc_170000');
    expect(result[0].score).toBe(1);
  });

  test('processed forms are capped unless the query names them', async () => {
    const rows = [hit(1, 'Tomato powder'), hit(2, 'Tomatoes, red, ripe, raw, year round average')];
    searchTypesense.mockResolvedValue(rows);
    const raw = await gatherCandidates('tomato', null, 'tomato', { skipOff: true, fdcDepth: 100 });
    expect(raw[0].id).toBe('fdc_2');
    searchTypesense.mockResolvedValue(rows);
    const powder = await gatherCandidates('tomato powder', null, 'tomato powder', { skipOff: true, fdcDepth: 100 });
    expect(powder[0].id).toBe('fdc_1');
  });
});

describe('gatherCandidates fdcDepth: raw first (s466 A5)', () => {
  beforeEach(() => jest.clearAllMocks());

  const ids = (rows: { id: string }[]) => rows.map(r => r.id);

  test('"Raspberries, raw" at fetch index 8 survives the slice over eight juice concentrates', async () => {
    // The scorer's private singularizer reads "raspberries" as "raspberri", so the raw row
    // scored 20 and was cut by the slice to 8; the shared singularizer reads "raspberry".
    const juices = Array.from({ length: 8 }, (_, i) => hit(i + 1, 'Raspberry juice concentrate'));
    searchTypesense.mockResolvedValue([...juices, hit(168217, 'Raspberries, raw')]);
    const result = await gatherCandidates('raspberry', null, 'raspberry', { skipOff: true, fdcDepth: 100 });
    expect(result).toHaveLength(8);
    expect(result[0].id).toBe('fdc_168217');
  });

  test('a cooked form the query did not name is capped', async () => {
    searchTypesense.mockResolvedValue([
      hit(1, 'Apples, raw, without skin, cooked, microwave'),
      hit(2, 'Apples, raw, without skin'),
    ]);
    const plain = await gatherCandidates('apples', null, 'apples', { skipOff: true, fdcDepth: 100 });
    expect(ids(plain)).toEqual(['fdc_2', 'fdc_1']);
  });

  test('a ", skin" part row is capped; "flesh and skin" is the whole food and is not', async () => {
    searchTypesense.mockResolvedValue([
      hit(1, 'Potatoes, raw, skin'), // 80, capped to 60
      hit(2, 'Potatoes, yellow, Idaho'), // 70
      hit(3, 'Potatoes, flesh and skin, raw'), // 80, not capped
    ]);
    const result = await gatherCandidates('potato', null, 'potato', { skipOff: true, fdcDepth: 100 });
    expect(ids(result)).toEqual(['fdc_3', 'fdc_2', 'fdc_1']);
  });

  test('without fdcDepth the order is unchanged: private singularizer, no cooking cap', async () => {
    searchTypesense.mockResolvedValue([
      hit(1, 'Raspberry juice concentrate'),
      hit(2, 'Raspberries, raw'),
    ]);
    const raspberry = await gatherCandidates('raspberry', null, 'raspberry', { skipOff: true });
    expect(ids(raspberry)).toEqual(['fdc_1', 'fdc_2']);

    searchTypesense.mockResolvedValue([
      hit(1, 'Apples, raw, without skin, cooked, microwave'),
      hit(2, 'Apples, raw, without skin'),
    ]);
    const apples = await gatherCandidates('apples', null, 'apples', { skipOff: true });
    expect(ids(apples)).toEqual(['fdc_1', 'fdc_2']);
  });
});
