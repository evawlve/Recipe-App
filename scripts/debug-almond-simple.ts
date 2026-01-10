import 'dotenv/config';
import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('\n🔍 Simple Almond Flour Debug\n');
    console.log('Testing: "0.5 cup almond flour"\n');

    const result = await mapIngredientWithFatsecret('0.5 cup almond flour', {
        minConfidence: 0.3,
        allowLiveFallback: true,  // CRITICAL: Enable live fallback for AI backfill
        debug: true,
    });

    console.log('\n📊 RESULT:');
    if (result) {
        console.log(`✅ Mapped to: ${result.foodName}`);
        console.log(`   Brand: ${result.brandName || 'N/A'}`);
        console.log(`   Confidence: ${result.confidence.toFixed(3)}`);
        console.log(`   Grams: ${result.grams}g`);
        console.log(`   Macros: ${result.protein}p / ${result.carbs}c / ${result.fat}f`);

        if (result.aiValidation) {
            console.log(`\n   AI Validation:`);
            console.log(`   - Approved: ${result.aiValidation.approved}`);
            console.log(`   - Confidence: ${result.aiValidation.confidence}`);
            console.log(`   - Category: ${result.aiValidation.category}`);
            console.log(`   - Issues: ${result.aiValidation.detectedIssues?.join(', ') || 'none'}`);
        }
    } else {
        console.log('❌ No mapping found');
    }

    await prisma.$disconnect();
}

main().catch(console.error);
