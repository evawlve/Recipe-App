import 'dotenv/config';
import { callStructuredLlm } from '../src/lib/ai/structured-client';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { logger } from '../src/lib/logger';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CATEGORIES = [
    // Dietary & Health
    "Sugar-free / No sugar added products",
    "Keto / Low carb / Paleo products",
    "Fat-free / Reduced fat / Light products",
    "Vegan / Plant-based meat and dairy alternatives",
    "Protein powders and Sports nutrition supplements",
    "Gluten-free baking staples and breads",
    "Dairy-free milk alternatives (almond, oat, soy, macadamia)",
    "Low sodium / heart healthy products",

    // Cultural & Regional Cuisines
    "Mexican cuisine staples (tostadas, specific tortillas, masa, cotija, peppers)",
    "Asian cuisine staples (gochujang, kewpie, mirin, miso, noodles)",
    "Italian cuisine staples (specific pastas, pancetta, guanciale, regional cheeses)",
    "Greek & Mediterranean foods (halloumi, tzatziki, tahini, couscous)",
    "Indian cuisine staples (ghee, paneer, specific curries and spices)",
    "Middle Eastern foods (falafel mix, sumac, za'atar, pomegranate molasses)",
    "Caribbean foods (plantains, jerk marinades, scotch bonnet, ackee)",
    "African foods (teff flour, injera, fufu, berbere spice)",
    "Japanese specific ingredients (dashi, bonito flakes, specific soy sauces, matcha)",
    "Korean specific ingredients (kimchi variants, gochugaru, ssamjang)",
    "Thai specific ingredients (curry pastes, fish sauce, galangal, kaffir lime)",
    "French specific ingredients (duck fat, specific cheeses, truffles, creme fraiche)",

    // Grocery Aisles: Produce & Fresh
    "Exotic and tropical fruits (dragonfruit, jackfruit, passionfruit, guava)",
    "Specific apple and pear variants (Honeycrisp, Granny Smith, Bartlett)",
    "Leafy greens and cabbages (kale variants, bok choy, radicchio, endive)",
    "Root vegetables and tubers (parsnips, specific potatoes, yams, taro)",
    "Fresh herbs and microgreens",

    // Grocery Aisles: Meat, Seafood & Dairy
    "Specific cuts of beef (ribeye, flank, brisket, ground percentages)",
    "Specific cuts of pork and lamb (chops, shoulder, leg, ground)",
    "Poultry (chicken variants, turkey, duck breasts, whole birds)",
    "Fresh seafood (salmon variants, tuna, white fish, octopus)",
    "Shellfish (shrimp sizes, scallops, mussels, crab meat)",
    "Canned seafood (sardines, specific tunas, anchovies)",
    "Deli meats (prosciutto, specific salamis, sliced turkey/ham)",
    "Specialty cheeses (brie, gouda, aged cheddars, blue cheese)",
    "Eggs and egg substitutes (liquid egg whites, quail eggs)",

    // Grocery Aisles: Pantry & Dry Goods
    "Breads & Bakery (specific loafs, bagels, pastries, tortillas)",
    "Baking staples (flours, extracts, leavening agents, chocolates)",
    "Oils and vinegars (specific olive oils, avocado oil, balsamic, rice vinegar)",
    "Nuts and seeds (macadamia, chia, flax, specific almonds)",
    "Grains and rice (quinoa, arborio, basmati, barley)",
    "Beans and legumes (canned vs dried, lentils, chickpeas)",

    // Condiments, Soups & Beverages
    "Soups (canned, boxed, bouillon, ramen packets)",
    "Condiments & Sauces (BBQ, hot sauces, diverse dressings, mustards)",
    "Coffee and tea variants (whole bean, espresso, loose leaf, matcha)",
    "Beverages (sodas, juices, energy drinks, kombucha)",

    // Snacks & Sweets
    "Salty snacks (chips, pretzels, popcorn variants)",
    "Sweet snacks (granola bars, fruit snacks, cookies)",
    "Candies & Confectionery (gummies, chocolates, hard candies)",
    "Yogurts (Greek, Icelandic, mix-ins, drinkable)",
    "Ice cream (tubs, popsicles, sandwiches, non-dairy)",

    // Dining & Prepared
    "Breakfast foods (hashbrowns, bacon, turkey variants, sausages)",
    "Frozen prepared foods (pizzas, chicken tenders, frozen meals)",
    "Fast food items (burgers, fries, specific branded fast food)",
    "Restaurant generic foods (diner food, standard takeout items)"
];

const schema = {
    type: "object",
    properties: {
        ingredients: {
            type: "array",
            items: { type: "string" },
            description: "Array of exactly 200 highly specific, diverse ingredient strings formatted as they would appear in a recipe."
        }
    },
    required: ["ingredients"],
    additionalProperties: false
};

