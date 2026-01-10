// Test volume serving selection for honey and mayonnaise
process.env.LOG_LEVEL = 'error';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: [] });

async function main() {
    // Dynamic import after LOG_LEVEL is set
    const { mapIngredientWithFallback } = await import('../lib/fatsecret/map-ingredient-with-fallback');

    console.log('=== TEST: Volume Serving Selection ===\n');

    // Test honey with cup
    console.log('Testing: "0.25 cup honey"');
    const honeyResult = await mapIngredientWithFallback('0.25 cup honey', {
        minConfidence: 0,
        skipFdc: true,
    });
    if (honeyResult) {
        console.log(`  Food: ${honeyResult.foodName}`);
        console.log(`  Grams: ${honeyResult.grams.toFixed(1)}g (expected: ~60-85g)`);
        console.log(`  Kcal: ${honeyResult.kcal.toFixed(0)}`);
        const isFixed = honeyResult.grams > 10;
        console.log(`  Status: ${isFixed ? 'FIXED ✅' : 'STILL BROKEN ❌'}\n`);
    } else {
        console.log('  No result!\n');
    }

    // Test mayo with cup
    console.log('Testing: "0.5 cup mayonnaise"');
    const mayoResult = await mapIngredientWithFallback('0.5 cup mayonnaise', {
        minConfidence: 0,
        skipFdc: true,
    });
    if (mayoResult) {
        console.log(`  Food: ${mayoResult.foodName}`);
        console.log(`  Grams: ${mayoResult.grams.toFixed(1)}g (expected: ~100-120g)`);
        console.log(`  Kcal: ${mayoResult.kcal.toFixed(0)}`);
        const isFixed = mayoResult.grams > 10;
        console.log(`  Status: ${isFixed ? 'FIXED ✅' : 'STILL BROKEN ❌'}\n`);
    } else {
        console.log('  No result!\n');
    }

    // Test sugar with tbsp
    console.log('Testing: "1 tbsp sugar"');
    const sugarResult = await mapIngredientWithFallback('1 tbsp sugar', {
        minConfidence: 0,
        skipFdc: true,
    });
    if (sugarResult) {
        console.log(`  Food: ${sugarResult.foodName}`);
        console.log(`  Grams: ${sugarResult.grams.toFixed(1)}g (expected: ~12g)`);
        console.log(`  Kcal: ${sugarResult.kcal.toFixed(0)}`);
        const isFixed = sugarResult.grams > 5;
        console.log(`  Status: ${isFixed ? 'FIXED ✅' : 'STILL BROKEN ❌'}\n`);
    } else {
        console.log('  No result!\n');
    }

    await prisma.$disconnect();
}

main().catch(console.error);
