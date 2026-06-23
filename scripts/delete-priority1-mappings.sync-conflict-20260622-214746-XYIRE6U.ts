/**
 * Delete bad ValidatedMapping cache entries for Priority 1 false positives
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';

const BAD_MAPPINGS = [
    // ice cubes → Ice Breakers
    { rawIngredient: '%ice cube%' },
    // vinegar → dressing
    { rawIngredient: '%cup vinegar%' },
    { rawIngredient: '%vinegar%', foodName: '%dressing%' },
    // acai puree → Tomato Puree
    { rawIngredient: '%acai%', foodName: '%tomato%' },
    // plum tomatoes → Plum fruit
    { rawIngredient: '%plum tomato%', foodName: 'Plum%' },
    // cilantro → Coriander Seed
    { rawIngredient: '%cilantro%', foodName: '%coriander%' },
    // mixed seeds bread → Mixed Pickles
    { rawIngredient: '%seeds bread%', foodName: '%pickle%' },
    { rawIngredient: '%mixed seeds%', foodName: '%pickle%' },
];

async function main() {
    console.log('🔍 Deleting Priority 1 false positive cache entries...\n');

    let totalDeleted = 0;

    for (const mapping of BAD_MAPPINGS) {
        const whereClause: any = {};

        if (mapping.rawIngredient) {
            whereClause.rawIngredient = {
                contains: mapping.rawIngredient.replace(/%/g, ''),
                mode: 'insensitive',
            };
        }

        if ('foodName' in mapping && mapping.foodName) {
            whereClause.foodName = {
                contains: mapping.foodName.replace(/%/g, ''),
                mode: 'insensitive',
            };
        }

        const matches = await prisma.validatedMapping.findMany({
            where: whereClause,
            select: { id: true, rawIngredient: true, foodName: true },
        });

        if (matches.length > 0) {
            console.log(`Found ${matches.length} entries matching "${mapping.rawIngredient}"${mapping.foodName ? ` → "${mapping.foodName}"` : ''}:`);
            for (const m of matches.slice(0, 5)) {
                console.log(`  - "${m.rawIngredient}" → "${m.foodName}"`);
            }
            if (matches.length > 5) console.log(`  ... and ${matches.length - 5} more`);

            const deleted = await prisma.validatedMapping.deleteMany({
                where: { id: { in: matches.map(m => m.id) } },
            });

            totalDeleted += deleted.count;
            console.log(`  ✓ Deleted ${deleted.count} entries\n`);
        }
    }

    console.log(`\n✅ Total deleted: ${totalDeleted} bad cache entries`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
