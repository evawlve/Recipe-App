import 'dotenv/config';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';

process.env.LOG_LEVEL = 'error';

async function main() {
    const client = new FatSecretClient();
    const rawLine = '0.5 cup vegetable oil';
    const parsed = parseIngredientLine(rawLine);
    const baseName = parsed?.name?.trim() || rawLine.trim();
    const normalized = normalizeIngredientName(baseName).cleaned || baseName;

    const candidates = await gatherCandidates(rawLine, parsed, normalized, {
        client,
        skipCache: true,
    });

    console.log(`Gathered ${candidates.length} candidates for "${rawLine}"\n`);

    // Dump first 3 candidates' full structure
    for (const c of candidates.slice(0, 5)) {
        console.log(`--- "${c.name}" [${c.source}] ---`);
        console.log(`  nutrition:`, JSON.stringify(c.nutrition, null, 2)?.slice(0, 200));
        console.log(`  nutrition.per100g:`, c.nutrition?.per100g);
        console.log(`  rawData type:`, typeof c.rawData);
        console.log(`  rawData keys:`, c.rawData ? Object.keys(c.rawData).join(', ') : 'null');
        console.log(`  rawData.nutrientsPer100g:`, c.rawData?.nutrientsPer100g);

        // What gets used as nutrientsToCheck
        let nutrientsToCheck: any = null;
        if (c.nutrition && c.nutrition.per100g) {
            nutrientsToCheck = {
                calories: c.nutrition.kcal,
                protein: c.nutrition.protein,
                fat: c.nutrition.fat,
                carbs: c.nutrition.carbs
            };
            console.log(`  → Using nutrition.per100g:`, JSON.stringify(nutrientsToCheck));
        } else if (c.rawData && c.rawData.nutrientsPer100g) {
            nutrientsToCheck = c.rawData.nutrientsPer100g;
            console.log(`  → Using rawData.nutrientsPer100g:`, JSON.stringify(nutrientsToCheck));
        } else {
            nutrientsToCheck = c.rawData;
            console.log(`  → FALLBACK to rawData:`, JSON.stringify(nutrientsToCheck)?.slice(0, 300));
        }

        // What hasNullOrInvalidMacros would see
        const calories = nutrientsToCheck?.kcal ?? nutrientsToCheck?.calories ?? null;
        const protein = nutrientsToCheck?.protein ?? null;
        const carbs = nutrientsToCheck?.carbs ?? null;
        const fat = nutrientsToCheck?.fat ?? null;
        console.log(`  → calories=${calories}, protein=${protein}, carbs=${carbs}, fat=${fat}`);
        const allNull = calories === null && protein === null && carbs === null && fat === null;
        console.log(`  → allNull=${allNull}`);
        console.log();
    }

    process.exit(0);
}

main().catch(console.error);
