/**
 * Clear false positive mappings from ValidatedMapping cache
 * 
 * Run with: npx tsx scripts/clear-bad-mappings.ts
 */
import { prisma } from '../src/lib/db';

// Known false positive patterns to clear
const BAD_MAPPINGS = [
    // Modifier mismatches
    { rawPattern: '%2% milk%', badFoodPattern: '%whole milk%' },
    { rawPattern: '%1% milk%', badFoodPattern: '%whole milk%' },
    { rawPattern: '%skim milk%', badFoodPattern: '%whole milk%' },
    { rawPattern: '%low calorie%', badFoodPattern: null }, // Clear all low-calorie to re-evaluate
    { rawPattern: '%diet %soda%', badFoodPattern: null },
    { rawPattern: '%diet %cola%', badFoodPattern: null },
    // Category mismatches
    { rawPattern: '%ice%', badFoodPattern: '%ice cream%' },
    // Exact failures from the log
    { rawPattern: 'Tomato Sauce', badFoodPattern: null },
    { rawPattern: '%tomato sauce%', badFoodPattern: null },
];

async function clearBadMappings() {
    console.log('🧹 Clearing false positive mappings from ValidatedMapping cache...\n');

    let totalCleared = 0;

    for (const { rawPattern, badFoodPattern } of BAD_MAPPINGS) {
        const whereClause: any = {
            rawIngredient: {
                contains: rawPattern.replace(/%/g, ''),
                mode: 'insensitive',
            },
        };

        if (badFoodPattern) {
            whereClause.foodName = {
                contains: badFoodPattern.replace(/%/g, ''),
                mode: 'insensitive',
            };
        }

        try {
            // First find what we're going to delete
            const toDelete = await prisma.validatedMapping.findMany({
                where: whereClause,
                select: {
                    rawIngredient: true,
                    foodName: true,
                },
            });

            if (toDelete.length > 0) {
                console.log(`\n📋 Pattern: "${rawPattern}" → "${badFoodPattern || '*'}"`);
                console.log(`   Found ${toDelete.length} mappings to clear:`);
                toDelete.slice(0, 5).forEach(m => {
                    console.log(`   - "${m.rawIngredient}" → "${m.foodName}"`);
                });
                if (toDelete.length > 5) {
                    console.log(`   ... and ${toDelete.length - 5} more`);
                }

                // Delete them
                const result = await prisma.validatedMapping.deleteMany({
                    where: whereClause,
                });

                console.log(`   ✅ Cleared ${result.count} mappings`);
                totalCleared += result.count;
            }
        } catch (err) {
            console.error(`   ❌ Error: ${(err as Error).message}`);
        }
    }

    console.log(`\n🎯 Total cleared: ${totalCleared} false positive mappings`);
    console.log('\nNext steps:');
    console.log('1. Run a new pilot import to re-map these ingredients');
    console.log('2. The new filtering logic will now apply correctly\n');
}

clearBadMappings()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
