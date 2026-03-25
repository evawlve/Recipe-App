import 'dotenv/config';
process.env.DEBUG = '';

async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ log: [] });
  
  const fdcFoods = await prisma.fdcFoodCache.findMany({
    where: { description: { contains: 'grape tomato', mode: 'insensitive' } },
    select: { id: true, description: true, servingSize: true, servingSizeUnit: true },
    take: 5,
  });
  console.log('=== FDC Foods matching "grape tomato" ===');
  for (const f of fdcFoods) {
    console.log(`  ID: ${f.id} | ${f.description} | serving: ${f.servingSize} ${f.servingSizeUnit}`);
    const servings = await prisma.fdcServingCache.findMany({ where: { fdcId: f.id } });
    for (const s of servings) {
      console.log(`    -> ${s.description}: ${s.grams}g (AI: ${s.isAiEstimated})`);
    }
  }

  // Also check the FDC food servingSize field (from FDC API)  
  const firstFood = fdcFoods[0];
  if (firstFood) {
    console.log(`\nFDC servingSize from API: ${firstFood.servingSize}g (${firstFood.servingSizeUnit})`);
    console.log(`This is what FDC reports as the "serving size", likely for the container/package.`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
