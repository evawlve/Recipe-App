import 'dotenv/config';
process.env.DEBUG = '';

async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ log: [] });

  // Find FDC IDs for grape tomatoes
  const fdcFoods = await prisma.fdcFoodCache.findMany({
    where: { description: { contains: 'grape tomato', mode: 'insensitive' } },
    select: { id: true, description: true },
  });
  
  console.log('FDC grape tomato entries:');
  for (const f of fdcFoods) {
    console.log(`  ${f.id}: ${f.description}`);
  }

  // Delete AI-estimated size servings for grape tomatoes (they have wrong weights)
  const fdcIds = fdcFoods.map(f => f.id);
  if (fdcIds.length > 0) {
    const deleted = await prisma.fdcServingCache.deleteMany({
      where: {
        fdcId: { in: fdcIds },
        isAiEstimated: true,
      },
    });
    console.log(`\nDeleted ${deleted.count} AI-estimated FDC servings for grape tomatoes`);
  }

  // Also clear ValidatedMapping and AiNormalizeCache for grape tomatoes
  const vmDeleted = await prisma.validatedMapping.deleteMany({
    where: {
      OR: [
        { rawIngredient: { contains: 'grape tomato', mode: 'insensitive' } },
        { normalizedForm: { contains: 'grape tomato', mode: 'insensitive' } },
      ],
    },
  });
  console.log(`Deleted ${vmDeleted.count} ValidatedMapping entries`);

  const aiDeleted = await prisma.aiNormalizeCache.deleteMany({
    where: { rawLine: { contains: 'grape tomato', mode: 'insensitive' } },
  });
  console.log(`Deleted ${aiDeleted.count} AiNormalizeCache entries`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
