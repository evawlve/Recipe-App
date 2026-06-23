/**
 * Debug beef franks serving selection
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const foodId = '90452'; // Beef Franks (Vienna Beef)

    console.log('=== Beef Franks Serving Analysis ===\n');

    const servings = await prisma.fatSecretServingCache.findMany({
        where: { foodId }
    });

    console.log(`Found ${servings.length} servings:\n`);

    for (const s of servings) {
        console.log(`  "${s.measurementDescription}"`);
        console.log(`    grams: ${s.servingWeightGrams}`);
        console.log(`    numberOfUnits: ${s.numberOfUnits}`);
        console.log(`    isDefault: ${s.isDefault}`);
        console.log('');
    }

    // The expected result for "2 beef franks" should be:
    // - Find a serving that represents 1 frank (~45g)
    // - Multiply by qty 2 = ~90g
    // - NOT use a "medium" serving of 280g

    const frankServing = servings.find(s =>
        (s.measurementDescription || '').toLowerCase().includes('frank') ||
        (s.measurementDescription || '').toLowerCase().includes('link')
    );

    if (frankServing) {
        console.log('✅ Found frank/link serving:');
        console.log(`   ${frankServing.measurementDescription}: ${frankServing.servingWeightGrams}g`);
        console.log(`   For "2 beef franks" should be: ${(frankServing.servingWeightGrams || 0) * 2}g`);
    } else {
        console.log('❌ No frank/link serving found');
        console.log('   System is falling back to "medium" which is semantically wrong');
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
