/**
 * Clear ALL caches for green onion (simplified)
 */

import { prisma } from '../src/lib/db';

async function main() {
    console.log('=== Full Cache Clear for Green Onion ===\n');

    // 1. ValidatedMapping
    const m1 = await prisma.validatedMapping.deleteMany({
        where: { normalizedForm: { contains: 'green onion', mode: 'insensitive' } }
    });
    console.log(`Deleted ${m1.count} ValidatedMapping entries`);

    // 2. AiNormalizeCache  
    const m2 = await prisma.aiNormalizeCache.deleteMany({
        where: { normalizedName: { contains: 'green onion', mode: 'insensitive' } }
    });
    console.log(`Deleted ${m2.count} AiNormalizeCache entries`);

    // 3. Check if the bad Freshii food exists
    const freshiiFood = await prisma.fatSecretFoodCache.findFirst({
        where: {
            name: { contains: 'Green Onion', mode: 'insensitive' },
            brandName: { contains: 'Freshii', mode: 'insensitive' }
        },
        include: { servings: { take: 1 } }
    });

    if (freshiiFood) {
        console.log(`\nFound Freshii food: ${freshiiFood.name} (${freshiiFood.id})`);
        if (freshiiFood.servings[0]) {
            const s = freshiiFood.servings[0];
            console.log(`  Serving: ${s.calories}cal, P:${s.protein}, C:${s.carbohydrate}, F:${s.fat}`);
        }

        // Check for aliases pointing to this food
        const aliases = await prisma.fatSecretFoodAlias.findMany({
            where: { foodId: freshiiFood.id }
        });
        console.log(`\nAliases pointing to Freshii: ${aliases.length}`);
        for (const a of aliases) {
            console.log(`  "${a.alias}"`);
        }

        // Delete aliases to this food 
        if (aliases.length > 0) {
            const deleted = await prisma.fatSecretFoodAlias.deleteMany({
                where: { foodId: freshiiFood.id }
            });
            console.log(`✓ Deleted ${deleted.count} aliases to Freshii Green Onion`);
        }
    }

    console.log('\n✅ Complete!');

    await prisma.$disconnect();
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
