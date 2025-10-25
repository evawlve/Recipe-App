import { prisma } from '@/lib/db';
import { writeRecipeFeatureLite } from '@/lib/features/writeRecipeFeatureLite';

async function main() {
  console.log('Starting recipe features backfill...');
  
  const PAGE = 100;
  let cursor: string | undefined = undefined;
  let processed = 0;
  
  // simple pagination
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const recipes: { id: string }[] = await prisma.recipe.findMany({
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true }
    });
    
    if (recipes.length === 0) break;
    
    for (const r of recipes) {
      try {
        await writeRecipeFeatureLite(r.id);
        processed++;
        
        if (processed % 50 === 0) {
          console.log(`Processed ${processed} recipes...`);
        }
      } catch (error) {
        console.error(`Error processing recipe ${r.id}:`, error);
      }
    }
    
    cursor = recipes[recipes.length - 1].id;
    
    // optional tiny delay to avoid DB burst
    await new Promise(r => setTimeout(r, 10));
  }
  
  console.log(`Backfill complete. Processed ${processed} recipes.`);
}

main().finally(() => prisma.$disconnect());
