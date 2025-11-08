import { prisma } from '../src/lib/db';

(async () => {
  const count = await prisma.food.count({
    where: { source: 'usda', verification: 'verified' }
  });
  
  console.log('\n✅ USDA Foods in Database:', count);
  
  const recent = await prisma.food.findMany({
    where: { source: 'usda' },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      name: true,
      categoryId: true,
      kcal100: true,
      protein100: true,
      carbs100: true,
      fat100: true
    }
  });
  
  console.log('\n📝 Sample of Recently Imported Foods:');
  recent.forEach(f => {
    console.log(`  - ${f.name} [${f.categoryId}] (${f.kcal100} kcal, P:${f.protein100}g C:${f.carbs100}g F:${f.fat100}g)`);
  });
  
  const byCategoryCount = await prisma.food.groupBy({
    by: ['categoryId'],
    where: { source: 'usda' },
    _count: { categoryId: true }
  });
  
  console.log('\n📊 Foods by Category:');
  byCategoryCount
    .sort((a, b) => b._count.categoryId - a._count.categoryId)
    .forEach(c => {
      console.log(`  ${c.categoryId}: ${c._count.categoryId} items`);
    });
  
  await prisma.$disconnect();
})();

