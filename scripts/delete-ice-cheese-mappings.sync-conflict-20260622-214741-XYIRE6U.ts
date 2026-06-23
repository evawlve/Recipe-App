#!/usr/bin/env ts-node
/**
 * Delete bad ice and cheese mappings from ValidatedMapping cache
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('🧹 Cleaning bad mappings from cache...\n');

    // Delete ice → Ice Breakers mappings
    const iceResult = await prisma.validatedMapping.deleteMany({
        where: {
            rawIngredient: { contains: 'ice' },
            foodName: { contains: 'Ice Breakers' }
        }
    });
    console.log(`❄️  Deleted ${iceResult.count} Ice Breakers mappings for ice queries`);

    // Delete reduced fat cheese → full-fat mappings
    const cheeseEntries = await prisma.validatedMapping.findMany({
        where: {
            rawIngredient: { contains: 'reduced fat' }
        }
    });

    // Filter to find ones where foodName doesn't have reduced
    const badCheese = cheeseEntries.filter(e =>
        !e.foodName.toLowerCase().includes('reduced') &&
        (e.rawIngredient.includes('colby') || e.rawIngredient.includes('monterey'))
    );

    if (badCheese.length > 0) {
        console.log(`🧀 Found ${badCheese.length} bad cheese mappings:`);
        for (const entry of badCheese) {
            console.log(`   "${entry.rawIngredient}" → "${entry.foodName}"`);
            await prisma.validatedMapping.delete({ where: { id: entry.id } });
        }
    } else {
        console.log(`🧀 No bad cheese mappings found`);
    }

    // Also delete from IngredientFoodMap if there are any active mappings
    const ingredientResult = await prisma.ingredientFoodMap.deleteMany({
        where: {
            ingredient: {
                name: { contains: 'crushed ice' }
            }
        }
    });
    console.log(`📝 Deleted ${ingredientResult.count} IngredientFoodMap entries for crushed ice`);

    console.log('\n✅ Cache cleanup complete!');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
