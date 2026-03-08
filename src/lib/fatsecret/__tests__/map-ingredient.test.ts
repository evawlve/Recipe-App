import { mapIngredientWithFatsecret } from '../map-ingredient';
import type { FatSecretNlpParseResponse, FatSecretSearchResponse, FatSecretFoodDetails, FatSecretFoodSummary } from '../client';
import * as cacheSearch from '../cache-search';

// Mock cache search functions to return empty results (tests use mocked API client instead)
// This allows the code to use the cache path but fall back to API (which is mocked)
jest.spyOn(cacheSearch, 'searchFatSecretCacheFoods').mockResolvedValue([]);
jest.spyOn(cacheSearch, 'getCachedFoodWithRelations').mockResolvedValue(null);

// Increase default timeout to cover slower rerank/cache hydration in these tests
jest.setTimeout(15000);

type ClientResponse = {
  nlp?: Record<string, FatSecretNlpParseResponse | null>;
  search?: Record<string, FatSecretSearchResponse>;
  searchV4?: Record<string, FatSecretFoodSummary[]>;
  foods?: Record<string, FatSecretFoodDetails | null>;
};

class FakeFatSecretClient {
  public searchFoodsCalls: string[] = []; // Track all search queries for debugging

  constructor(private readonly responses: ClientResponse) {}

  async nlpParse(text: string) {
    return this.responses.nlp?.[text] ?? null;
  }

  async searchFoods(query: string) {
    const result = this.responses.search?.[query];
    return (
      result ?? {
        foods: [],
        totalResults: 0,
        maxResults: 0,
        pageNumber: 0,
      }
    );
  }

  async searchFoodsV4(query: string) {
    // Track all search queries for debugging
    this.searchFoodsCalls.push(query);
    
    // First try exact match (case-sensitive)
    if (this.responses.searchV4?.[query]) {
      return this.responses.searchV4[query];
    }
    // Try lowercase match (since normalizeQuery lowercases)
    const queryLower = query.toLowerCase();
    if (this.responses.searchV4?.[queryLower]) {
      return this.responses.searchV4[queryLower];
    }
    
    // Fallback: try to find a match that contains the query or vice versa
    // This helps when buildSearchExpressions generates variants we didn't explicitly mock
    for (const [key, foods] of Object.entries(this.responses.searchV4 || {})) {
      if (query.includes(key) || key.includes(query)) {
        return foods;
      }
      // Also try lowercase comparison
      const keyLower = key.toLowerCase();
      if (queryLower.includes(keyLower) || keyLower.includes(queryLower)) {
        return foods;
      }
    }
    
    // Final fallback: find the key that shares the most tokens with the query
    // This handles cases like "eggs large" matching "eggs", or "large eggs" matching "eggs"
    const queryWords = new Set(queryLower.split(/\s+/).filter(w => w.length > 1));
    let bestMatch: { key: string; foods: FatSecretFoodSummary[]; score: number } | null = null;
    
    for (const [key, foods] of Object.entries(this.responses.searchV4 || {})) {
      const keyWords = new Set(key.toLowerCase().split(/\s+/).filter(w => w.length > 1));
      // Count shared tokens
      let sharedCount = 0;
      for (const qw of queryWords) {
        if (keyWords.has(qw)) {
          sharedCount++;
        }
      }
      // Prefer matches with more shared tokens
      if (sharedCount > 0 && (!bestMatch || sharedCount > bestMatch.score)) {
        bestMatch = { key, foods, score: sharedCount };
      }
    }
    
    return bestMatch?.foods ?? [];
  }

  async getFood(foodId: string) {
    return this.responses.foods?.[foodId] ?? null;
  }

  async getFoodDetails(foodId: string) {
    return this.responses.foods?.[foodId] ?? null;
  }

  async autocompleteFoods(query: string, maxResults: number = 10) {
    // Return empty array for autocomplete (not needed for most tests)
    return [];
  }

