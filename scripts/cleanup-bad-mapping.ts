import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function check() {
    // Delete the bad almond milk mapping
    const deleted = await prisma.validatedMapping.deleteMany({
        where: { foodId: 'fdc_168754' } // The chocolate candy
    });
    console.log(`Deleted ${deleted.count} bad mappings`);

    // Check what mappings exist for almond milk
    const mappings = await prisma.validatedMapping.findMany({
        where: { rawIngredient: { contains: 'almond milk', mode: 'insensitive' } },
    });

    console.log('\nRemaining almond milk mappings:');
    for (const m of mappings) {
        console.log(`  "${m.rawIngredient}" → ${m.foodName} (${m.foodId})`);
    }
}

check().finally(() => prisma.$disconnect());
