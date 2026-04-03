import { hydrateAndSelectServing } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

async function main() {
    const raw = "Palm Sugar";
    const parsed = parseIngredientLine(raw);
    
    const candidate = {
        id: "fdc_2033749",
        name: "PALM SUGAR",
        brandName: "DRAGONFLY",
        source: "fdc" as const,
        score: 0.9,
        foodType: "generic" as const,
        rawData: {}
    };

    console.log("Parsed:", parsed);
    const result = await hydrateAndSelectServing(candidate, parsed, 0.9, raw);
    console.log("Hydrate Result:", result);
}

main().catch(console.error);
