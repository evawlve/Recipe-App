/**
 * Investigate data quality issues from walkthrough
 */

import { prisma } from '../src/lib/db';

async function main() {
    console.log('=== INVESTIGATING DATA QUALITY ISSUES ===\n');

    // 1. Green Onion (Freshii) - 0kcal
    console.log('--- GREEN ONION (FRESHII) ---');
    const freshiiGreenOnion = await prisma.fatSecretFoodCache.findFirst({
        where: {
            name: { contains: 'Green Onion', mode: 'insensitive' },
            brandName: { contains: 'Freshii', mode: 'insensitive' }
        },
        include: { servings: true }
    });
    if (freshiiGreenOnion) {
        console.log(`Food: ${freshiiGreenOnion.name} (${freshiiGreenOnion.brandName})`);
        console.log(`ID: ${freshiiGreenOnion.id}`);
        console.log(`Servings: ${freshiiGreenOnion.servings.length}`);
        // Check if there's a mapping pointing to this
        const mappings = await prisma.validatedMapping.findMany({
            where: { foodId: { contains: freshiiGreenOnion.id } }
        });
        console.log(`Mappings pointing to this: ${mappings.length}`);
        for (const m of mappings) {
            console.log(`  "${m.normalizedForm}" → ${m.foodName}`);
        }
    } else {
        console.log('Not found in cache');
    }

    // 2. Jalapeño (GOLCHIN) - macro mismatch
    console.log('\n--- JALAPEÑO (GOLCHIN) ---');
    const golchinJalapeno = await prisma.fatSecretFoodCache.findFirst({
        where: {
            name: { contains: 'Jalap', mode: 'insensitive' },
            brandName: { contains: 'GOLCHIN', mode: 'insensitive' }
        },
        include: { servings: { take: 1 } }
    });
    if (golchinJalapeno) {
        console.log(`Food: ${golchinJalapeno.name} (${golchinJalapeno.brandName})`);
        console.log(`ID: ${golchinJalapeno.id}`);
        if (golchinJalapeno.servings[0]) {
            const s = golchinJalapeno.servings[0];
            console.log(`Serving: calories=${s.calories}, carbs=${s.carbohydrate}, protein=${s.protein}, fat=${s.fat}`);
            const expectedCal = ((s.carbohydrate || 0) * 4) + ((s.protein || 0) * 4) + ((s.fat || 0) * 9);
            console.log(`Expected calories from macros: ${expectedCal.toFixed(0)}`);
        }
    } else {
        console.log('Not found in cache');
    }

    // 3. Red Pepper Flakes - check what high-cal entries exist
    console.log('\n--- RED PEPPER FLAKES ---');
    const pepperFlakes = await prisma.fatSecretFoodCache.findMany({
        where: {
            name: { contains: 'Red Pepper Flakes', mode: 'insensitive' }
        },
        include: { servings: { take: 1 } },
        take: 5
    });
    for (const f of pepperFlakes) {
        const s = f.servings[0];
        if (s) {
            const calPer100g = s.servingWeightGrams ? (s.calories || 0) / s.servingWeightGrams * 100 : 0;
            console.log(`${f.name} (${f.brandName || 'generic'}): ${calPer100g.toFixed(0)} kcal/100g`);
        }
    }

    // Check validated mappings for pepper flakes
    const pfMappings = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'pepper flakes', mode: 'insensitive' } }
    });
    console.log(`Mappings for "pepper flakes": ${pfMappings.length}`);
    for (const m of pfMappings) {
        console.log(`  "${m.normalizedForm}" → ${m.foodName} (${m.foodId})`);
    }

    // 4. Rice Vinegar - check mappings
    console.log('\n--- RICE VINEGAR ---');
    const riceVinegarMappings = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'rice vinegar', mode: 'insensitive' } }
    });
    console.log(`Mappings for "rice vinegar": ${riceVinegarMappings.length}`);
    for (const m of riceVinegarMappings) {
        console.log(`  "${m.normalizedForm}" → ${m.foodName} (${m.foodId})`);
    }

    // 5. Palm Sugar - check mappings  
    console.log('\n--- PALM SUGAR ---');
    const palmSugarMappings = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'palm sugar', mode: 'insensitive' } }
    });
    console.log(`Mappings for "palm sugar": ${palmSugarMappings.length}`);
    for (const m of palmSugarMappings) {
        console.log(`  "${m.normalizedForm}" → ${m.foodName} (${m.foodId})`);
    }

    // 6. Fat Free Egg Substitute
    console.log('\n--- FAT FREE EGG SUBSTITUTE ---');
    const eggSubMappings = await prisma.validatedMapping.findMany({
        where: {
            OR: [
                { normalizedForm: { contains: 'egg substitute', mode: 'insensitive' } },
                { normalizedForm: { contains: 'egg replacer', mode: 'insensitive' } }
            ]
        }
    });
    console.log(`Mappings for egg substitute: ${eggSubMappings.length}`);
    for (const m of eggSubMappings) {
        console.log(`  "${m.normalizedForm}" → ${m.foodName}`);
    }

    await prisma.$disconnect();
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
