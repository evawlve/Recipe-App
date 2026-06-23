import 'dotenv/config';
import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('\n🔍 Squash Count-Based Test\n');
    console.log('Testing: "1 medium squash"\n');

    try {
        const result = await mapIngredientWithFatsecret('1 medium squash', {
            allowLiveFallback: true,
            cacheMode: 'primary',
        });

        console.log('\n📊 RESULT:');
        if (result) {
            console.log(`✅ Mapped to: ${result.foodName}`);
            if (result.brandName) console.log(`   Brand: ${result.brandName}`);
            console.log(`   Confidence: ${result.confidence}`);
            console.log(`   Grams: ${result.grams}g`);
            console.log(`   Macros: ${result.protein}p / ${result.carbs}c / ${result.fat}f`);

            if (result.aiValidation) {
                console.log('\n   AI Validation:');
                console.log(`   - Approved: ${result.aiValidation.approved}`);
                console.log(`   - Confidence: ${result.aiValidation.confidence}`);
                console.log(`   - Category: ${result.aiValidation.category}`);
                console.log(`   - Issues: ${result.aiValidation.detectedIssues?.join(', ') || 'none'}`);
                if (result.aiValidation.reason) {
                    console.log(`   - Reason: ${result.aiValidation.reason}`);
                }
            }
        } else {
            console.log('❌ No mapping found');
        }
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(console.error);
