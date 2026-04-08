import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function test() {
  const line = process.argv[2] || '8 oz parmesan cheese fat free';
  const result = await mapIngredientWithFallback(line);
  console.log('Query: "' + line + '"');
  console.dir(result, { depth: null });
}

test().catch(console.error).finally(()=>process.exit(0));
