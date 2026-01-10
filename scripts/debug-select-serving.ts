import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { getCachedFoodWithRelations, cacheFoodToDetails } from '../src/lib/fatsecret/cache-search';

// Copy the selectServing function and add logging
function selectServingWithDebug(
    parsed: any,
    servings: any[]
) {
    if (!servings.length) {
        console.log('  No servings provided');
        return null;
    }

    const unit = parsed?.unit?.toLowerCase() ?? null;
    console.log(`  Parsed unit: ${unit}`);

    const unitMappings: Record<string, string[]> = {
        'cup': ['cup', 'c', 'cups'],
        'tbsp': ['tbsp', 'tablespoon', 'tablespoons', 'tbs'],
        'tsp': ['tsp', 'teaspoon', 'teaspoons'],
        'oz': ['oz', 'ounce', 'ounces'],
        'g': ['g', 'gram', 'grams'],
        'ml': ['ml', 'milliliter', 'milliliters'],
    };

    const volumeToMl: Record<string, number> = {
        'ml': 1, 'tsp': 5, 'tbsp': 15, 'cup': 240, 'c': 240, 'floz': 30,
    };

    const getUnitAliases = (u: string | null): string[] => {
        if (!u) return [];
        const lower = u.toLowerCase();
        for (const [key, aliases] of Object.entries(unitMappings)) {
            if (key === lower || aliases.includes(lower)) {
                return [key, ...aliases];
            }
        }
        return [lower];
    };

    const getCanonicalVolumeUnit = (u: string | null): string | null => {
        if (!u) return null;
        const lower = u.toLowerCase();
        for (const [key, aliases] of Object.entries(unitMappings)) {
            if ((key === lower || aliases.includes(lower)) && volumeToMl[key]) {
                return key;
            }
        }
        return volumeToMl[lower] ? lower : null;
    };

    const extractServingVolumeUnit = (description: string): { unit: string; amount: number } | null => {
        const desc = description.toLowerCase();
        const match = desc.match(/(\d+(?:\.\d+)?)\s*(cup|cups|c|tbsp|tablespoon|tablespoons|tbs|tsp|teaspoon|teaspoons|ml|floz)/i);
        if (match) {
            const amount = parseFloat(match[1]);
            const rawUnit = match[2].toLowerCase();
            const canonical = getCanonicalVolumeUnit(rawUnit);
            if (canonical) {
                return { unit: canonical, amount };
            }
        }
        return null;
    };

    const gramsForServing = (serving: any): number | null => {
        if (serving.servingWeightGrams && serving.servingWeightGrams > 0) {
            return serving.servingWeightGrams;
        }
        if (serving.metricServingUnit?.toLowerCase() === 'g' && serving.metricServingAmount) {
            return serving.metricServingAmount;
        }
        if (serving.metricServingUnit?.toLowerCase() === 'ml' && serving.metricServingAmount) {
            return serving.metricServingAmount;
        }
        return null;
    };

    const unitAliases = getUnitAliases(unit);
    const requestedVolumeUnit = getCanonicalVolumeUnit(unit);

    console.log(`  Unit aliases: [${unitAliases.join(', ')}]`);
    console.log(`  Requested volume unit: ${requestedVolumeUnit}`);

    let best: any = null;
    let bestScore = -Infinity;
    let bestConversionFactor = 1;

    for (const serving of servings) {
        const description = (serving.measurementDescription || serving.description || '').toLowerCase();
        const grams = gramsForServing(serving);
        let score = 0;
        let conversionFactor = 1;

        console.log(`\n  Evaluating: "${description}" (grams: ${grams})`);

        if (grams == null || grams <= 0) {
            score -= 100;
            console.log(`    - No grams, score -= 100`);
        }

        if (unit && unitAliases.some(alias => description.includes(alias))) {
            score += 2;
            console.log(`    + Direct unit match, score += 2`);
        } else if (unit && requestedVolumeUnit) {
            console.log(`    Trying volume conversion...`);
            const servingVolume = extractServingVolumeUnit(description);
            console.log(`    Extracted: ${JSON.stringify(servingVolume)}`);

            if (servingVolume && volumeToMl[servingVolume.unit]) {
                const servingMl = servingVolume.amount * volumeToMl[servingVolume.unit];
                const requestedMl = volumeToMl[requestedVolumeUnit];
                console.log(`    servingMl: ${servingMl}, requestedMl: ${requestedMl}`);

                if (servingMl > 0 && requestedMl > 0) {
                    conversionFactor = requestedMl / servingMl;
                    score += 1.5;
                    console.log(`    + Volume conversion works! factor=${conversionFactor}, score += 1.5`);
                }
            }
        } else if (!unit) {
            if (/100\s*(g|gram|grams|ml)/i.test(description)) {
                score += 1;
            }
        }

        if (grams && grams > 0) {
            score += 0.5;
            console.log(`    + Has grams, score += 0.5`);
        }

        console.log(`    Final score: ${score}`);

        if (score > bestScore) {
            bestScore = score;
            best = serving;
            bestConversionFactor = conversionFactor;
        }
    }

    console.log(`\n  WINNER: ${best?.measurementDescription} (score: ${bestScore}, conversionFactor: ${bestConversionFactor})`);

    const bestGrams = best ? gramsForServing(best) : null;
    const adjustedGrams = bestGrams ? bestGrams * bestConversionFactor : null;
    console.log(`  Base grams: ${bestGrams}, Adjusted grams: ${adjustedGrams}`);

    return { serving: best, adjustedGrams, conversionFactor: bestConversionFactor };
}

async function test() {
    const input = "0.25 cup nonfat Italian dressing";
    const foodId = "fdc_173590";

    console.log('=== DEBUGGING selectServing DIRECTLY ===\n');
    console.log(`Input: "${input}"`);

    const parsed = parseIngredientLine(input);
    console.log(`Parsed: qty=${parsed?.qty}, unit=${parsed?.unit}`);

    const cachedFood = await getCachedFoodWithRelations(foodId);
    if (!cachedFood) {
        console.log('Food not found in cache');
        return;
    }

    const details = cacheFoodToDetails(cachedFood);
    console.log(`\nServings for ${cachedFood.name}:`);

    const result = selectServingWithDebug(parsed, details?.servings || []);

    if (result?.adjustedGrams) {
        const qty = parsed?.qty ?? 1;
        const finalGrams = result.adjustedGrams * qty;
        console.log(`\n✅ SUCCESS: ${qty} ${parsed?.unit} = ${finalGrams}g`);
    }
}

test().finally(() => prisma.$disconnect());
