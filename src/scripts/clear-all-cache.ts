// Clear ALL validated mappings and AI normalize cache for fresh pilot import
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: [] });

async function main() {
    console.log('=== Clearing ALL cached mappings for fresh pilot import ===\n');

    if (!process.argv.includes('--force')) {
        console.error('❌ ERROR: This is a destructive action that will wipe the entire mapping cache!');
        console.error('   We want to progressively build our mapping dictionary.');
        console.error('   To clear a specific ingredient, use: npx tsx src/scripts/check-cache-entry.ts "ingredient" --clear');
        console.error('   If you REALLY need to wipe everything, run this script with the --force flag.\n');
        process.exit(1);
    }

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
