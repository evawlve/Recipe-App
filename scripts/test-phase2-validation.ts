import 'dotenv/config';
import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';
import { prisma } from '../src/lib/db';

async function main() {
    const testIngredients = [
        '1 cup unsweetened coconut milk',  // Was rejected for "too high fat"
        '44 g fancy low-moisture part-skim mozzarella cheese',  // Rejected at 20g (edge of 15-20g)
        '2 tbsps cream cheese',  // Rejected for "fat too high"
        '1 egg',  // Mapped to egg whites instead of whole egg
    ];

    console.log('\n🔍 Testing Phase 2: AI Validation Improvements\n');

    for (const ingredient of testIngredients) {
        console.log(`\nTesting: "${ingredient}"`);
        try {
            const result = await mapIngredientWithFatsecret(ingredient, {
                allowLiveFallback: true,
                cacheMode: 'primary',
            });

            if (result) {
                const icon = result.aiValidation?.approved ? '✅' : '❌';
                console.log(`${icon} ${result.foodName}`);
                if (result.aiValidation) {
                    console.log(`   AI: ${result.aiValidation.approved ? 'APPROVED' : 'REJECTED'} - ${result.aiValidation.reason}`);
                }
            } else {
                console.log('❌ No mapping found');
            }
        } catch (error) {
            console.error('Error:', error);
        }
    }

    await prisma.$disconnect();
}

main().catch(console.error);
