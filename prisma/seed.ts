import { PrismaClient } from '@prisma/client';
import { seedCuratedFromFile } from '@/ops/curated/seed-curated';
const prisma = new PrismaClient();

async function upsertFood(args: any) {
  return prisma.food.upsert({
    where: { id: args.id },
    update: args,
    create: args,
  });
}

async function main() {
  await upsertFood({
    id: 'seed_olive_oil',
    name: 'Olive Oil',
    brand: null,
    categoryId: 'oil',
    source: 'template',
    verification: 'verified',
    densityGml: 0.91,
    kcal100: 884, protein100: 0, carbs100: 0, fat100: 100, fiber100: 0, sugar100: 0,
    popularity: 100,
    units: { create: [{ label: '1 tbsp', grams: 13.6 }] },
  });

  await upsertFood({
    id: 'seed_ap_flour',
    name: 'All-Purpose Flour',
    categoryId: 'flour',
    source: 'template',
    verification: 'verified',
    densityGml: 0.53,
    kcal100: 364, protein100: 10, carbs100: 76, fat100: 1,
    fiber100: 3, sugar100: 1,
    popularity: 80,
    units: { create: [{ label: '1 cup', grams: 120 }] },
  });

  await upsertFood({
    id: 'seed_whey_isolate',
    name: 'Whey Protein Isolate (Generic)',
    categoryId: 'whey',
    source: 'template',
    verification: 'verified',
    densityGml: 0.5,
    kcal100: 380, protein100: 85, carbs100: 5, fat100: 2,
    popularity: 120,
    units: { create: [{ label: '1 scoop', grams: 32 }] },
  });

  await upsertFood({
    id: 'seed_nonfat_milk',
    name: 'Milk, Nonfat',
    categoryId: 'liquid',
    source: 'template',
    verification: 'verified',
    densityGml: 1.03,
    kcal100: 34, protein100: 3.4, carbs100: 5, fat100: 0.1,
    popularity: 60,
    units: { create: [{ label: '1 cup', grams: 245 }] },
  });
}

main().finally(async () => {
  await prisma.$disconnect();
});

// Curated seed packs integration
if (process.env.CURATED_SEED_PACKS) {
  const packs = process.env.CURATED_SEED_PACKS.split(',').map(s => s.trim());
  for (const p of packs) {
    await seedCuratedFromFile(p, { dryRun: false });
  }
}

