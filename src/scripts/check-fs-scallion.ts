/**
 * Check and fix FatSecret scallion servings
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log("\n=== CHECKING FATSECRET SCALLION SERVINGS ===");

    const foods = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'scallion', mode: 'insensitive' } }
    });

    for (const food of foods) {
        console.log(`\nFood: ${food.name} (ID: ${food.id})`);

        const servings = await prisma.fatSecretServingCache.findMany({
            where: { foodId: food.id }
        });

        for (const s of servings) {
            const grams = s.metricServingAmount || 0;
            const flag = grams > 50 ? '❌ BAD' : '✅';
            console.log(`  ${s.servingDescription}: ${grams}${s.metricServingUnit} ${flag}`);

            // Delete the bad serving if > 100g for a single scallion
            if (grams > 100 && s.servingDescription?.includes('medium')) {
                console.log(`    → DELETING bad serving`);
                await prisma.fatSecretServingCache.delete({ where: { id: s.id } });
            }
        }
    }

    await prisma.$disconnect();
}

main().catch(console.error);
