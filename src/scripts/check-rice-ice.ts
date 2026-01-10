// Check Rice (Sarita) and FDC ice candidates
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: [] });

async function main() {
    // Check Rice (Sarita) specifically
    console.log('=== RICE (SARITA) ===');
    const rice = await prisma.fatSecretFoodCache.findFirst({
        where: {
            OR: [
                { name: { contains: 'Sarita', mode: 'insensitive' } },
                { brandName: { contains: 'Sarita', mode: 'insensitive' } },
            ]
        },
        include: { servings: true },
    });
    if (rice) {
        console.log(`Found: ${rice.name} (ID: ${rice.id}, brand: ${rice.brandName})`);
        console.log(`Serving count: ${rice.servings.length}`);
        for (const s of rice.servings.slice(0, 3)) {
            console.log(`  "${s.measurementDescription}" = ${s.servingWeightGrams ?? s.metricServingAmount}g`);
        }
    } else {
        console.log('No Sarita rice found in FatSecret cache');
    }

    // Check FDC for ice
    console.log('\n=== FDC ICE CANDIDATES ===');
    const fdcIce = await prisma.fdcFoodCache.findMany({
        where: {
            description: { contains: 'ice', mode: 'insensitive' },
            NOT: { description: { contains: 'rice', mode: 'insensitive' } },
        },
        take: 10,
        select: { fdcId: true, description: true },
    });
    if (fdcIce.length === 0) {
        console.log('No FDC ice foods found');
    } else {
        for (const f of fdcIce) {
            console.log(`FDC-${f.fdcId}: ${f.description}`);
        }
    }

    // Check what Food was actually selected for "crushed ice" in recent imports
    console.log('\n=== RECENT "ice" INGREDIENT MAPPINGS ===');
    const iceMappings = await prisma.ingredientFoodMap.findMany({
        where: {
            ingredient: {
                name: { contains: 'ice', mode: 'insensitive' },
                NOT: { name: { contains: 'rice', mode: 'insensitive' } },
            },
        },
        include: {
            ingredient: { select: { name: true } },
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
    });
    for (const m of iceMappings) {
        console.log(`"${m.ingredient.name}" -> foodId: ${m.fatsecretFoodId}, source: ${m.fatsecretSource}`);
    }

    await prisma.$disconnect();
}

main().catch(console.error);
