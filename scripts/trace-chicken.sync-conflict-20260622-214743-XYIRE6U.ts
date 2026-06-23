import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';
import * as validatedHelpers from '../src/lib/fatsecret/validated-mapping-helpers';
import { debugLogger } from '../src/lib/fatsecret/debug-logger';

jest = undefined as any;

class FakeFatSecretClient {
  public searchFoodsCalls: string[] = [];
  responses: any = {
    searchV4: {
      'chicken raw': [{ id: 'chicken-raw', name: 'Chicken breast, raw', foodType: 'Generic' }],
      'chicken': [{ id: 'chicken-raw', name: 'Chicken breast, raw', foodType: 'Generic' }],
      'breast': [{ id: 'chicken-raw', name: 'Chicken breast, raw', foodType: 'Generic' }]
    },
    foods: {
      'chicken-raw': { id: 'chicken-raw', name: 'Chicken breast, raw', foodType: 'Generic', servings: [{ description: '100 g', servingWeightGrams: 100, numberOfUnits: 100, calories: 265, protein: 24, carbohydrate: 0, fat: 18 }] }
    }
  };
  
  async searchFoodsV4(query: string) {
    this.searchFoodsCalls.push(query);
    const queryLower = query.toLowerCase();
    if (this.responses.searchV4[query]) return this.responses.searchV4[query];
    if (this.responses.searchV4[queryLower]) return this.responses.searchV4[queryLower];
    // Contains match
    for (const [k, v] of Object.entries(this.responses.searchV4)) {
      if (queryLower.includes(k) || k.includes(queryLower)) return v;
    }
    return [];
  }
  
  async getFoodDetails(id: string) { return this.responses.foods[id] || null; }
  async autocompleteFoods() { return []; }
}

async function test() {
  (validatedHelpers as any).getValidatedMappingByNormalizedName = async () => null;
  (validatedHelpers as any).saveValidatedMapping = async () => null;
  (validatedHelpers as any).trackValidationFailure = async () => null;

  debugLogger.logDebug = (msg: string, data: any) => {
    if (msg.includes('Filtered candidates missing required tokens') || msg.includes('All candidates removed by must-have tokens filter') || msg.includes('No serving match')) {
      console.log('DEBUG:', msg, JSON.stringify(data, null, 2));
    }
  };

  const client = new FakeFatSecretClient();
  const res = await mapIngredientWithFatsecret('100g raw chicken breast', { 
    client: client as any, debug: true, allowLiveFallback: true, minConfidence: 0 
  });
  console.log('Result:', res);
}

test().catch(console.error);
