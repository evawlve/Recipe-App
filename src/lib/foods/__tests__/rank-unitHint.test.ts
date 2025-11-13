import { rankCandidates, Candidate } from '../rank';

describe('rankCandidates with unitHint', () => {
  const createEggCandidate = (name: string, id: string) => ({
    food: {
      id,
      name,
      brand: null,
      source: 'usda' as const,
      verification: 'verified' as const,
      kcal100: 143,
      protein100: 13,
      carbs100: 1,
      fat100: 10,
      densityGml: null,
      categoryId: null,
      popularity: 10
    },
    aliases: [],
    barcodes: [],
    usedByUserCount: 0
  });

  test('unitHint "yolk" ranks yolk first', () => {
    const candidates: Candidate[] = [
      createEggCandidate('Egg, whole, raw', 'whole'),
      createEggCandidate('Egg, yolk, raw', 'yolk'),
      createEggCandidate('Egg, white, raw', 'white'),
    ];

    const ranked = rankCandidates(candidates, {
      query: 'egg',
      unitHint: 'yolk'
    });

    expect(ranked[0].candidate.food.name).toContain('yolk');
    expect(ranked[0].candidate.food.id).toBe('yolk');
  });

  test('unitHint "white" ranks white first', () => {
    const candidates: Candidate[] = [
      createEggCandidate('Egg, whole, raw', 'whole'),
      createEggCandidate('Egg, yolk, raw', 'yolk'),
      createEggCandidate('Egg, white, raw', 'white'),
    ];

    const ranked = rankCandidates(candidates, {
      query: 'egg',
      unitHint: 'white'
    });

    expect(ranked[0].candidate.food.name).toContain('white');
    expect(ranked[0].candidate.food.id).toBe('white');
  });

  test('no unitHint ranks whole egg first (when query is generic)', () => {
    const candidates: Candidate[] = [
      createEggCandidate('Egg, whole, raw', 'whole'),
      createEggCandidate('Egg, yolk, raw', 'yolk'),
      createEggCandidate('Egg, white, raw', 'white'),
    ];

    const ranked = rankCandidates(candidates, {
      query: 'egg',
      unitHint: null
    });

    // Whole should rank higher than parts when no hint
    const wholeRank = ranked.findIndex(r => r.candidate.food.id === 'whole');
    const yolkRank = ranked.findIndex(r => r.candidate.food.id === 'yolk');
    const whiteRank = ranked.findIndex(r => r.candidate.food.id === 'white');

    expect(wholeRank).toBeLessThan(yolkRank);
    expect(wholeRank).toBeLessThan(whiteRank);
  });

  test('unitHint "leaf" boosts raw lettuce', () => {
    const candidates: Candidate[] = [
      {
        food: {
          id: 'salad',
          name: 'Lettuce salad with dressing',
          brand: null,
          source: 'usda' as const,
          verification: 'verified' as const,
          kcal100: 150,
          protein100: 2,
          carbs100: 10,
          fat100: 12,
          densityGml: null,
          categoryId: 'prepared_dish',
          popularity: 5
        },
        aliases: [],
        barcodes: [],
        usedByUserCount: 0
      },
      {
        food: {
          id: 'raw',
          name: 'Lettuce, cos or romaine, raw',
          brand: null,
          source: 'usda' as const,
          verification: 'verified' as const,
          kcal100: 17,
          protein100: 1,
          carbs100: 3,
          fat100: 0,
          densityGml: null,
          categoryId: 'veg',
          popularity: 10
        },
        aliases: [],
        barcodes: [],
        usedByUserCount: 0
      }
    ];

    const ranked = rankCandidates(candidates, {
      query: 'romaine',
      unitHint: 'leaf'
    });

    expect(ranked[0].candidate.food.name).toContain('raw');
    expect(ranked[0].candidate.food.id).toBe('raw');
  });

  test('unitHint "clove" boosts raw garlic', () => {
    const candidates: Candidate[] = [
      {
        food: {
          id: 'powder',
          name: 'Garlic powder',
          brand: null,
          source: 'usda' as const,
          verification: 'verified' as const,
          kcal100: 331,
          protein100: 16,
          carbs100: 73,
          fat100: 0,
          densityGml: null,
          categoryId: 'veg',
          popularity: 5
        },
        aliases: [],
        barcodes: [],
        usedByUserCount: 0
      },
      {
        food: {
          id: 'raw',
          name: 'Garlic, raw',
          brand: null,
          source: 'usda' as const,
          verification: 'verified' as const,
          kcal100: 149,
          protein100: 6,
          carbs100: 33,
          fat100: 0,
          densityGml: null,
          categoryId: 'veg',
          popularity: 10
        },
        aliases: [],
        barcodes: [],
        usedByUserCount: 0
      }
    ];

    const ranked = rankCandidates(candidates, {
      query: 'garlic',
      unitHint: 'clove'
    });

    expect(ranked[0].candidate.food.name).toContain('raw');
    expect(ranked[0].candidate.food.id).toBe('raw');
  });
});

