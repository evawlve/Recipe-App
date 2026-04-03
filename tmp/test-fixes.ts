import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function test() {
  const q1 = await mapIngredientWithFallback('0.5 tsp nutmeg');
  console.log('Q1 RESULT =>', q1?.foodName, q1?.brandName);
  
  const q2 = await mapIngredientWithFallback('1 can corn');
  console.log('Q2 RESULT =>', q2?.foodName, q2?.brandName);

  const q3 = await mapIngredientWithFallback('4.5 oz lasagna');
  console.log('Q3 RESULT =>', q3?.foodName, q3?.brandName);
}

test().catch(console.error).finally(() => process.exit(0));
