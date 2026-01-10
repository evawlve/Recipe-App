import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function cleanupBadMappings() {
    console.log('Cleaning up bad ValidatedMapping entries...\n');

    // Delete the bad almond milk -> chocolate candy mapping
    const deleted = await prisma.validatedMapping.deleteMany({
        where: {
            OR: [
                { rawIngredient: { contains: 'almond milk', mode: 'insensitive' } },
                { rawIngredient: { contains: 'green chili', mode: 'insensitive' } },
            ]
        }
    });

    console.log(`Deleted ${deleted.count} bad mappings`);
}

cleanupBadMappings()
    .then(() => prisma.$disconnect())
    .catch(e => { console.error(e); process.exit(1); });
