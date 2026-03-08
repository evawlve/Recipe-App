import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('\n=== Deleting Bad Cache Entries ===\n');

    // Delete bad golden flaxseed meal → Golden Delicious Apples mapping
    const deleted = await prisma.validatedMapping.deleteMany({
        where: { normalizedForm: 'golden flaxseed meal' }
    });
    console.log('Deleted golden flaxseed meal bad mapping:', deleted.count);

    // Also check if there are any other suspicious "golden" mappings
    const remaining = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'golden' } }
    });
    console.log('\nRemaining golden mappings:');
    remaining.forEach(m => {
        console.log(`  "${m.normalizedForm}" → "${m.foodName}"`);
    });

    await prisma.$disconnect();
}

main().catch(console.error);