  async autocompleteFoods(query: string, maxResults: number = 10) {
    // Return empty array for autocomplete (not needed for most tests)
    return [];
  }
}

function createServing(overrides: Partial<NonNullable<FatSecretFoodDetails['servings']>[number]>) {
  return {
    id: 'serving',
    description: '1 unit',
    metricServingAmount: 100,
    metricServingUnit: 'g',
    numberOfUnits: 1,
    calories: 50,
    protein: 5,
    carbohydrate: 1,
    fat: 2,
    ...overrides,
  };
}

describe('mapIngredientWithFatsecret', () => {
  it('maps simple egg line using search', async () => {
    const servings = [
      createServing({
        id: 'srv-egg',
        description: '1 large',
        servingWeightGrams: 50,
        numberOfUnits: 1,
        calories: 72,
        protein: 6.3,
        carbohydrate: 0.4,
        fat: 4.8,
      }),
    ];

    const eggFood = { id: 'egg-whole', name: 'Egg, whole, raw', brandName: null, foodType: 'Generic' };
    // Mock all possible expressions that buildSearchExpressions might generate for "3 large eggs"
    // The parser extracts name="eggs", qualifiers=["large"]
    // buildSearchExpressions generates variants like: "eggs", "eggs large", "large eggs", "egg", etc.
    // We explicitly mock the most common ones to ensure the test passes
    const client = new FakeFatSecretClient({
      searchV4: {
        'eggs': [eggFood], // Primary: base name (normalized)
        'eggs large': [eggFood], // Base + qualifier (if large is treated as important)
        'large eggs': [eggFood], // Alternative order
        'egg': [eggFood], // Stripped/singular version
      },
      foods: {
        'egg-whole': {
          id: 'egg-whole',
          name: 'Egg, whole, raw',
          brandName: null,
          servings,
        } as FatSecretFoodDetails,
      },
    });

    const result = await mapIngredientWithFatsecret('3 large eggs', { client: client as any, minConfidence: 0 });
    
    expect(result).not.toBeNull();
    expect(result?.foodName).toContain('Egg');
    expect(result?.grams).toBeCloseTo(150, 1);
    expect(result?.kcal).toBeCloseTo(216, 1);
    expect(result?.protein).toBeCloseTo(18.9, 1);
    expect(result?.confidence).toBeGreaterThan(0);
  });

  it('prefers yolk entries when unit hint targets yolk', async () => {
    const servings = [
      createServing({ id: 'srv', description: '1 yolk', servingWeightGrams: 17, calories: 55, protein: 2.7, carbohydrate: 0.6, fat: 4.5 }),
    ];

    const client = new FakeFatSecretClient({
      searchV4: {
        'egg yolk': [
          { id: 'egg-yolk', name: 'Egg, yolk, raw', brandName: null, foodType: 'Generic' },
          { id: 'egg-whole', name: 'Egg, whole', brandName: null, foodType: 'Generic' },
        ],
        'egg': [
          { id: 'egg-yolk', name: 'Egg, yolk, raw', brandName: null, foodType: 'Generic' },
          { id: 'egg-whole', name: 'Egg, whole', brandName: null, foodType: 'Generic' },
        ],
      },
      foods: {
        'egg-whole': { id: 'egg-whole', name: 'Egg, whole', brandName: null, servings } as FatSecretFoodDetails,
        'egg-yolk': { id: 'egg-yolk', name: 'Egg, yolk, raw', brandName: null, servings } as FatSecretFoodDetails,
      },
    });

    const result = await mapIngredientWithFatsecret('2 egg yolks', { client: client as any });
    expect(result).not.toBeNull();
    expect(result?.foodName.toLowerCase()).toContain('yolk');
    expect(result?.grams).toBeCloseTo(34, 1);
  });

  it('chooses cooked grain entries for cooked queries', async () => {
    const cookedServing = [
      createServing({
        id: 'srv-cooked',
        description: '1 cup',
        servingWeightGrams: 195,
        calories: 215,
        protein: 5,
        carbohydrate: 45,
        fat: 1.8,
      }),
    ];
    const rawServing = [
      createServing({
        id: 'srv-raw',
        description: '100 g',
        servingWeightGrams: 100,
        numberOfUnits: 100, // FatSecret encodes "100 g" as 100 units of 1g each
        // This makes gramsPerUnit = 100/100 = 1g, so grams = 1 * qty gives the expected result
        calories: 365,
        protein: 7.5,
        carbohydrate: 76,
        fat: 2.7,
      }),
    ];
    const riceCooked = { id: 'rice-cooked', name: 'Brown rice, cooked', brandName: null, foodType: 'Generic' };
    const riceRaw = { id: 'rice-raw', name: 'Brown rice, raw', brandName: null, foodType: 'Generic' };
    
    const client = new FakeFatSecretClient({
      searchV4: {
        'brown rice cooked': [riceCooked, riceRaw], // Base + qualifier
        'brown rice': [riceCooked, riceRaw], // Base without qualifier
        'rice': [riceCooked, riceRaw], // Ultra-generic fallback (last word after filtering "cooked")
      },
      foods: {
        'rice-raw': { id: 'rice-raw', name: 'Brown rice, raw', brandName: null, servings: rawServing } as FatSecretFoodDetails,
        'rice-cooked': { id: 'rice-cooked', name: 'Brown rice, cooked', brandName: null, servings: cookedServing } as FatSecretFoodDetails,
      },
    });

    const result = await mapIngredientWithFatsecret('1 cup brown rice, cooked', { client: client as any });
    expect(result).not.toBeNull();
    expect(result?.foodName.toLowerCase()).toContain('cooked');
    expect(result?.grams).toBeCloseTo(195, 1);
  });

  it('handles diced onion with qualifiers', async () => {
    const servings = [
      createServing({
        id: 'srv',
        description: '1 cup chopped',
        servingWeightGrams: 160,
        calories: 64,
        protein: 1.8,
        carbohydrate: 15,
        fat: 0.2,
      }),
    ];

    const onionFood = { id: 'onion', name: 'Onion, raw', brandName: null, foodType: 'Generic' };
    
    const client = new FakeFatSecretClient({
      searchV4: {
        'onion diced': [onionFood], // Base + qualifier
        'onion': [onionFood], // Base without qualifier, stripped, and ultra-generic fallback
      },
      foods: {
        'onion': { id: 'onion', name: 'Onion, raw', brandName: null, servings } as FatSecretFoodDetails,
      },
    });

    const result = await mapIngredientWithFatsecret('1 cup onion, diced', { client: client as any });
    expect(result).not.toBeNull();
    expect(result?.foodName.toLowerCase()).toContain('onion');
    expect(result?.grams).toBeCloseTo(160, 1);
  });

  it('selects cup serving for cup queries', async () => {
    const cupServing = [
      createServing({
        id: 'srv-cup',
        description: '1 cup',
        servingWeightGrams: 240,
        calories: 122,
        protein: 8,
        carbohydrate: 12,
        fat: 5,
      }),
      createServing({
        id: 'srv-100g',
        description: '100 g',
        servingWeightGrams: 100,
        numberOfUnits: 100, // FatSecret encodes "100 g" as 100 units of 1g each
        // This makes gramsPerUnit = 100/100 = 1g, so grams = 1 * qty gives the expected result
        calories: 51,
        protein: 3.3,
        carbohydrate: 5,
        fat: 2.1,
      }),
    ];

    const client = new FakeFatSecretClient({
      searchV4: {
        'milk': [
          { id: 'milk', name: 'Milk, whole', brandName: null, foodType: 'Generic' },
        ],
      },
      foods: {
        'milk': { id: 'milk', name: 'Milk, whole', brandName: null, servings: cupServing } as FatSecretFoodDetails,
      },
    });

    const result = await mapIngredientWithFatsecret('1 cup milk', { client: client as any });
    expect(result).not.toBeNull();
    expect(result?.servingDescription?.toLowerCase()).toContain('cup');
    expect(result?.grams).toBeCloseTo(240, 1);
  });

  it('handles unsweetened almond milk', async () => {
    const servings = [
      createServing({
        id: 'srv',
        description: '1 cup',
        servingWeightGrams: 240,
        calories: 30,
        protein: 1,
        carbohydrate: 1,
        fat: 2.5,
      }),
    ];

    const client = new FakeFatSecretClient({
      searchV4: {
        'almond milk unsweetened': [
          { id: 'almond-milk', name: 'Almond Milk, Unsweetened', brandName: null, foodType: 'Generic' },
        ],
        'almond milk': [
          { id: 'almond-milk', name: 'Almond Milk, Unsweetened', brandName: null, foodType: 'Generic' },
        ],
        'milk unsweetened': [
          { id: 'almond-milk', name: 'Almond Milk, Unsweetened', brandName: null, foodType: 'Generic' },
        ],
        'almond': [
          { id: 'almond-milk', name: 'Almond Milk, Unsweetened', brandName: null, foodType: 'Generic' },
        ],
      },
      foods: {
        'almond-milk': { id: 'almond-milk', name: 'Almond Milk, Unsweetened', brandName: null, servings } as FatSecretFoodDetails,
      },
    });

    const result = await mapIngredientWithFatsecret('1 cup unsweetened almond milk', { client: client as any, minConfidence: 0.4 });
    expect(result).not.toBeNull();
    expect(result?.foodName.toLowerCase()).toContain('almond');
    expect(result?.grams).toBeCloseTo(240, 1);
  });

  it('prefers raw entries for raw queries', async () => {
    // NOTE: For "100 g" servings, numberOfUnits MUST be 100 (not 1)!
    // 
    // FatSecret's API encodes "100 g" servings as 100 units of 1g each (numberOfUnits: 100).
    // The serving selection logic calculates: gramsPerUnit = gramsPerServing / numberOfUnits
    // 
    // With numberOfUnits: 100 (correct):
    //   gramsPerUnit = 100 / 100 = 1g per unit
    //   For input "100g raw chicken" (qty=100), grams = 1 * 100 = 100g (correct!)
    //   This matches how FatSecret actually encodes their "100 g" servings in the API.
    //
    // This ensures our mocks mirror the real FatSecret payload structure.
    const rawServing = [
      createServing({
        id: 'srv-raw',
        description: '100 g',
        servingWeightGrams: 100,
        numberOfUnits: 100, // FatSecret encodes "100 g" as 100 units of 1g each
        // This makes gramsPerUnit = 100/100 = 1g, so grams = 1 * qty gives the expected result
        calories: 265,
        protein: 24,
        carbohydrate: 0,
        fat: 18,
      }),
    ];
    const cookedServing = [
      createServing({
        id: 'srv-cooked',
        description: '100 g',
        servingWeightGrams: 100,
        numberOfUnits: 100, // FatSecret encodes "100 g" as 100 units of 1g each
        // Same explanation as above - numberOfUnits must be 100 to match FatSecret's API
        calories: 239,
        protein: 27,
        carbohydrate: 0,
        fat: 14,
      }),
    ];

    const chickenRaw = { id: 'chicken-raw', name: 'Chicken breast, raw', brandName: null, foodType: 'Generic' };
    const chickenCooked = { id: 'chicken-cooked', name: 'Chicken breast, cooked', brandName: null, foodType: 'Generic' };
    
    const client = new FakeFatSecretClient({
      searchV4: {
        'chicken raw': [chickenRaw, chickenCooked], // Base + qualifier
        'chicken': [chickenRaw, chickenCooked], // Base without qualifier
        'breast': [chickenRaw, chickenCooked], // Ultra-generic fallback (last word)
      },
      foods: {
        'chicken-raw': { id: 'chicken-raw', name: 'Chicken breast, raw', brandName: null, servings: rawServing } as FatSecretFoodDetails,
        'chicken-cooked': { id: 'chicken-cooked', name: 'Chicken breast, cooked', brandName: null, servings: cookedServing } as FatSecretFoodDetails,
      },
    });

    const result = await mapIngredientWithFatsecret('100g raw chicken breast', { client: client as any });
    expect(result).not.toBeNull();
    expect(result?.foodName.toLowerCase()).toContain('raw');
    expect(result?.grams).toBeCloseTo(100, 1);
  });

  it('handles chopped onion with qualifiers', async () => {
    const servings = [
      createServing({
        id: 'srv',
        description: '1 cup chopped',
        servingWeightGrams: 160,
        calories: 64,
        protein: 1.8,
        carbohydrate: 15,
        fat: 0.2,
      }),
    ];

    const client = new FakeFatSecretClient({
      searchV4: {
        'onion chopped': [
          { id: 'onion', name: 'Onion, raw', brandName: null, foodType: 'Generic' },
        ],
        'onion': [
          { id: 'onion', name: 'Onion, raw', brandName: null, foodType: 'Generic' },
        ],
      },
      foods: {
        'onion': { id: 'onion', name: 'Onion, raw', brandName: null, servings } as FatSecretFoodDetails,
      },
    });

    const result = await mapIngredientWithFatsecret('1 cup chopped onion', { client: client as any });
    expect(result).not.toBeNull();
    expect(result?.foodName.toLowerCase()).toContain('onion');
    expect(result?.servingDescription?.toLowerCase()).toContain('chopped');
    expect(result?.grams).toBeCloseTo(160, 1);
  });

  it('selects tablespoon serving for tablespoon queries', async () => {
    const tbspServing = [
      createServing({
        id: 'srv-tbsp',
        description: '1 tablespoon',
        servingWeightGrams: 15,
        calories: 50,
        protein: 0,
        carbohydrate: 5,
        fat: 4.5,
      }),
      createServing({
        id: 'srv-100g',
        description: '100 g',
        servingWeightGrams: 100,
        numberOfUnits: 100, // FatSecret encodes "100 g" as 100 units of 1g each
        // This makes gramsPerUnit = 100/100 = 1g, so grams = 1 * qty gives the expected result
        calories: 333,
        protein: 0,
        carbohydrate: 33,
        fat: 30,
      }),
    ];

    const client = new FakeFatSecretClient({
      searchV4: {
        'oil': [
          { id: 'oil', name: 'Vegetable Oil', brandName: null, foodType: 'Generic' },
        ],
      },
      foods: {
        'oil': { id: 'oil', name: 'Vegetable Oil', brandName: null, servings: tbspServing } as FatSecretFoodDetails,
      },
    });

    const result = await mapIngredientWithFatsecret('2 tbsp oil', { client: client as any });
    expect(result).not.toBeNull();
    expect(result?.servingDescription?.toLowerCase()).toContain('tablespoon');
    expect(result?.grams).toBeCloseTo(30, 1);
  });

  it('handles whole milk with qualifier', async () => {
    const servings = [
      createServing({
        id: 'srv',
        description: '1 cup',
        servingWeightGrams: 244,
        calories: 149,
        protein: 8,
        carbohydrate: 12,
        fat: 8,
      }),
    ];

    const client = new FakeFatSecretClient({
      searchV4: {
        'milk whole': [
          { id: 'milk-whole', name: 'Milk, whole', brandName: null, foodType: 'Generic' },
          { id: 'milk-skim', name: 'Milk, skim', brandName: null, foodType: 'Generic' },
        ],
        'milk': [
          { id: 'milk-whole', name: 'Milk, whole', brandName: null, foodType: 'Generic' },
          { id: 'milk-skim', name: 'Milk, skim', brandName: null, foodType: 'Generic' },
        ],
      },
      foods: {
        'milk-whole': { id: 'milk-whole', name: 'Milk, whole', brandName: null, servings } as FatSecretFoodDetails,
        'milk-skim': { id: 'milk-skim', name: 'Milk, skim', brandName: null, servings } as FatSecretFoodDetails,
      },
    });

    const result = await mapIngredientWithFatsecret('1 cup whole milk', { client: client as any });
    expect(result).not.toBeNull();
    expect(result?.foodName.toLowerCase()).toContain('whole');
    expect(result?.grams).toBeCloseTo(244, 1);
  });

  it('applies herb tsp/tbsp defaults to avoid 100g fallback', async () => {
    const herbServing = [
      createServing({
        id: 'srv-100',
        description: '100 g',
        servingWeightGrams: 100,
        calories: 23,
        protein: 3,
        carbohydrate: 4,
        fat: 0.6,
      }),
    ];
    const basil = { id: 'basil', name: 'Basil, fresh', brandName: null, foodType: 'Generic' };

    const client = new FakeFatSecretClient({
      searchV4: {
        basil: [basil],
      },
      foods: {
        basil: { id: 'basil', name: 'Basil, fresh', brandName: null, servings: herbServing } as FatSecretFoodDetails,
      },
    });

    const tspResult = await mapIngredientWithFatsecret('1 tsp basil', { client: client as any });
    expect(tspResult?.grams).toBeCloseTo(0.7, 1); // tsp heuristic

    const tbspResult = await mapIngredientWithFatsecret('1 tbsp basil', { client: client as any });
    expect(tbspResult?.grams).toBeCloseTo(2, 1); // tbsp heuristic
  });

  it('uses dash default for spices', async () => {
    const pepperServing = [
      createServing({
        id: 'srv-100',
        description: '100 g',
        servingWeightGrams: 100,
        calories: 251,
        protein: 10,
        carbohydrate: 64,
        fat: 3.3,
      }),
    ];
    const pepper = { id: 'pepper', name: 'Black pepper, ground', brandName: null, foodType: 'Generic' };
    const client = new FakeFatSecretClient({
      searchV4: { pepper: [pepper], 'black pepper': [pepper] },
      foods: {
        pepper: { id: 'pepper', name: 'Black pepper, ground', brandName: null, servings: pepperServing } as FatSecretFoodDetails,
      },
    });

    const result = await mapIngredientWithFatsecret('dash black pepper', { client: client as any });
    expect(result?.grams).toBeCloseTo(0.6, 1);
    expect(result?.foodName.toLowerCase()).toContain('pepper');
  });

  it('strips inch/prep noise from queries (chicken breast)', async () => {
    const chicken = { id: 'chicken-breast', name: 'Chicken breast, raw, skinless', brandName: null, foodType: 'Generic' };
    const servings = [
      createServing({
        id: 'srv-100',
        description: '100 g',
        servingWeightGrams: 100,
        calories: 165,
        protein: 31,
        carbohydrate: 0,
        fat: 3.6,
      }),
    ];
    const client = new FakeFatSecretClient({
      searchV4: { 'chicken breast': [chicken], breast: [chicken], chicken: [chicken] },
      foods: {
        'chicken-breast': { id: 'chicken-breast', name: 'Chicken breast, raw, skinless', brandName: null, servings } as FatSecretFoodDetails,
      },
    });

    const result = await mapIngredientWithFatsecret('2 chicken breasts cut into 1\" pieces', {
      client: client as any,
    });

    expect(result).not.toBeNull();
    expect(client.searchFoodsCalls.some(q => /inch/.test(q))).toBe(false);
  });

  it('strips thinly/sliced descriptors (onion thinly sliced)', async () => {
    const onion = { id: 'onion', name: 'Onions, raw', brandName: null, foodType: 'Generic' };
    const servings = [
      createServing({
        id: 'srv-100',
        description: '100 g',
        servingWeightGrams: 100,
        calories: 40,
        protein: 1.1,
        carbohydrate: 9.3,
        fat: 0.1,
      }),
    ];
    const client = new FakeFatSecretClient({
      searchV4: { onion: [onion], onions: [onion] },
      foods: { onion: { id: 'onion', name: 'Onions, raw', brandName: null, servings } as FatSecretFoodDetails },
    });

    await mapIngredientWithFatsecret('1 onion thinly sliced', { client: client as any });
    expect(client.searchFoodsCalls.some(q => q.includes('thinly'))).toBe(false);
  });

  it('prefers plain oils over spreads for vegetable oil queries', async () => {
    const plainOil = { id: 'veg-oil', name: 'Vegetable oil', brandName: null, foodType: 'Generic' };
    const spread = { id: 'veg-spread', name: 'Vegetable oil spread', brandName: 'BrandCo', foodType: 'Brand' };
    const servings = [
      createServing({
        id: 'srv-100',
        description: '100 g',
        servingWeightGrams: 100,
        calories: 884,
        protein: 0,
        carbohydrate: 0,
        fat: 100,
      }),
    ];
    const client = new FakeFatSecretClient({
      searchV4: { 'vegetable oil': [plainOil, spread], oil: [plainOil, spread] },
      foods: {
        'veg-oil': { id: 'veg-oil', name: 'Vegetable oil', brandName: null, foodType: 'Generic', servings } as FatSecretFoodDetails,
        'veg-spread': { id: 'veg-spread', name: 'Vegetable oil spread', brandName: 'BrandCo', foodType: 'Brand', servings } as FatSecretFoodDetails,
      },
    });

    const result = await mapIngredientWithFatsecret('vegetable oil', { client: client as any });
    expect(result?.foodId).toBe('veg-oil');
  });

  it('maps chicken sausage to chicken sausage, not pork sausage', async () => {
    // Increase timeout since this test processes multiple candidates and may use AI rerank
    jest.setTimeout(15000);
    
    const servings = [
      createServing({
        id: 'srv-100g',
        description: '100 g',
        servingWeightGrams: 100,
        numberOfUnits: 100,
        calories: 196,
        protein: 16,
        carbohydrate: 1,
        fat: 13,
      }),
    ];

    // Create chicken sausage and pork sausage foods
    const chickenSausage = { 
      id: 'chicken-sausage', 
      name: 'Chicken Sausage', 
      brandName: null, 
      foodType: 'Generic' 
    };
    const porkSausage = { 
      id: 'pork-sausage', 
      name: 'Italian Sausage, Pork', 
      brandName: null, 
      foodType: 'Generic' 
    };

    // Simulate FatSecret API returning both, with pork potentially ranking higher initially
    // Note: buildSearchExpressions generates multiple variants, so we need to mock common ones
    const client = new FakeFatSecretClient({
      searchV4: {
        'chicken sausage': [porkSausage, chickenSausage], // Pork first (simulating popularity ranking)
        'chicken': [porkSausage, chickenSausage],
        'sausage': [porkSausage, chickenSausage],
        // Add variants that buildSearchExpressions might generate
        'sausage chicken': [porkSausage, chickenSausage],
      },
      foods: {
        'chicken-sausage': { 
          id: 'chicken-sausage', 
          name: 'Chicken Sausage', 
          brandName: null, 
          servings 
        } as FatSecretFoodDetails,
        'pork-sausage': { 
          id: 'pork-sausage', 
          name: 'Italian Sausage, Pork', 
          brandName: null, 
          servings 
        } as FatSecretFoodDetails,
      },
    });

    const result = await mapIngredientWithFatsecret('chicken sausage', { 
      client: client as any,
      minConfidence: 0.5 
    });
    
    expect(result).not.toBeNull();
    expect(result?.foodName.toLowerCase()).toContain('chicken');
    expect(result?.foodName.toLowerCase()).not.toContain('pork');
    expect(result?.foodName.toLowerCase()).not.toContain('italian');
    expect(result?.foodId).toBe('chicken-sausage');
    expect(result?.confidence).toBeGreaterThan(0.5);
  });
});
