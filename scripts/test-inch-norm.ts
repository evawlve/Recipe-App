import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';
const result = normalizeIngredientName('chicken breasts cut into 1" pieces');
console.log(JSON.stringify(result, null, 2));
