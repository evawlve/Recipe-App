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

describe('depth tie-break by portions (s468)', () => {
  beforeEach(() => jest.clearAllMocks());

  const hitP = (fdcId: number, description: string, n: number) => ({
    ...hit(fdcId, description),
    servings: Array.from({ length: n }, () => ({ description: 'x', grams: 1 })),
  });
  const first = async (q: string) =>
    (await gatherCandidates(q, null, q, { skipOff: true, fdcDepth: 100 }))[0].id;

  const tomatoRows = () => [
    hitP(170502, 'Tomatoes, orange, raw', 2),
    hitP(170457, 'Tomatoes, red, ripe, raw, year round average', 13),
    hitP(170456, 'Tomatoes, green, raw', 5),
  ];
  const pepperRows = () => [
    hitP(169394, 'Pepper, banana, raw', 4),
    hitP(170497, 'Peppers, hot chili, green, raw', 2),
    hitP(170427, 'Peppers, sweet, green, raw', 8),
    hitP(170108, 'Peppers, sweet, red, raw', 7),
  ];
  const zucchiniRaw = () => hitP(169291, 'Squash, summer, zucchini, includes skin, raw', 6);
  const appleRows = () => [
    hitP(171689, 'Apples, raw, without skin', 4),
    hitP(171688, 'Apples, raw, with skin', 7),
  ];

  test('P1 tomato (Typesense servings as a JSON string)', async () => {
    searchTypesense.mockResolvedValue(tomatoRows().map(r => ({ ...r, servings: JSON.stringify(r.servings) })));
    expect(await first('tomato')).toBe('fdc_170457');
  });
  test('P2 tomatoes', async () => {
    searchTypesense.mockResolvedValue(tomatoRows());
    expect(await first('tomatoes')).toBe('fdc_170457');
  });
  test('P3 pepper', async () => {
    searchTypesense.mockResolvedValue(pepperRows());
    expect(await first('pepper')).toBe('fdc_170427');
  });
  test('P4 peppers', async () => {
    searchTypesense.mockResolvedValue(pepperRows().slice(1));
    expect(await first('peppers')).toBe('fdc_170427');
  });
  test('P5 zucchini', async () => {
    searchTypesense.mockResolvedValue([
      hitP(170534, 'Squash, summer, zucchini, includes skin, cooked, boiled, drained, with salt', 2),
      hitP(169292, 'Squash, summer, zucchini, includes skin, cooked, boiled, drained, without salt', 2),
      zucchiniRaw(),
    ]);
    expect(await first('zucchini')).toBe('fdc_169291');
  });
  test('P6 red pepper', async () => {
    searchTypesense.mockResolvedValue([
      hitP(170515, 'Peppers, sweet, red, cooked, boiled, drained, with salt', 3),
      hitP(170110, 'Peppers, sweet, red, cooked, boiled, drained, without salt', 3),
      hitP(170108, 'Peppers, sweet, red, raw', 7),
    ]);
    expect(await first('red pepper')).toBe('fdc_170108');
  });
  test('P7 lettuce', async () => {
    searchTypesense.mockResolvedValue([
      hitP(169249, 'Lettuce, green leaf, raw', 4),
      hitP(169248, 'Lettuce, iceberg (includes crisphead types), raw', 9),
    ]);
    expect(await first('lettuce')).toBe('fdc_169248');
  });
  test('P8 squash', async () => {
    searchTypesense.mockResolvedValue([
      hitP(170489, 'Squash, winter, all varieties, raw', 1),
      hitP(170487, 'Squash, summer, all varieties, raw', 5),
      zucchiniRaw(),
    ]);
    expect(await first('squash')).toBe('fdc_169291');
  });
  test('P9 apple', async () => {
    searchTypesense.mockResolvedValue(appleRows());
    expect(await first('apple')).toBe('fdc_171688');
  });
  test('P10 apples', async () => {
    searchTypesense.mockResolvedValue(appleRows());
    expect(await first('apples')).toBe('fdc_171688');
  });
  test('C1 priority still outranks portions', async () => {
    searchTypesense.mockResolvedValue([hitP(170461, 'Tomato powder', 40), hitP(170502, 'Tomatoes, orange, raw', 2)]);
    expect(await first('tomato')).toBe('fdc_170502');
  });
  test('C2 equal portions fall back to fetch order', async () => {
    searchTypesense.mockResolvedValue([
      hitP(170029, 'Potatoes, red, flesh and skin, raw', 4),
      hitP(170026, 'Potatoes, flesh and skin, raw', 4),
    ]);
    expect(await first('potato')).toBe('fdc_170029');
  });
  test('P11 Postgres branch (servings as arrays)', async () => {
    searchTypesense.mockRejectedValue(new Error('down'));
    require('../../db').prisma.fdcFood.findMany.mockResolvedValue(tomatoRows());
    expect(await first('tomato')).toBe('fdc_170457');
  });
});
