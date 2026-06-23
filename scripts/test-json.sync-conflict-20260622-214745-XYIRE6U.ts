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
    await refreshNormalizationRules();

    for (const rawLine of TEST_CASES) {
        await prisma.validatedMapping.deleteMany({
            where: { rawIngredient: rawLine }
        });
    }

    const out = [];
    for (const line of TEST_CASES) {
        const cleanupResult = await applyCleanupPatterns(line);
        const result = await mapIngredientWithFallback(cleanupResult.cleaned, {
            skipAiValidation: true,
            minConfidence: 0.5
        });

        if (result && 'foodId' in result) {
            out.push({
                test: line,
                food: result.foodName,
                grams: result.grams,
                kcal: result.kcal
            });
        }
    }
    console.log("===JSON_START===");
    console.log(JSON.stringify(out, null, 2));
    console.log("===JSON_END===");
}

main().catch(console.error).finally(() => prisma.$disconnect());
