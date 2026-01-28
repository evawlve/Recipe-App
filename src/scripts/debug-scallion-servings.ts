/**
 * Check scallions size estimates
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // Check FDC serving cache for scallions
    console.log("\n=== FDC SCALLIONS SIZE DATA ===");
    const fdcFood = await prisma.fdcFoodCache.findFirst({
        where: { description: { contains: 'scallion', mode: 'insensitive' } }
    });

    if (fdcFood) {
        console.log(`Food: ${fdcFood.description} (ID: ${fdcFood.id})`);

        const servings = await prisma.fdcServingCache.findMany({
            where: { fdcId: fdcFood.id }
        });

        console.log(`\nServings (${servings.length}):`);
        for (const s of servings) {
            console.log(`  ${s.description}: ${s.grams}g (source: ${s.source || 'unknown'})`);
        }
    }

    // Check FatSecret serving cache
    console.log("\n=== FATSECRET SCALLIONS ===");
    const fsFood = await prisma.fatSecretFoodCache.findFirst({
        where: { name: { contains: 'scallion', mode: 'insensitive' } }
    });

    if (fsFood) {
        console.log(`Food: ${fsFood.name} (ID: ${fsFood.id})`);

        const servings = await prisma.fatSecretServingCache.findMany({
            where: { foodId: fsFood.id }
        });

        console.log(`\nServings (${servings.length}):`);
        for (const s of servings) {
            console.log(`  ${s.servingDescription}: ${s.metricServingAmount}${s.metricServingUnit}`);
        }
    }

    await prisma.$disconnect();
}

main().catch(console.error);
