import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const total = await prisma.recipe.count();
  const unmapped = await prisma.recipe.count({
    where: { ingredients: { some: { foodMaps: { none: {} } } } }
  });
  console.log(`Total recipes: ${total}`);
  console.log(`Recipes with unmapped ingredients: ${unmapped}`);
}

run()
  .catch(console.error)
  .finally(() => process.exit(0));
