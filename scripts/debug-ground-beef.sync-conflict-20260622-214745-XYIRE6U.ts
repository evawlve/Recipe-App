/**
 * Trace selectServing for ground beef
 */
import 'dotenv/config';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { prisma } from '../src/lib/db';
import { getCachedFoodWithRelations, cacheFoodToDetails } from '../src/lib/fatsecret/cache-search';

async function main() {
    // Get GROUND BEEF cache entry to verify servings
    const food = await prisma.fatSecretFoodCache.findFirst({
        where: { name: { equals: 'GROUND BEEF', mode: 'insensitive' } },
        include: { servings: true }
    });

    if (!food) {
        console.log('GROUND BEEF not found');
        return;
    }

    console.log('=== GROUND BEEF servings ===');
    console.log('Food ID:', food.id);
    console.log('Servings:');
    for (const s of food.servings) {
        const grams = s.servingWeightGrams || (s.metricServingUnit === 'g' ? s.metricServingAmount : null);
        console.log('  -', s.measurementDescription);
        console.log('    id:', s.id);
        console.log('    servingWeightGrams:', s.servingWeightGrams);
        console.log('    metricServingAmount:', s.metricServingAmount, s.metricServingUnit);
        console.log('    gramsForServing result:', grams);
    }

    // Also check parsed line
    console.log('\n=== Parsed line ===');
    const parsed = parseIngredientLine('16 oz ground beef');
    console.log(JSON.stringify(parsed, null, 2));
}

main()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