describe('rankCandidates with qualifiers', () => {
  const createEggCandidate = (name: string, id: string) => ({
    food: {
      id,
      name,
      brand: null,
      source: 'usda' as const,
      verification: 'verified' as const,
      kcal100: 143,
      protein100: 13,
      carbs100: 1,
      fat100: 10,
      densityGml: null,
      categoryId: null,
      popularity: 10
    },
    aliases: [],
    barcodes: [],
    usedByUserCount: 0
  });

  test('qualifier "large" boosts large egg', () => {
    const candidates: Candidate[] = [
      createEggCandidate('Egg, medium, raw', 'medium'),
      createEggCandidate('Egg, large, raw', 'large'),
      createEggCandidate('Egg, small, raw', 'small'),
    ];

    const ranked = rankCandidates(candidates, {
      query: 'egg',
      qualifiers: ['large']
    });

    expect(ranked[0].candidate.food.name).toContain('large');
    expect(ranked[0].candidate.food.id).toBe('large');
  });

  test('qualifier "diced" prefers raw foods', () => {
    const candidates: Candidate[] = [
      {
        food: {
          id: 'cooked',
          name: 'Onion, cooked, boiled',
          brand: null,
          source: 'usda' as const,
          verification: 'verified' as const,
          kcal100: 44,
          protein100: 1,
          carbs100: 10,
          fat100: 0,
          densityGml: null,
          categoryId: 'veg',
          popularity: 5
        },
        aliases: [],
        barcodes: [],
        usedByUserCount: 0
      },
      {
        food: {
          id: 'raw',
          name: 'Onions, raw',
          brand: null,
          source: 'usda' as const,
          verification: 'verified' as const,
          kcal100: 40,
          protein100: 1,
          carbs100: 9,
          fat100: 0,
          densityGml: null,
          categoryId: 'veg',
          popularity: 10
        },
        aliases: [],
        barcodes: [],
        usedByUserCount: 0
      }
    ];

    const ranked = rankCandidates(candidates, {
      query: 'onion',
      qualifiers: ['diced']
    });

    // Raw should rank higher when qualifier suggests preparation
    expect(ranked[0].candidate.food.name).toContain('raw');
    expect(ranked[0].candidate.food.id).toBe('raw');
  });

  test('multiple qualifiers boost matching food', () => {
    const candidates: Candidate[] = [
      createEggCandidate('Egg, medium, raw', 'medium'),
      createEggCandidate('Egg, large, raw', 'large'),
    ];

    const ranked = rankCandidates(candidates, {
      query: 'egg',
      qualifiers: ['large', 'fresh']
    });

    expect(ranked[0].candidate.food.name).toContain('large');
    expect(ranked[0].candidate.food.id).toBe('large');
  });
});

describe('rankCandidates with unitHint and qualifiers combined', () => {
  test('unitHint "yolk" + qualifier "large" ranks large yolk first', () => {
    const candidates: Candidate[] = [
      {
        food: {
          id: 'whole',
          name: 'Egg, whole, large, raw',
          brand: null,
          source: 'usda' as const,
          verification: 'verified' as const,
          kcal100: 143,
          protein100: 13,
          carbs100: 1,
          fat100: 10,
          densityGml: null,
          categoryId: null,
          popularity: 10
        },
        aliases: [],
        barcodes: [],
        usedByUserCount: 0
      },
      {
        food: {
          id: 'yolk',
          name: 'Egg, yolk, large, raw',
          brand: null,
          source: 'usda' as const,
          verification: 'verified' as const,
          kcal100: 322,
          protein100: 16,
          carbs100: 4,
          fat100: 27,
          densityGml: null,
          categoryId: null,
          popularity: 8
        },
        aliases: [],
        barcodes: [],
        usedByUserCount: 0
      }
    ];

    const ranked = rankCandidates(candidates, {
      query: 'egg',
      unitHint: 'yolk',
      qualifiers: ['large']
    });

    expect(ranked[0].candidate.food.name).toContain('yolk');
    expect(ranked[0].candidate.food.name).toContain('large');
    expect(ranked[0].candidate.food.id).toBe('yolk');
  });
});

