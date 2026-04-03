import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';
import * as fs from 'fs';
const out = normalizeIngredientName('1.4 oz vanilla protein powder');
fs.writeFileSync('C:/Dev/Recipe App/tmp/trace.txt', JSON.stringify(out, null, 2), 'utf8');
