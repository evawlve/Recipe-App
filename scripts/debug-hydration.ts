/**
 * Debug serving hydration failure for unsweetened coconut milk
 */
import 'dotenv/config';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';
import { getCachedFoodWithRelations, cacheFoodToDetails } from '../src/lib/fatsecret/cache-search';
import { ensureFoodCached } from '../src/lib/fatsecret/cache';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { prisma } from '../src/lib/db';

async function debug() {
    const testCase = '1 cup unsweetened coconut milk';
    const client = new FatSecretClient();

    console.log('='.repeat(60));
    console.log(`DEBUG HYDRATION: "${testCase}"`);
    console.log('='.repeat(60));

    // Get the winning candidate
    const parsed = parseIngredientLine(testCase);
    const normalized = normalizeIngredientName(parsed?.name || testCase).cleaned;
    const candidates = await gatherCandidates(testCase, parsed, normalized);
    const { filtered } = filterCandidatesByTokens(candidates, normalized);

    // Simulate AI rerank - just take top scorer
    const winner = filtered.sort((a, b) => b.score - a.score)[0];
    console.log(`\n1. WINNER: ${winner.name} (id: ${winner.id}, source: ${winner.source})`);

    // Try cache lookup
    console.log('\n2. CACHE LOOKUP...');
    const cached = await getCachedFoodWithRelations(winner.id);
    console.log(`   Cache hit: ${cached ? 'YES' : 'NO'}`);

    if (cached) {
        console.log(`   Food name: ${cached.name}`);
        console.log(`   Servings count: ${cached.servings?.length || 0}`);
        if (cached.servings?.length) {
            console.log('   Servings:');
            for (const s of cached.servings.slice(0, 5)) {
                console.log(`     - ${s.measurementDescription}: ${s.servingWeightGrams}g`);
            }
        }

        // Convert to details
        const details = cacheFoodToDetails(cached);
        console.log(`\n3. CONVERTED DETAILS:`);
        console.log(`   Servings: ${details.servings?.length || 0}`);
        if (details.servings?.length) {
            for (const s of details.servings.slice(0, 5)) {
                console.log(`   - ${s.measurementDescription}: grams=${s.servingWeightGrams}, calories=${s.calories}`);
            }
        }
    } else {
        console.log('\n   Trying live API...');
        await ensureFoodCached(winner.id, { client });
        const refreshed = await getCachedFoodWithRelations(winner.id);
        if (refreshed) {
            console.log(`   Now cached with ${refreshed.servings?.length || 0} servings`);
        } else {
            console.log('   Still not in cache - trying direct API');
            const liveDetails = await client.getFoodDetails(winner.id);
            console.log(`   Live servings: ${liveDetails?.servings?.length || 0}`);
        }
    }

    await prisma.$disconnect();
}

debug().catch(console.error);
