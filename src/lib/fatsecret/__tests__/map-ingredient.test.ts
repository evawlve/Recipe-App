import { mapIngredientWithFatsecret } from '../map-ingredient';
import type { FatSecretNlpParseResponse, FatSecretSearchResponse, FatSecretFoodDetails } from '../client';

type ClientResponse = {
  nlp?: Record<string, FatSecretNlpParseResponse | null>;
  search?: Record<string, FatSecretSearchResponse>;
  foods?: Record<string, FatSecretFoodDetails | null>;
};

class FakeFatSecretClient {
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

  async getFood(foodId: string) {
    return this.responses.foods?.[foodId] ?? null;
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
  it('maps simple egg line using NLP output', async () => {
    const servings = [
      createServing({
        id: 'srv-egg',
        description: '1 large',
        servingWeightGrams: 50,
        calories: 72,
        protein: 6.3,
        carbohydrate: 0.4,
        fat: 4.8,
      }),
    ];

    const client = new FakeFatSecretClient({
      nlp: {
        '3 large eggs': {
          entries: [
            {
              foodId: 'egg-whole',
              foodName: 'Egg, whole, raw',
              brandName: null,
              servingId: 'srv-egg',
              servingDescription: '1 large',
              servingWeightGrams: 50,
              servings,
            },
          ],
        },
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

    const result = await mapIngredientWithFatsecret('3 large eggs', { client: client as any });
    expect(result).not.toBeNull();
    expect(result?.foodName).toContain('Egg');
    expect(result?.grams).toBeCloseTo(150, 1);
    expect(result?.kcal).toBeCloseTo(216, 1);
    expect(result?.protein).toBeCloseTo(18.9, 1);
    expect(result?.confidence).toBeGreaterThan(0.55);
  });

  it('prefers yolk entries when unit hint targets yolk', async () => {
    const servings = [
      createServing({ id: 'srv', description: '1 yolk', servingWeightGrams: 17, calories: 55, protein: 2.7, carbohydrate: 0.6, fat: 4.5 }),
    ];

    const client = new FakeFatSecretClient({
      search: {
        egg: {
          foods: [
            { id: 'egg-whole', name: 'Egg, whole', brandName: null, servings },
            { id: 'egg-yolk', name: 'Egg, yolk, raw', brandName: null, servings },
          ],
          totalResults: 2,
          maxResults: 2,
          pageNumber: 0,
        },
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
        calories: 365,
        protein: 7.5,
        carbohydrate: 76,
        fat: 2.7,
      }),
    ];
    const client = new FakeFatSecretClient({
      search: {
        'brown rice': {
          foods: [
            { id: 'rice-raw', name: 'Brown rice, raw', brandName: null, servings: rawServing },
            { id: 'rice-cooked', name: 'Brown rice, cooked', brandName: null, servings: cookedServing },
          ],
          totalResults: 2,
          maxResults: 2,
          pageNumber: 0,
        },
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
});
