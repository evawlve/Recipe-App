import { prisma } from '../src/lib/db';

async function main() {
    // First, find the validated mappings for our problem ingredients
    console.log('=== VALIDATED MAPPINGS ===\n');

    const mappings = await prisma.validatedMapping.findMany({
        where: {
            OR: [
                { normalizedForm: { contains: 'olive' } },
                { normalizedForm: { contains: 'yeast' } },
                { normalizedForm: { contains: 'pepper' } },
            ]
        }
    });

    mappings.forEach(m => {
        console.log(`${m.normalizedForm} → foodId: ${m.foodId}, source: ${m.source}`);
    });

    // Get the specific food IDs from mappings
    const foodIds = mappings.map(m => m.foodId);

    console.log('\n=== FATSECRET SERVING CACHE ===\n');

    // Check FatSecret servings
    const fsServings = await prisma.fatSecretServingCache.findMany({
        where: { foodId: { in: foodIds.filter(id => !id.startsWith('fdc_')) } }
    });

    fsServings.forEach(s => {
        console.log(JSON.stringify({
            id: s.id,
            foodId: s.foodId,
            desc: s.measurementDescription,
            grams: s.servingWeightGrams,
            isAi: s.isAiEstimated,
            source: s.source
        }, null, 2));
    });

    console.log('\n=== FDC SERVING CACHE ===\n');

    // Check FDC servings (extract numeric IDs)
    const fdcIds = foodIds
        .filter(id => id.startsWith('fdc_'))
        .map(id => parseInt(id.replace('fdc_', '')));

    if (fdcIds.length > 0) {
        const fdcServings = await prisma.fdcServingCache.findMany({
            where: { fdcId: { in: fdcIds } }
        });

        fdcServings.forEach(s => {
            console.log(JSON.stringify({
                id: s.id,
                fdcId: s.fdcId,
                desc: s.measurementDescription,
                grams: s.servingWeightGrams,
                isAi: s.isAiEstimated
            }, null, 2));
        });
    }

    // Also search by food name directly in food cache
    console.log('\n=== SEARCHING FOOD CACHES BY NAME ===\n');

    const oliveFoods = await prisma.fatSecretFoodCache.findMany({
        where: {
            foodName: {
                contains: 'Olive'
            }
        },
        take: 10
    });

    console.log('Olive foods found:');
    oliveFoods.forEach(f => console.log(`  ${f.foodId}: ${f.foodName}`));

    // Get servings for black olives specifically
    console.log('\n=== BLACK OLIVES DETAILED SERVINGS ===\n');

    for (const food of oliveFoods.filter(f => f.foodName.toLowerCase().includes('black'))) {
        const servings = await prisma.fatSecretServingCache.findMany({
            where: { foodId: food.foodId }
        });
        console.log(`\n${food.foodName} (${food.foodId}):`);
        servings.forEach(s => {
            console.log(`  ${s.measurementDescription}: ${s.servingWeightGrams}g ${s.isAiEstimated ? '[AI]' : '[API]'} (id: ${s.id})`);
        });
    }

    // Check for yeast
    console.log('\n=== YEAST FOOD SEARCH ===\n');

    const yeastFoods = await prisma.fatSecretFoodCache.findMany({
        where: {
            foodName: {
                contains: 'Yeast'
            }
        },
        take: 10
    });

    console.log('Yeast foods found:');
    yeastFoods.forEach(f => console.log(`  ${f.foodId}: ${f.foodName}`));

    for (const food of yeastFoods) {
        const servings = await prisma.fatSecretServingCache.findMany({
            where: { foodId: food.foodId }
        });
        console.log(`\n${food.foodName} (${food.foodId}):`);
        servings.forEach(s => {
            console.log(`  ${s.measurementDescription}: ${s.servingWeightGrams}g ${s.isAiEstimated ? '[AI]' : '[API]'} (id: ${s.id})`);
        });
    }

    // Check for red peppers
    console.log('\n=== RED PEPPERS FOOD SEARCH ===\n');

    const pepperFoods = await prisma.fatSecretFoodCache.findMany({
        where: {
            foodName: {
                contains: 'Red Pepper'
            }
        },
        take: 10
    });

    console.log('Red Pepper foods found:');
    pepperFoods.forEach(f => console.log(`  ${f.foodId}: ${f.foodName}`));

    for (const food of pepperFoods) {
        const servings = await prisma.fatSecretServingCache.findMany({
            where: { foodId: food.foodId }
        });
        console.log(`\n${food.foodName} (${food.foodId}):`);
        servings.forEach(s => {
            console.log(`  ${s.measurementDescription}: ${s.servingWeightGrams}g ${s.isAiEstimated ? '[AI]' : '[API]'} (id: ${s.id})`);
        });
    }

    // Also check FDC cache for these items
    console.log('\n=== FDC FOOD SEARCH ===\n');

    const fdcOlives = await prisma.fdcFoodCache.findMany({
        where: {
            description: {
                contains: 'olive'
            }
        },
        take: 5
    });

    console.log('FDC Olive foods found:');
    fdcOlives.forEach(f => console.log(`  fdc_${f.fdcId}: ${f.description}`));

    for (const food of fdcOlives) {
        const servings = await prisma.fdcServingCache.findMany({
            where: { fdcId: food.fdcId }
        });
        console.log(`\n${food.description} (fdc_${food.fdcId}):`);
        servings.forEach(s => {
            console.log(`  ${s.measurementDescription}: ${s.servingWeightGrams}g ${s.isAiEstimated ? '[AI]' : '[API]'} (id: ${s.id})`);
        });
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
