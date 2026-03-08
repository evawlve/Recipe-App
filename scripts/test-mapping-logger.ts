import 'dotenv/config';
import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';
import { initMappingAnalysisSession, finalizeMappingAnalysisSession } from '../src/lib/fatsecret/mapping-logger';
import { prisma } from '../src/lib/db';

async function main() {
    // Start analysis session
    initMappingAnalysisSession();

    const testIngredients = [
        '0.5 cup almond flour',
        '1 medium squash',
        '2 tablespoons olive oil',
    ];

    console.log('\n🔍 Testing Mapping Analysis Logger\n');

    for (const ingredient of testIngredients) {
        console.log(`\nTesting: "${ingredient}"`);
        try {
            const result = await mapIngredientWithFatsecret(ingredient, {
                allowLiveFallback: true,
                cacheMode: 'primary',
            });

            if (!result) {
                console.log('❌ No mapping found');
            }
        } catch (error) {
            console.error('Error:', error);
        }
    }

    // Finalize session
    finalizeMappingAnalysisSession();

    await prisma.$disconnect();
}

main().catch(console.error);
