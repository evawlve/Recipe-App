import { parseIngredientLine } from './src/lib/parse/ingredient-line';
// @ts-ignore
const fdcMap = require('./src/lib/fatsecret/map-ingredient-with-fallback');

async function test() {
    const rawLine = "2 large eggs";
    const parsed = parseIngredientLine(rawLine);
    
    const { prisma } = await import('./src/lib/db');
    
    // Simulating what early cache does
    const fdcIdStr = 'fdc_170931';
    const fdcId = 170931;

    const cachedFdc = await prisma.fdcFoodCache.findUnique({
        where: { id: fdcId },
        select: { nutrients: true }
    });

    const candidate: any = {
        id: fdcIdStr,
        name: "EGGS",
        source: 'cache',
        score: 1.0,
        foodType: 'generic',
        rawData: {},
        nutrition: cachedFdc?.nutrients
    };

    console.log("Candidate nutrition:", candidate.nutrition);

    try {
        // Since buildFdcResult is private, we can't easily call it directly if not exported.
        // Wait, map-ingredient.ts has hydrateAndSelectServing! I can call it.
        const { FatSecretClient } = await import('./src/lib/fatsecret/client');
        const hydratedResult = await fdcMap.hydrateAndSelectServing(
            candidate,
            parsed,
            1.0,
            rawLine,
            new FatSecretClient()
        );
        console.log("Hydrated Result:", hydratedResult);
    } catch (e: any) {
        console.error("Error:", e);
    }
}

test().catch(console.error).finally(()=>process.exit(0));
