import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';

async function test() {
  console.log('Testing garlic salt...');
  const result = await mapIngredientWithFallback('1 tsp garlic salt');
  console.log('Result:', JSON.stringify(result, null, 2));
  
  await prisma.$disconnect();
}

test().catch(console.error);
