// Clear ALL validated mappings and AI normalize cache for fresh pilot import
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: [] });

async function main() {
    console.log('=== Clearing ALL cached mappings for fresh pilot import ===\n');

    // Clear validated mappings
    const validatedDeleted = await prisma.validatedMapping.deleteMany({});
    console.log(`Deleted ${validatedDeleted.count} validated mappings`);

    // Clear AI normalize cache
    const aiNormalizeDeleted = await prisma.aiNormalizeCache.deleteMany({});
    console.log(`Deleted ${aiNormalizeDeleted.count} AI normalize cache entries`);

    console.log('\n✅ All caches cleared! Ready for fresh pilot import.');

    await prisma.$disconnect();
}

main().catch(console.error);
