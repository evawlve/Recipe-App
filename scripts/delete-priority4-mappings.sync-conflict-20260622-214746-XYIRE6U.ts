/**
 * Delete bad ValidatedMapping cache entries for Priority 4 macro issues
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('🔍 Deleting Priority 4 bad macro cache entries...\n');

    let totalDeleted = 0;

    // Delete lentils with wrong macros (probably a dish, not plain lentils)
    const lentilsResult = await prisma.validatedMapping.deleteMany({
        where: {
            rawIngredient: { contains: 'lentil', mode: 'insensitive' },
        },
    });
    console.log(`Deleted ${lentilsResult.count} lentil entries`);
    totalDeleted += lentilsResult.count;

    // Delete olives with inverted macros
    const olivesResult = await prisma.validatedMapping.deleteMany({
        where: {
            rawIngredient: { contains: 'olive', mode: 'insensitive' },
        },
    });
    console.log(`Deleted ${olivesResult.count} olive entries`);
    totalDeleted += olivesResult.count;

    // Delete potatoes (in case they're mapped to fried versions)
    const potatoesResult = await prisma.validatedMapping.deleteMany({
        where: {
            rawIngredient: { contains: 'potato', mode: 'insensitive' },
        },
    });
    console.log(`Deleted ${potatoesResult.count} potato entries`);
    totalDeleted += potatoesResult.count;

    console.log(`\n✅ Total deleted: ${totalDeleted} bad cache entries`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
