import { prisma } from '@/lib/db';
import { generateAliasesForFood, canonicalAlias } from '@/ops/foods/alias-rules';

const BATCH_SIZE = Number(process.env.ALIAS_BATCH_SIZE || 1000);
const PAGE_SIZE  = Number(process.env.ALIAS_PAGE_SIZE  || 500);

async function* pagedFoods() {
  let cursor: string | null = null;
  for (;;) {
    const page: Array<{ id: string; name: string; categoryId: string | null }> = await prisma.food.findMany({
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      take: PAGE_SIZE,
      select: { id: true, name: true, categoryId: true },
      orderBy: { id: 'asc' },
    });
    if (page.length === 0) return;
    yield page;
    cursor = page[page.length - 1].id;
  }
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

(async () => {
  console.log('🔍 Backfill (fast): paging foods, bulk insert with skipDuplicates…');

  let foodsProcessed = 0;
  let aliasRowsCreated = 0;

  for await (const foods of pagedFoods()) {
    foodsProcessed += foods.length;

    // Build aliases for this page in-memory
    const rows: { foodId: string; alias: string }[] = [];
    for (const f of foods) {
      const aliases = uniq([ canonicalAlias(f.name), ...generateAliasesForFood(f.name, f.categoryId) ]);
      for (const a of aliases) rows.push({ foodId: f.id, alias: a });
    }

    // Chunked createMany with skipDuplicates; no per-alias SELECTs
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const res = await prisma.foodAlias.createMany({
        data: chunk,
        skipDuplicates: true,
      });
      aliasRowsCreated += res.count;
    }

    console.log(`…processed foods: ${foodsProcessed}, created new aliases: ${aliasRowsCreated}`);
  }

  console.log('✅ Done', { foodsProcessed, aliasRowsCreated });
  await prisma.$disconnect();
})();
