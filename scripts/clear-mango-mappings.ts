import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('\n=== Clearing Mango Mappings ===\n');

    // First show what we'll delete
    const mappings = await prisma.validatedMapping.findMany({
        where: { rawIngredient: { contains: 'mango', mode: 'insensitive' } },
        select: { rawIngredient: true, foodName: true },
    });

    console.log(`Found ${mappings.length} mango mappings to clear:`);
    for (const m of mappings) {
        console.log(`  "${m.rawIngredient}" → "${m.foodName}"`);
    }

    // Delete them
    const result = await prisma.validatedMapping.deleteMany({
        where: { rawIngredient: { contains: 'mango', mode: 'insensitive' } },
    });

    console.log(`\nDeleted ${result.count} mappings.`);
}

main().finally(() => prisma.$disconnect());
