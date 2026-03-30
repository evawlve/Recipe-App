import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';
import * as validatedHelpers from '../src/lib/fatsecret/validated-mapping-helpers';

jest = undefined as any;

class FakeFatSecretClient {
  public searchFoodsCalls: string[] = [];
  responses: any = {};
  async searchFoodsV4(query: string) {
    this.searchFoodsCalls.push(query);
    return [];
  }
  async getFoodDetails(id: string) { return null; }
  async autocompleteFoods() { return []; }
}

async function test() {
  (validatedHelpers as any).getValidatedMappingByNormalizedName = async () => null;
  (validatedHelpers as any).saveValidatedMapping = async () => null;
  (validatedHelpers as any).trackValidationFailure = async () => null;

  const client = new FakeFatSecretClient();
  await mapIngredientWithFatsecret('2 chicken breasts cut into 1 inch pieces', { 
    client: client as any, debug: true, allowLiveFallback: true, minConfidence: 0 
  });
  console.log('searchFoodsCalls:', client.searchFoodsCalls);
}

test().catch(console.error);
