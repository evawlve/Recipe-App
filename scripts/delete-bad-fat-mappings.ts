/**
 * Delete bad ValidatedMapping cache entries for fat-free cheese items
 * 
 * These mappings were created before fat modifier enforcement was improved,
 * causing "fat free cheddar" to incorrectly map to regular "Cheddar Cheese".
 * 
 * Run: npx ts-node scripts/delete-bad-fat-mappings.ts
 */

import { prisma } from '../src/lib/db';

const FAT_FREE_PATTERNS = [
    '%fat free%cheddar%',
    '%fat free%mozzarella%',
    '%fat free%feta%',
    '%fat-free%cheese%',
    '%nonfat%cheese%',
    '%non-fat%cheese%',
    '%lowfat%cheese%',
    '%low-fat%cheese%',
    '%low fat%cheese%',
    '%reduced fat%cheese%',
    '%mozzarella%fat free%',
    '%cottage cheese%low fat%',
    '%nonfat%italian%dressing%',
    '%cheese%nonfat%',
    '%reduced fat%ground%pork%',
];

async function main() {
    console.log('🔍 Searching for bad fat-free cheese mappings...\n');

    let totalDeleted = 0;

    for (const pattern of FAT_FREE_PATTERNS) {
        // Find entries matching this pattern
        const matches = await prisma.validatedMapping.findMany({
            where: {
                rawIngredient: {
                    contains: pattern.replace(/%/g, ''),
                    mode: 'insensitive',
                },
            },
            select: {
                id: true,
                rawIngredient: true,
                foodName: true,
            },
        });

        if (matches.length > 0) {
            console.log(`Found ${matches.length} entries for pattern "${pattern}":`);
            for (const m of matches) {
                console.log(`  - "${m.rawIngredient}" → "${m.foodName}"`);
            }

            // Delete them
            const deleted = await prisma.validatedMapping.deleteMany({
                where: {
                    id: { in: matches.map(m => m.id) },
                },
            });

            totalDeleted += deleted.count;
            console.log(`  ✓ Deleted ${deleted.count} entries\n`);
        }
    }

    // Also search for any entries where query has fat modifier but mapped food doesn't
    console.log('🔍 Searching for modifier mismatch entries...\n');

    const fatModifiers = ['fat free', 'fat-free', 'nonfat', 'non-fat', 'lowfat', 'low-fat', 'low fat', 'reduced fat'];

    for (const modifier of fatModifiers) {
        const mismatchEntries = await prisma.validatedMapping.findMany({
            where: {
                AND: [
                    { rawIngredient: { contains: modifier, mode: 'insensitive' } },
                    { NOT: { foodName: { contains: modifier.replace('-', ''), mode: 'insensitive' } } },
                    { NOT: { foodName: { contains: modifier.replace(' ', ''), mode: 'insensitive' } } },
                ],
            },
            select: {
                id: true,
                rawIngredient: true,
                foodName: true,
            },
        });

        if (mismatchEntries.length > 0) {
            console.log(`Found ${mismatchEntries.length} modifier mismatch entries for "${modifier}":`);
            for (const m of mismatchEntries.slice(0, 10)) {
                console.log(`  - "${m.rawIngredient}" → "${m.foodName}"`);
            }
            if (mismatchEntries.length > 10) {
                console.log(`  ... and ${mismatchEntries.length - 10} more`);
            }

            const deleted = await prisma.validatedMapping.deleteMany({
                where: {
                    id: { in: mismatchEntries.map(m => m.id) },
                },
            });

            totalDeleted += deleted.count;
            console.log(`  ✓ Deleted ${deleted.count} entries\n`);
        }
    }

    console.log(`\n✅ Total deleted: ${totalDeleted} bad cache entries`);
    console.log('Re-run the pilot import to get fresh mappings with improved API trust.');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
