
import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { getCachedFoodWithRelations, cacheFoodToDetails } from '../src/lib/fatsecret/cache-search';

async function main() {
    console.log(`\nMapping: "0.25 cup fat free milk"\n`);

    // 1. Run full mapping to confirm failure/logs
    try {
        const result = await mapIngredientWithFallback("0.25 cup fat free milk");
        console.log('Main Result:', result ? 'SUCCESS' : 'FAILED');
    } catch (e) {
        console.error('Error during mapping:', e);
    }

    // 2. Inspect candidates and servings manually
    const client = new FatSecretClient();
    const candidates = await gatherCandidates("0.25 cup fat free milk", {
        qty: 0.25, unit: 'cup', ingredient: 'fat free milk'
    } as any, 'fat free milk', { client });

    console.log('\nTop Candidates:');
    for (const c of candidates.slice(0, 5)) {
        console.log(`- [${c.id}] ${c.name} (${c.brandName})`);

        // Fetch servings from DB or API
        // We can use client to get food specifics if it's FS
        if (c.source === 'fatsecret') {
            const details = await client.getFood(c.id);
            console.log(`  Servings:`);
            if (details && details.servings && details.servings.length > 0) {
                details.servings.forEach((s: any) => {
                    console.log(`    - ${s.description} (${s.metricServingAmount} ${s.metricServingUnit}) id:${s.id}`);
                    console.log(`      kcal:${s.calories} p:${s.protein} c:${s.carbohydrate} f:${s.fat}`);
                });
            } else {
                console.log('    (No servings found)');
            }

            // Check cache
            const cached = await getCachedFoodWithRelations(c.id);
            if (cached) {
                console.log(`    [CACHE] Found in cache! Servings: ${cached.servings.length}`);
                cached.servings.forEach(s => {
                    console.log(`      [C] ${s.description} (${s.metricServingAmount} ${s.metricServingUnit})`);
                });
            } else {
                console.log(`    [CACHE] Not in cache.`);
            }
        }
    }
}

main().finally(() => prisma.$disconnect());
