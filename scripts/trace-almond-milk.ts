import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function traceAlmondMilk() {
    console.log('=== TRACING ALMOND MILK FALSE POSITIVE ===\n');

    // Check the validated mapping cache
    console.log('1. Checking ValidatedMapping cache...');
    const mapping = await prisma.validatedMapping.findFirst({
        where: { rawIngredient: { contains: 'almond milk', mode: 'insensitive' } },
    });

    if (mapping) {
        console.log(`   Found: "${mapping.rawIngredient}" → ${mapping.foodName} (${mapping.foodId})`);
        console.log(`   Confidence: ${mapping.aiConfidence}`);
        console.log(`   Created: ${mapping.createdAt}`);
    } else {
        console.log('   No cached mapping found');
    }

    // Check what almond milk foods are in the FatSecretFoodCache
    console.log('\n2. Searching FatSecretFoodCache for "almond milk"...');
    const cached = await prisma.fatSecretFoodCache.findMany({
        where: {
            OR: [
                { name: { contains: 'almond milk', mode: 'insensitive' } },
                { name: { contains: 'almond', mode: 'insensitive' } },
            ]
        },
        select: { id: true, name: true, source: true, foodType: true },
        take: 20,
    });

    console.log(`   Found ${cached.length} results:`);
    for (const f of cached) {
        console.log(`   - [${f.id}] ${f.name} (${f.source}, ${f.foodType})`);
    }

    // The chocolate candy that got matched
    console.log('\n3. Checking the matched candy...');
    const candy = await prisma.fatSecretFoodCache.findUnique({
        where: { id: 'fdc_168754' },
        select: { id: true, name: true, description: true, foodType: true, source: true },
    });

    if (candy) {
        console.log(`   Name: ${candy.name}`);
        console.log(`   Type: ${candy.foodType}`);
        console.log(`   Description: ${candy.description?.substring(0, 100)}...`);
    }
}

traceAlmondMilk().finally(() => prisma.$disconnect());
