import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { applyCleanupPatterns } from '../src/lib/ingredients/cleanup';
import { refreshNormalizationRules } from '../src/lib/fatsecret/normalization-rules';

const TEST_CASES = [
    "1 scoop vanilla whey protein",
    "1 jalapeño pepper",
    "Palm Sugar",
    "0.5 floz rice vinegar 2 tbsp"
];

async function main() {
    console.log("Refreshing normalization rules...");
    await refreshNormalizationRules();

    console.log("\nClearing cache for test cases...");
    for (const rawLine of TEST_CASES) {
        await prisma.validatedMapping.deleteMany({
            where: { rawIngredient: rawLine }
        });
    }

    console.log("\nStarting Tests...");
    for (const line of TEST_CASES) {
        console.log(`\nTesting: "${line}"`);
        const cleanupResult = await applyCleanupPatterns(line);
        console.log(`  Cleaned: "${cleanupResult.cleaned}"`);

        const result = await mapIngredientWithFallback(cleanupResult.cleaned, {
            skipAiValidation: true,
            minConfidence: 0.5
        });

        if (!result) {
            console.log(`  ❌ FAILED to map entirely.`);
        } else if ('foodId' in result) {
            console.log(`  ✅ MAPPED [${result.confidence.toFixed(2)}] -> ${result.foodName} (${result.foodId})`);
            console.log(`     Serving: ${result.grams}g (${result.servingDescription || 'No description'})`);
            console.log(`     Macros: ${result.kcal} kcal | P: ${result.protein}g | C: ${result.carbs}g | F: ${result.fat}g`);
        } else {
            console.log(`  ⚠️ PENDING (Locked)`);
        }
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
