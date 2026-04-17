import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';

async function test() {
  console.log('Testing low fat milk...');
  const result = await mapIngredientWithFallback('1 cup low fat milk');
  console.log('Result:', JSON.stringify(result, null, 2));
  
  await prisma.$disconnect();
}

test().catch(console.error);
