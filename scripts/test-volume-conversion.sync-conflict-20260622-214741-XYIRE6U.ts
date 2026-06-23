import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { FatSecretServing } from '../src/lib/fatsecret/client';

// Copy the selectServing logic to test locally
function gramsForServing(serving: any): number | null {
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
}

async function test() {
    const foodId = 'fdc_173590';
    const requestedUnit = 'cup';

    // Get servings from cache
    const servings = await prisma.fatSecretServingCache.findMany({
        where: { foodId },
    });

    console.log('=== TESTING VOLUME CONVERSION ===');
    console.log(`Food ID: ${foodId}`);
    console.log(`Requested unit: ${requestedUnit}`);
    console.log(`\nServings (${servings.length}):`);

    // Volume conversions
    const volumeToMl: Record<string, number> = {
        'ml': 1,
        'tsp': 5,
        'tbsp': 15,
        'cup': 240,
        'c': 240,
        'floz': 30,
    };

    const pattern = /(\d+(?:\.\d+)?)\s*(cup|cups|c|tbsp|tablespoon|tablespoons|tbs|tsp|teaspoon|teaspoons|ml|floz)/i;

    const requestedMl = volumeToMl['cup'];
    console.log(`Requested unit (cup) = ${requestedMl} ml`);

    for (const serving of servings) {
        const desc = serving.measurementDescription || '';
        const grams = gramsForServing(serving);

        console.log(`\n  Serving: "${desc}"`);
        console.log(`    Grams: ${grams}`);

        const match = desc.match(pattern);
        if (match) {
            const amount = parseFloat(match[1]);
            const unit = match[2].toLowerCase();
            const canonicalUnit = unit.startsWith('table') ? 'tbsp' : unit.startsWith('tea') ? 'tsp' : unit;

            console.log(`    Volume match: ${amount} ${unit} (canonical: ${canonicalUnit})`);

            if (volumeToMl[canonicalUnit]) {
                const servingMl = amount * volumeToMl[canonicalUnit];
                const conversionFactor = requestedMl / servingMl;
                const convertedGrams = grams ? grams * conversionFactor : null;

                console.log(`    Serving = ${servingMl} ml`);
                console.log(`    Conversion factor: ${requestedMl} / ${servingMl} = ${conversionFactor}`);
                console.log(`    ✅ WOULD WORK: 1 cup = ${convertedGrams}g`);
            }
        } else {
            console.log(`    No volume match`);
        }
    }
}

test().finally(() => prisma.$disconnect());
