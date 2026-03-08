import { prisma } from '../src/lib/db';
import { insertAiServing } from '../src/lib/fatsecret/ai-backfill';

async function main() {
    console.log('=== Detailed FDC AI Backfill Test ===\n');

    // Get FDC food details
    const food = await prisma.fdcFoodCache.findUnique({
        where: { id: 2397407 },
        include: { servings: true }
    });

    if (!food) {
        console.log('Food not found!');
        return;
    }

    console.log('Food:', food.description);
    console.log('Data type:', food.dataType);
    console.log('Nutrients:', JSON.stringify(food.nutrients, null, 2));
    console.log('Existing servings:', food.servings.length);
    for (const s of food.servings) {
        console.log(`  - ${s.description}: ${s.grams}g [AI: ${s.isAiEstimated}]`);
    }

    // Run backfill with debug
    console.log('\n--- Running Backfill with Debug ---');
    const result = await insertAiServing('fdc_2397407', 'volume', {
        promptDebug: true,
        targetServingUnit: 'cup',
    });

    console.log('\n--- Result ---');
    console.log('Success:', result.success);
    console.log('Reason:', result.reason || 'N/A');
}

main()
    .catch(e => console.error('Error:', e))
    .finally(() => prisma.$disconnect());
