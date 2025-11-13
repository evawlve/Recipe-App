import { PrismaClient } from '@prisma/client';
import { generateAliasesForFood, canonicalAlias } from '../src/ops/foods/alias-rules';

const prisma = new PrismaClient();

(async () => {
  console.log('🔍 Fetching all foods...');
  const foods = await prisma.food.findMany({
    select: { id: true, name: true, categoryId: true }
  });

  console.log(`📊 Processing ${foods.length} foods...`);
  
  let created = 0, skipped = 0;
  
  for (const f of foods) {
    const want = new Set<string>([
      canonicalAlias(f.name), 
      ...generateAliasesForFood(f.name, f.categoryId)
    ]);
    
    for (const a of want) {
      if (!a || a.length === 0) continue;
      
      const exists = await prisma.foodAlias.findFirst({ 
        where: { foodId: f.id, alias: a } 
      });
      
      if (exists) { 
        skipped++; 
        continue; 
      }
      
      try {
        await prisma.foodAlias.create({ 
          data: { foodId: f.id, alias: a } 
        });
        created++;
      } catch {
        // Skip duplicates or other errors
        skipped++;
      }
    }
  }
  
  console.log('✅ Alias backfill complete!');
  console.log({ created, skipped, totalFoods: foods.length });
  
  await prisma.$disconnect();
})();
