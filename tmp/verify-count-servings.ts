import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const servings = await prisma.openFoodFactsServingCache.findMany({
    select: {
      description: true
    }
  });
  
  const units = new Set();
  for (const s of servings) {
    const parts = s.description.split(' ');
    if (parts.length >= 2 && parts[0] === '1') {
      units.add(parts.slice(1).join(' '));
    }
  }
  
  console.log('Units generated so far:');
  console.log(Array.from(units).join(', '));
}

main().catch(console.error).finally(() => prisma.$disconnect());
