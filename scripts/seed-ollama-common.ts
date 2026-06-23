/**
 * Local Ollama Ingredient Seeder
 * 
 * Uses the local Ollama model to generate common ingredient lines
 * (branded + non-branded) and pushes them through the mapping pipeline.
 * 
 * Runs independently of the cloud AI seeder — no API credits consumed.
 * Uses a different prompt strategy: instead of category-based generation,
 * asks for the most common/popular ingredients people actually eat.
 */

import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { logger } from '../src/lib/logger';

// ============================================================
// Configuration
// ============================================================

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';
const BATCH_SIZE = 50;       // Items per LLM call
const DELAY_BETWEEN_ITEMS_MS = 150;  // Delay between mapping calls (lower than cloud seeder)
const DELAY_BETWEEN_BATCHES_MS = 2000;

// Track progress
let totalGenerated = 0;
let totalMapped = 0;
let totalSkipped = 0;
let totalFailed = 0;

// ============================================================
// Prompt Themes — diverse angles to maximize unique ingredients
// ============================================================

const GENERATION_PROMPTS = [
  // === COMMON WHOLE FOODS ===
  {
    theme: "Breakfast ingredients",
    prompt: "List 50 common breakfast food ingredients with realistic quantities and units as someone would write them in a recipe or food diary. Include items like eggs, bacon, oatmeal, yogurt, toast, cereal, fruit, etc. Mix branded and generic items. Format: one ingredient per line, e.g. '2 large eggs', '1 cup Cheerios', '6 oz Chobani Greek Yogurt'."
  },
  {
    theme: "Lunch ingredients",
    prompt: "List 50 common lunch food ingredients with realistic quantities. Include sandwich items, salad components, soups, wraps, deli meats, condiments, etc. Mix branded and generic. Format: one per line with quantity and unit, e.g. '2 slices whole wheat bread', '3 oz deli turkey', '1 tbsp Hellmann's mayo'."
  },
  {
    theme: "Dinner proteins",
    prompt: "List 50 common dinner protein ingredients with realistic quantities. Include chicken, beef, pork, fish, tofu, beans, etc. in various preparations. Format: one per line, e.g. '6 oz chicken breast', '8 oz ground beef 80/20', '1 can tuna in water', '4 oz Atlantic salmon fillet'."
  },
  {
    theme: "Vegetables and sides",
    prompt: "List 50 common vegetables and side dish ingredients with quantities. Include fresh, frozen, and canned vegetables, rice, potatoes, pasta. Format: one per line, e.g. '1 cup broccoli florets', '1 medium russet potato', '1 cup cooked white rice', '1 can Green Giant corn'."
  },
  {
    theme: "Snacks and treats",
    prompt: "List 50 common snack foods with quantities. Include chips, crackers, nuts, dried fruit, granola bars, cookies, candy, popcorn. Mix branded and generic. Format: one per line, e.g. '1 oz Lay's Classic Potato Chips', '1 Kind Bar Dark Chocolate Nuts', '1/4 cup almonds'."
  },
  {
    theme: "Beverages",
    prompt: "List 50 common beverages with quantities. Include coffee, tea, juice, soda, milk, protein shakes, sports drinks, energy drinks, alcohol. Mix branded and generic. Format: one per line, e.g. '12 oz Coca-Cola', '1 cup whole milk', '1 scoop Optimum Nutrition Gold Standard Whey', '8 oz orange juice'."
  },
  {
    theme: "Baking ingredients",
    prompt: "List 50 common baking and cooking ingredients with quantities. Include flours, sugars, oils, butter, spices, extracts, leavening agents, chocolate. Format: one per line, e.g. '2 cups all purpose flour', '1 tsp vanilla extract', '1/2 cup unsalted butter', '1 tbsp olive oil'."
  },
  {
    theme: "Dairy and alternatives",
    prompt: "List 50 dairy and dairy alternative products with quantities. Include milk, cheese, yogurt, cream, butter, plant-based alternatives. Mix branded and generic. Format: one per line, e.g. '1 cup Oatly oat milk', '1 oz cheddar cheese', '1/2 cup cottage cheese', '2 tbsp cream cheese'."
  },
  {
    theme: "Condiments and sauces",
    prompt: "List 50 common condiments, sauces, and dressings with quantities. Include ketchup, mustard, hot sauce, soy sauce, salad dressings, BBQ sauce, pasta sauce. Mix branded and generic. Format: one per line, e.g. '1 tbsp Heinz ketchup', '2 tbsp ranch dressing', '1 tsp Sriracha', '1/2 cup Prego marinara'."
  },
  {
    theme: "Fruits and berries",
    prompt: "List 50 common fruits with realistic quantities. Include fresh, dried, frozen, canned, and juiced forms. Format: one per line, e.g. '1 medium banana', '1 cup strawberries', '1 medium Honeycrisp apple', '1/4 cup dried cranberries', '1 cup frozen mixed berries'."
  },
  {
    theme: "Fast food and restaurant items",
    prompt: "List 50 common fast food and restaurant menu items as someone would log them in a food diary. Include burgers, pizza, tacos, burritos, fried chicken, sandwiches from chains. Format: one per line, e.g. '1 Big Mac', '2 slices pepperoni pizza', '1 Chipotle chicken burrito bowl', '6 piece chicken McNuggets'."
  },
  {
    theme: "Grains and cereals",
    prompt: "List 50 common grains, cereals, and grain products with quantities. Include rice, pasta, bread, tortillas, breakfast cereals, oats, quinoa. Mix branded and generic. Format: one per line, e.g. '1 cup cooked brown rice', '2 oz spaghetti dry', '1 flour tortilla', '3/4 cup Frosted Flakes'."
  },
  {
    theme: "International cuisine ingredients",
    prompt: "List 50 common international cuisine ingredients with quantities. Include items from Mexican, Asian, Indian, Mediterranean, Italian, Thai, Japanese cooking. Format: one per line, e.g. '1 tbsp fish sauce', '2 tbsp tahini', '1 tsp garam masala', '1 sheet nori', '100g paneer'."
  },
  {
    theme: "Health and fitness foods",
    prompt: "List 50 common health-focused and fitness foods with quantities. Include protein powders, supplements, superfoods, meal replacements, health bars, lean meats, egg whites. Mix branded and generic. Format: one per line, e.g. '1 scoop Quest Protein Powder', '1 tbsp chia seeds', '1 cup egg whites', '1 Clif Bar'."
  },
  {
    theme: "Frozen and convenience foods",
    prompt: "List 50 common frozen and convenience food items with quantities. Include frozen meals, frozen vegetables, frozen pizza, ice cream, frozen breakfast items. Mix branded and generic. Format: one per line, e.g. '1 Lean Cuisine Chicken Alfredo', '1 cup Birds Eye mixed vegetables', '1/2 cup Ben & Jerry's Cherry Garcia'."
  },
  {
    theme: "Deli and prepared foods",
    prompt: "List 50 common deli and prepared food items with quantities. Include rotisserie chicken, deli salads, prepared soups, sushi, pre-made sandwiches, hummus, guacamole. Format: one per line, e.g. '4 oz rotisserie chicken breast', '1/2 cup potato salad', '1 cup chicken noodle soup', '2 tbsp Sabra classic hummus'."
  },
  {
    theme: "Pantry staples",
    prompt: "List 50 common pantry staple ingredients with quantities. Include canned goods, dried beans, pasta, rice, canned tomatoes, broth, peanut butter, jelly. Mix branded and generic. Format: one per line, e.g. '1 can Goya black beans', '2 tbsp Jif peanut butter', '1 cup chicken broth', '14 oz can diced tomatoes'."
  },
  {
    theme: "Baby and kids foods",
    prompt: "List 50 common kids and family food items with quantities. Include baby food, juice boxes, Goldfish crackers, mac and cheese, chicken nuggets, PB&J items, school lunch staples. Mix branded and generic. Format: one per line, e.g. '1 box Kraft Mac and Cheese (prepared)', '1 pouch GoGo Squeez applesauce', '30 Goldfish crackers'."
  },
  {
    theme: "Herbs spices and seasonings",
    prompt: "List 50 common herbs, spices, and seasoning blends with quantities. Include salt, pepper, garlic powder, cumin, paprika, Italian seasoning, taco seasoning, everything bagel seasoning. Format: one per line, e.g. '1 tsp garlic powder', '1/2 tsp cayenne pepper', '1 tbsp Everything But The Bagel seasoning', '1 tsp smoked paprika'."
  },
  {
    theme: "Sweeteners and toppings",
    prompt: "List 50 common sweeteners, toppings, and add-ons with quantities. Include sugar, honey, maple syrup, whipped cream, chocolate chips, sprinkles, syrup, jam, nut butters. Mix branded and generic. Format: one per line, e.g. '1 tbsp honey', '2 tbsp Hershey's chocolate syrup', '1 packet Splenda', '1 tbsp Nutella'."
  },
];

