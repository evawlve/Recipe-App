/**
 * Investigate and fix black olives serving cache
 */
import { prisma } from '../src/lib/db';

async function main() {
    const OLIVE_FOOD_ID = '6809';

    console.log('=== BLACK OLIVES (ID: 6809) SERVING INVESTIGATION ===\n');

    // Get food details
    const food = await prisma.fatSecretFoodCache.findUnique({
        where: { id: OLIVE_FOOD_ID },
        include: { servings: true }
    });

    if (!food) {
        console.log('Food not found!');
        return;
    }

    console.log(`Food: ${food.name}`);
    console.log(`Brand: ${food.brandName || 'Generic'}`);
    console.log(`\nServings (${food.servings.length} total):`);

    for (const s of food.servings) {
        const isAi = s.source !== 'fatsecret';
        const marker = isAi ? '⚠️ AI' : '✓ API';
        console.log(`  ${marker} "${s.measurementDescription}": ${s.servingWeightGrams}g [source: ${s.source}]`);
        if (s.note) {
            console.log(`      Note: ${s.note.substring(0, 100)}...`);
        }
    }

    // Find problematic AI-estimated size servings
    console.log('\n--- CHECKING FOR PROBLEMATIC SIZE SERVINGS ---');
    const sizeServings = food.servings.filter(s =>
        ['small', 'medium', 'large'].includes(s.measurementDescription?.toLowerCase() || '')
    );

    if (sizeServings.length === 0) {
        console.log('No size qualifier servings found.');
    } else {
        for (const s of sizeServings) {
            const grams = s.servingWeightGrams || 0;
            // A single olive should be 3-8g. Size qualifiers for olives should be per-olive, not per-container
            const isReasonable = grams >= 2 && grams <= 15;
            const status = isReasonable ? '✓ OK' : '❌ WRONG';
            console.log(`  ${status} "${s.measurementDescription}": ${grams}g (expected: 3-8g per olive)`);

            if (!isReasonable && s.source !== 'fatsecret') {
                console.log(`    → Will delete this entry (ID: ${s.id})`);
            }
        }
    }

    await prisma.$disconnect();
}

main().catch(console.error);