async function generateIngredientsForCategory(category: string): Promise<string[]> {
    logger.info(`Generating ingredients for category: ${category}`);
    
    const systemPrompt = `You are an expert culinary data engineer. 
Your task is to generate exactly 200 highly specific, realistic ingredient phrases for the provided category.
Include a diverse mix of:
- Generic whole foods
- Highly specific branded CPG products (e.g. "2 tbsp Sweet Baby Ray's BBQ Sauce")
- Specific modifiers (e.g. "sugar-free", "low-sodium", "cooked", "raw", "diced")
- Realistic recipe quantities and units (e.g. "1/2 cup", "200g", "3 slices", "1 tbsp")

Ensure the output strings look EXACTLY like lines copied from a recipe ingredients list.
OUTPUT ONLY VALID JSON. Do not include markdown formatting like \`\`\`json or any conversational text.`;

    const userPrompt = `Generate 200 diverse ingredient strings for this category: "${category}"`;

    const result = await callStructuredLlm({
        schema,
        systemPrompt,
        userPrompt,
        purpose: 'normalize', 
        timeout: 120000, // 2 minutes, as generating 200 items takes longer
    });

    // Strategy: robust array extraction
    // Since generating 200 items can sometimes hit the token limit and truncate the JSON,
    // or the LLM might return a raw array, we use a robust fallback to pull all string literals 
    // out of the raw response if standard parsing fails.
    let extracted: string[] = [];

    if (result.status === 'success' && result.content) {
        if (Array.isArray(result.content)) {
            extracted = result.content as string[];
        } else if (result.content.ingredients && Array.isArray(result.content.ingredients)) {
            extracted = result.content.ingredients as string[];
        }
    }
    
    // If we didn't extract normally (due to truncation or parse error), attempt regex extraction
    if (extracted.length === 0 && result.raw && typeof result.raw === 'string') {
        logger.warn(`Attempting regex extraction due to malformed or truncated JSON for ${category}...`);
        const matches = [...(result.raw as string).matchAll(/"([^"]+)"/g)];
        extracted = matches.map(m => m[1]).filter(s => s !== 'ingredients' && s.length > 2);
    } else if (extracted.length === 0 && result.error && typeof result.error === 'string' && result.error.includes('Unexpected end of JSON input')) {
        logger.warn(`JSON was truncated. Attempting to parse raw output for ${category}...`);
        // If it was a parsing error, result.raw might contain the raw string from the LLM
        // Unfortunately callStructuredLlm doesn't return the raw string on parse error, 
        // so we'd have to rely on whatever we got. 
    }

    if (extracted.length > 0) {
        return extracted;
    }

    logger.error(`Failed to generate ingredients for ${category}: ${result.error}`);
    console.dir(result, { depth: null });
    return [];
}

async function processIngredient(ingredient: string, category: string) {
    try {
        logger.info(`Mapping: "${ingredient}" (Category: ${category})`);
        const result = await mapIngredientWithFallback(ingredient, { allowLiveFallback: true });
        if (result) {
            logger.info(`✅ Success -> Target: ${result.foodName} [${result.source}]`);
        } else {
            logger.warn(`❌ Failed to map: "${ingredient}"`);
        }
    } catch (err) {
        logger.error(`Crash mapping "${ingredient}": ${(err as Error).message}`);
    }
}

async function main() {
    const args = process.argv.slice(2);
    let targetCategories = CATEGORIES;

    if (args.length > 0) {
        const query = args[0];
        const index = parseInt(query, 10);
        if (!isNaN(index) && index >= 0 && index < CATEGORIES.length) {
            targetCategories = [CATEGORIES[index]];
        } else {
            targetCategories = CATEGORIES.filter(c => c.toLowerCase().includes(query.toLowerCase()));
        }
    }

    logger.info(`Starting AI Category Saturation. Categories to process: ${targetCategories.length}`);

    for (const category of targetCategories) {
        console.log(`\n========================================================`);
        console.log(`🧠 CATEGORY: ${category}`);
        console.log(`========================================================\n`);

        const ingredients = await generateIngredientsForCategory(category);
        
        if (ingredients.length === 0) {
            continue;
        }

        console.log(`Generated ${ingredients.length} items. Mapping...`);

        for (const [idx, ingredient] of ingredients.entries()) {
            console.log(`[${idx + 1}/${ingredients.length}] `);
            await processIngredient(ingredient, category);
            await new Promise(r => setTimeout(r, 200)); // slightly faster
        }
    }

    console.log('\n🎉 Saturation Complete!');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
