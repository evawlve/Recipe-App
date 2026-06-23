
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';

async function main() {
    console.log('--- Investigating Pilot Failures (Round 2) ---');

    const cases = [
        { input: "3 fl oz single cream", note: "Failed in pilot (No mapping found)" },
        { input: "4 ice cubes ice cubes", note: "Mapped to candy? (Ice Cubes)" },
        { input: "3 tsp liquid aminos", note: "Mapped to Liquid Filled Wax Candy" },
        { input: "1 cup all purpose flour", note: "Mapped to Whole Wheat Flour" },
        { input: "1 cup oats dry", note: "High kcal check (607/156g)" },
        { input: "16 oz ground beef", note: "High kcal check / default fat %" },
        { input: "44 g fancy low-moisture part-skim mozzarella cheese", note: "Mapped to generic Mozzarella (check fat)" }
    ];

    for (const c of cases) {
        console.log(`\nTesting "${c.input}"...`);

        // Show normalization debug
        const norm = normalizeIngredientName(c.input);
        console.log(`Normalized: "${norm.cleaned}" (Noun: "${norm.nounOnly}")`);

        const result = await mapIngredientWithFallback(c.input, { debug: true, skipCache: true });

        if (result) {
            console.log(`✅ Result: "${result.foodName}" (ID: ${result.foodId})`);
            console.log(`   Macros per 100g: ${result.calories}kcal, P:${result.protein}, C:${result.carbs}, F:${result.fat}`);
            if (result.brandName) console.log(`   Brand: ${result.brandName}`);
        } else {
            console.log("❌ Result: NULL");
        }
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
