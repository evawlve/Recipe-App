import 'dotenv/config';
import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';
import { initMappingAnalysisSession, finalizeMappingAnalysisSession } from '../src/lib/fatsecret/mapping-logger';
import { prisma } from '../src/lib/db';

async function main() {
    // Start analysis session
    initMappingAnalysisSession();

    const testIngredients = [
        '1 tsp lemon zest',  // Known issue: maps to protein bar
    ];

    console.log('\n🔍 Testing Phase 1: Nutrition Data in Logger\n');

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
