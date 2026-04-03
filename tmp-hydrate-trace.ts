import { parseIngredientLine } from './src/lib/parse/ingredient-line';
import { FatSecretClient } from './src/lib/fatsecret/client';
// @ts-ignore
import { hydrateAndSelectServing } from './src/lib/fatsecret/map-ingredient-with-fallback';

async function trace() {
    const client = new FatSecretClient();
    
    // Simulating early cache hit for "2 large eggs" which maps to "EGGS" (foodId: "6798")
    // Note: To find out actual foodId of EGGS we can query ValidatedMapping but we know it from typical fs db
    // Let's query ValidatedMapping first to get EXACT values
    const { prisma } = await import('./src/lib/db');
    const earlyCacheHit = await prisma.validatedMapping.findFirst({
        where: { normalizedForm: "eggs", source: "fatsecret" }
    });
    
    if (!earlyCacheHit) {
        console.error("No cache hit found for 'eggs'");
        return;
    }

    const rawLine = "2 large eggs";
    const parsed = parseIngredientLine(rawLine);
    
    const cachedCandidate: any = {
        id: earlyCacheHit.foodId,
        name: earlyCacheHit.foodName,
        brandName: earlyCacheHit.brandName || undefined,
        source: 'cache',
        score: earlyCacheHit.aiConfidence,
        foodType: 'generic',
        rawData: {},
    };

    console.log("Calling hydrateAndSelectServing with:", JSON.stringify(cachedCandidate));
    
    try {
        const hydratedResult = await hydrateAndSelectServing(
            cachedCandidate,
            parsed,
            earlyCacheHit.aiConfidence,
            rawLine,
            client
        );
        console.log("Hydrated Result:", JSON.stringify(hydratedResult, null, 2));
    } catch (e: any) {
        console.error("Hydration threw error:", e.message);
    }
}

trace().catch(console.error).finally(()=>process.exit(0));
