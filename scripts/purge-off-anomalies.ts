import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BARCODES_TO_PURGE = [
  '20002039',
  '0013130006125',
  '0722252702067',
  '01273588',
  '0810607020710',
  '5034660021445',
  '26073651',
];

async function main() {
  const offIds = BARCODES_TO_PURGE.map(b => `off_${b}`);

  console.log(`Starting purge of ${offIds.length} corrupted OpenFoodFacts mappings...`);

  // We should delete from ValidatedMapping first to satisfy foreign key constraints (if any), 
  // though ValidatedMapping has onDelete: Cascade if it references OpenFoodFactsCache
  const deleteMappingsResult = await prisma.validatedMapping.deleteMany({
    where: {
      foodId: { in: offIds }
    }
  });
  console.log(`Deleted ${deleteMappingsResult.count} records from ValidatedMapping.`);

  const deleteServingsResult = await prisma.openFoodFactsServingCache.deleteMany({
    where: {
      offId: { in: offIds }
    }
  });
  console.log(`Deleted ${deleteServingsResult.count} records from OpenFoodFactsServingCache.`);

  const deleteCacheResult = await prisma.openFoodFactsCache.deleteMany({
    where: {
      id: { in: offIds }
    }
  });
  console.log(`Deleted ${deleteCacheResult.count} records from OpenFoodFactsCache.`);
  
  console.log('Purge complete.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
