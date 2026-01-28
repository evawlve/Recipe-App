/**
 * Fix bad scallion 150g serving
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // Find the bad serving entry
    const fdcFood = await prisma.fdcFoodCache.findFirst({
        where: { description: { contains: 'scallion', mode: 'insensitive' } }
    });

    if (!fdcFood) {
        console.log("No FDC scallion food found");
        return;
    }

    console.log(`Found: ${fdcFood.description} (ID: ${fdcFood.id})`);

    const servings = await prisma.fdcServingCache.findMany({
        where: { fdcId: fdcFood.id }
    });

    console.log("\nCurrent servings:");
    for (const s of servings) {
        console.log(`  ID: ${s.id}, Desc: "${s.description}", Grams: ${s.grams}, Source: ${s.source}`);
    }

    // Delete the bad 150g serving if it exists
    const badServing = servings.find(s => s.grams === 150 && (!s.description || s.description === 'undefined'));
    if (badServing) {
        console.log(`\n❌ Deleting bad serving: ${badServing.id} (150g)`);
        await prisma.fdcServingCache.delete({ where: { id: badServing.id } });
    }

    // Create correct serving sizes for scallions (based on USDA data)
    // Small scallion: ~12g, Medium: ~15g, Large: ~18g
    const correctServings = [
        { description: 'small', grams: 12, source: 'manual_fix' },
        { description: 'medium', grams: 15, source: 'manual_fix' },
        { description: 'large', grams: 18, source: 'manual_fix' },
        { description: '1 scallion', grams: 15, source: 'manual_fix' },
    ];

    for (const serving of correctServings) {
        const exists = await prisma.fdcServingCache.findFirst({
            where: { fdcId: fdcFood.id, description: serving.description }
        });

        if (!exists) {
            console.log(`✅ Adding: ${serving.description} = ${serving.grams}g`);
            await prisma.fdcServingCache.create({
                data: {
                    fdcId: fdcFood.id,
                    description: serving.description,
                    grams: serving.grams,
                    source: serving.source,
                    isAiEstimated: false
                }
            });
        }
    }

    console.log("\n✅ Done");
    await prisma.$disconnect();
}

main().catch(console.error);
