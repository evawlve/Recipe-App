import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function investigate() {
    // Check what's in ValidatedMapping cache for onion/egg
    console.log('=== VALIDATED MAPPING CACHE ===');
    const mappings = await prisma.validatedMapping.findMany({
        where: {
            OR: [
                { normalizedForm: 'onion' },
                { normalizedForm: 'egg' },
                { normalizedForm: 'onions' },
            ]
        },
        take: 10,
        select: { rawIngredient: true, foodId: true, foodName: true, source: true }
    });

    for (const m of mappings) {
        console.log(`  "${m.rawIngredient}" -> ${m.foodName} (${m.foodId})`);
        console.log(`    Source: ${m.source}, foodId starts with 'fdc_': ${m.foodId.startsWith('fdc_')}`);
    }

    // Check what servings exist for these foods
    console.log('\n=== SERVING DATA FOR THESE FOODS ===');
    for (const m of mappings.slice(0, 3)) {
        const servings = await prisma.fatSecretServingCache.findMany({
            where: { foodId: m.foodId },
            select: { measurementDescription: true, servingWeightGrams: true, source: true }
        });
        console.log(`\nFood: ${m.foodName} (${m.foodId})`);
        if (servings.length === 0) {
            console.log('  ❌ NO SERVINGS IN CACHE');
        } else {
            for (const s of servings) {
                console.log(`  - ${s.measurementDescription}: ${s.servingWeightGrams}g (${s.source})`);
            }
        }
    }
}

investigate().finally(() => prisma.$disconnect());
