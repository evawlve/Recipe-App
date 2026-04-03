import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const targets = ['peanut butter', 'matcha', 'bouillon', 'cheddar', 'mustard'];
  for (const t of targets) {
    const res = await prisma.ingredientFoodMap.deleteMany({
      where: {
        ingredient: {
          name: { contains: t, mode: 'insensitive' }
        }
      }
    });
    console.log(`Deleted ${res.count} mappings for ${t}`);
  }
}

run()
  .catch(console.error)
  .finally(() => process.exit(0));
