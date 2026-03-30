import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';
import { parseIngredient } from '../src/lib/fatsecret/ingredient-parser';

async function main() {
    const raw = "cannellini beans";
    console.log(`Raw: ${raw}`);
    const normalized = await normalizeIngredientName(raw);
    console.log(`Normalized: ${normalized}`);
    const parsed = parseIngredient("30 oz cannellini beans");
    console.log(`Parsed noun: ${parsed.rawNoun}`);
    const normParsed = normalizeIngredientName(parsed.rawNoun);
    console.log(`Normalized parsed noun: ${normParsed.nounOnly}`);
}
main();
