import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { FatSecretClient } from '../src/lib/fatsecret/client';

// Check the serving selection for FDC foods
async function debugServing() {
    const { hydrateAndSelectServing } = await import('../src/lib/fatsecret/map-ingredient-with-fallback');

    const client = new FatSecretClient();

    // The FDC onion that was failing
    const rawLine = '1 medium onion';
    const parsed = parseIngredientLine(rawLine);

    console.log('=== TESTING SERVING SELECTION ===');
    console.log('Raw:', rawLine);
    console.log('Parsed:', parsed);

    // Create a synthetic winner from the cached FDC food
    const winner = {
        id: 'fdc_2438059',
        name: 'ONION',
        source: 'cache' as const,
        score: 0.98,
        foodType: 'generic',
        rawData: {},
    };

    console.log('\nTrying hydrateAndSelectServing with FDC winner...');
    const result = await hydrateAndSelectServing(winner as any, parsed, 0.98, rawLine, client);

    if (result) {
        console.log('✅ SUCCESS');
        console.log('  Serving:', result.servingDescription);
        console.log('  Grams:', result.servingGrams);
    } else {
        console.log('❌ FAILED - returned null');

        // Check what servings are available
        const servings = await prisma.fatSecretServingCache.findMany({
            where: { foodId: 'fdc_2438059' },
            select: { measurementDescription: true, servingWeightGrams: true }
        });
        console.log('\nAvailable servings:');
        for (const s of servings) {
            console.log(`  - ${s.measurementDescription}: ${s.servingWeightGrams}g`);
        }
    }
}

debugServing().finally(() => prisma.$disconnect());