// ============================================================
// Ollama API Call
// ============================================================

async function callOllama(prompt: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000); // 2 min timeout

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a nutrition assistant. Output ONLY ingredient lines, one per line. No numbering, no headers, no explanations. Just plain ingredient lines like a recipe or food diary.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.9, // Higher temp for more variety
        max_tokens: 4000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama HTTP ${response.status}: ${body}`);
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content ?? '';

    // Parse lines — strip numbering, empty lines, headers
    const lines = content
      .split('\n')
      .map((l: string) => l.replace(/^\d+[\.\)]\s*/, '').trim()) // Strip "1. " or "1) "
      .map((l: string) => l.replace(/^\*+\s*/, '').trim())       // Strip "* " markdown
      .map((l: string) => l.replace(/^-\s*/, '').trim())         // Strip "- " markdown
      .filter((l: string) => l.length > 3 && l.length < 200)    // Reasonable length
      .filter((l: string) => !l.startsWith('#'))                 // No headers
      .filter((l: string) => !/^(here|these|the|note|i |let)/i.test(l)); // No meta text

    return lines;
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === 'AbortError') {
      console.error('⏱️  Ollama timeout (120s)');
    } else {
      console.error('❌ Ollama error:', (err as Error).message);
    }
    return [];
  }
}

// ============================================================
// Mapping with Dedup
// ============================================================

const seenIngredients = new Set<string>();

async function mapIngredient(line: string): Promise<boolean> {
  // Dedup by normalized lowercase
  const key = line.toLowerCase().trim();
  if (seenIngredients.has(key)) {
    totalSkipped++;
    return false;
  }
  seenIngredients.add(key);

  try {
    const result = await mapIngredientWithFallback(line, {
      skipAiValidation: true,
      allowLiveFallback: true,
    });

    if (result && 'foodName' in result) {
      totalMapped++;
      console.log(`  ✅ ${line} → ${result.foodName} [${result.source}]`);
      return true;
    } else {
      totalFailed++;
      console.log(`  ❌ ${line} → no match`);
      return false;
    }
  } catch (err) {
    totalFailed++;
    console.log(`  💥 ${line} → error: ${(err as Error).message?.slice(0, 80)}`);
    return false;
  }
}

// ============================================================
// Sleep Helper
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('');
  console.log('🏠 Local Ollama Ingredient Seeder');
  console.log(`   Model: ${OLLAMA_MODEL}`);
  console.log(`   Themes: ${GENERATION_PROMPTS.length}`);
  console.log(`   Target: ~${GENERATION_PROMPTS.length * BATCH_SIZE} ingredient lines`);
  console.log('');

  // Verify Ollama is reachable
  try {
    const test = await fetch(`${OLLAMA_BASE_URL.replace('/v1', '')}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!test.ok) throw new Error(`HTTP ${test.status}`);
    console.log('✅ Ollama is reachable\n');
  } catch {
    console.error('❌ Cannot reach Ollama at', OLLAMA_BASE_URL);
    console.error('   Make sure Ollama is running: ollama serve');
    process.exit(1);
  }

  const startTime = Date.now();

  for (let i = 0; i < GENERATION_PROMPTS.length; i++) {
    const { theme, prompt } = GENERATION_PROMPTS[i];

    console.log('');
    console.log(`${'='.repeat(60)}`);
    console.log(`🧠 [${i + 1}/${GENERATION_PROMPTS.length}] ${theme}`);
    console.log(`${'='.repeat(60)}`);
    console.log('');

    // Generate ingredients via Ollama
    console.log('⏳ Generating ingredients locally...');
    const lines = await callOllama(prompt);
    totalGenerated += lines.length;
    console.log(`📦 Got ${lines.length} ingredient lines\n`);

    if (lines.length === 0) {
      console.log('⚠️  No lines generated, skipping theme\n');
      continue;
    }

    // Map each ingredient
    for (const line of lines) {
      await mapIngredient(line);
      await sleep(DELAY_BETWEEN_ITEMS_MS);
    }

    // Print progress
    const elapsed = Math.round((Date.now() - startTime) / 60000);
    console.log('');
    console.log(`📊 Progress: Generated=${totalGenerated} Mapped=${totalMapped} Skipped=${totalSkipped} Failed=${totalFailed} (${elapsed}min)`);

    // Delay between batches
    if (i < GENERATION_PROMPTS.length - 1) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  // Final summary
  const totalElapsed = Math.round((Date.now() - startTime) / 60000);
  console.log('');
  console.log('='.repeat(60));
  console.log('🏁 LOCAL SEEDER COMPLETE');
  console.log('='.repeat(60));
  console.log(`   Total generated: ${totalGenerated}`);
  console.log(`   Successfully mapped: ${totalMapped}`);
  console.log(`   Skipped (dedup): ${totalSkipped}`);
  console.log(`   Failed: ${totalFailed}`);
  console.log(`   Success rate: ${totalGenerated > 0 ? ((totalMapped / totalGenerated) * 100).toFixed(1) : 0}%`);
  console.log(`   Runtime: ${totalElapsed} minutes`);
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
