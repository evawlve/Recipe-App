import { seedCuratedFromFile } from '../seed-curated';
import { prisma } from '@/lib/db';

test('curated seed imports items idempotently', async () => {
  // Clean up any existing test data first
  await prisma.foodAlias.deleteMany({
    where: { foodId: { startsWith: 'seed_' } }
  });
  await prisma.foodUnit.deleteMany({
    where: { foodId: { startsWith: 'seed_' } }
  });
  await prisma.food.deleteMany({
    where: { id: { startsWith: 'seed_' } }
  });

  const res1 = await seedCuratedFromFile('data/curated/pack-basic.json', { dryRun: true });
  expect(res1.created + res1.updated).toBeGreaterThan(0);

  const res2 = await seedCuratedFromFile('data/curated/pack-basic.json', { dryRun: false });
  expect(res2.created + res2.updated).toBeGreaterThan(0);

  const res3 = await seedCuratedFromFile('data/curated/pack-basic.json', { dryRun: false });
  // second run should mostly update/skip, not re-create units/aliases
  expect(res3.created).toBe(0);
}, 30000); // 30 second timeout for database operations
