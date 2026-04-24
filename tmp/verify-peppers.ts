import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';

async function test() {
  console.log('Testing peppers in adobo sauce...');
  const result = await mapIngredientWithFallback('3 peppers in adobo sauce');
  console.log('Result:', JSON.stringify(result, null, 2));
  
  await prisma.$disconnect();
}

test().catch(console.error);
