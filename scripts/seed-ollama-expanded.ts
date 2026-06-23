/**
 * seed-ollama-expanded.ts — 200 themed prompts × 50 items = ~10K ingredient lines
 *
 * Uses local Ollama (qwen2.5:14b) to generate diverse natural-language ingredient
 * lines and pushes them through mapIngredientWithFallback().
 *
 * Usage:
 *   npx tsx scripts/seed-ollama-expanded.ts
 *   npx tsx scripts/seed-ollama-expanded.ts --start=50   # resume from theme #50
 */

import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';
const DELAY_BETWEEN_ITEMS_MS = 150;
const DELAY_BETWEEN_BATCHES_MS = 2000;

let totalGenerated = 0, totalMapped = 0, totalSkipped = 0, totalFailed = 0;

// ── 200 Themed Prompts ──────────────────────────────────────────────────────
// Grouped by category to maximize diversity. Each asks for 50 items.

const THEMES: { theme: string; prompt: string }[] = [
  // ── Regional & Cultural (40) ──
  ...([
    ["Mexican street food", "tacos, elote, churros, tamales, horchata, pozole, quesadillas"],
    ["Japanese ramen toppings", "chashu, nori, soft-boiled egg, menma, corn, narutomaki"],
    ["Korean BBQ items", "bulgogi, galbi, kimchi, ssamjang, gochugaru, perilla leaves"],
    ["Indian curry ingredients", "ghee, garam masala, paneer, turmeric, cumin seeds, naan"],
    ["Thai stir-fry", "fish sauce, palm sugar, Thai basil, galangal, lemongrass, kaffir lime"],
    ["Vietnamese pho", "rice noodles, hoisin sauce, sriracha, bean sprouts, Thai basil, lime"],
    ["Mediterranean mezze", "hummus, baba ganoush, feta, olives, pita bread, tzatziki"],
    ["Middle Eastern cooking", "sumac, za'atar, pomegranate molasses, tahini, rose water"],
    ["Ethiopian cuisine", "teff flour, injera, berbere spice, niter kibbeh, lentils"],
    ["Caribbean cooking", "plantains, scotch bonnet, jerk seasoning, coconut milk, allspice"],
    ["Brazilian dishes", "açaí, farofa, black beans, cassava, palm oil, guaraná"],
    ["Peruvian ingredients", "aji amarillo, quinoa, ceviche, corn, purple potato, lucuma"],
    ["French cooking staples", "duck fat, crème fraîche, Dijon mustard, herbes de Provence"],
    ["German/Bavarian foods", "bratwurst, sauerkraut, pretzels, schnitzel, spätzle, mustard"],
    ["British pub food", "fish and chips, mushy peas, HP sauce, Worcestershire, malt vinegar"],
    ["Southern/Soul food", "collard greens, cornbread, black-eyed peas, okra, grits, fatback"],
    ["Cajun/Creole", "andouille sausage, crawfish, file powder, Trinity, roux"],
    ["Tex-Mex items", "queso, flour tortillas, refried beans, jalapeños, salsa verde"],
    ["Hawaiian foods", "spam, poi, macadamia nuts, pineapple, teriyaki, li hing mui"],
    ["Filipino dishes", "lumpia, adobo, calamansi, patis, ube, banana ketchup"],
    ["Chinese dim sum", "siu mai, har gow, char siu bao, rice noodle rolls, congee"],
    ["Greek cooking", "feta, oregano, kalamata olives, phyllo dough, grape leaves"],
    ["Turkish ingredients", "pomegranate, Aleppo pepper, yogurt, bulgur, Turkish coffee"],
    ["Moroccan tagine", "preserved lemons, ras el hanout, saffron, couscous, harissa"],
    ["Polish cuisine", "pierogi, kielbasa, sauerkraut, beet soup, rye bread"],
    ["Vietnamese banh mi", "baguette, pate, daikon, cilantro, jalapeño, sriracha mayo"],
    ["Jamaican jerk", "scotch bonnet, allspice, thyme, ginger, green onion, rum"],
    ["Chinese hot pot", "thinly sliced lamb, tofu, mushrooms, noodles, fish balls"],
    ["Spanish tapas", "chorizo, manchego, pimentón, sherry vinegar, saffron"],
    ["Lebanese cooking", "labneh, fattoush, tabbouleh, halloumi, Arabic bread"],
    ["Indonesian satay", "peanut sauce, ketjap manis, sambal oelek, turmeric, coconut"],
    ["West African", "palm oil, peanut soup, okra, cassava, plantain, scotch bonnet"],
    ["Scandinavian foods", "lingonberry, dill, smoked salmon, crispbread, gravlax"],
    ["Cuban cuisine", "mojo, black beans, plantains, sofrito, yuca, Cuban bread"],
    ["Argentine grilling", "chimichurri, provoleta, morcilla, dulce de leche"],
    ["Malaysian laksa", "laksa paste, coconut milk, rice vermicelli, tofu puffs, bean sprouts"],
    ["Georgian cooking", "khachapuri, tkemali, adjika, walnuts, pomegranate, sulguni"],
    ["Sichuan cooking", "Sichuan peppercorn, doubanjiang, chili oil, fermented black beans"],
    ["Pakistani cuisine", "basmati rice, yogurt, cardamom, nihari, seekh kebab"],
    ["Taiwanese street food", "bubble tea, stinky tofu, gua bao, scallion pancake, oyster omelet"],
  ] as [string, string][]).map(([name, items]) => ({
    theme: name,
    prompt: `List 50 common ${name} ingredients/items with realistic quantities as someone would write in a food diary. Include items like ${items}. Format: one per line with qty and unit, e.g. '2 tbsp fish sauce', '1 cup coconut milk'.`
  })),

  // ── Grocery Aisles (30) ──
  ...([
    ["canned soups and stews", "tomato soup, chili, beef stew, clam chowder"],
    ["canned fish and seafood", "tuna, sardines, salmon, anchovies, crab meat"],
    ["frozen breakfast items", "frozen waffles, breakfast burritos, hash browns"],
    ["frozen Asian meals", "General Tso's, orange chicken, fried rice, potstickers"],
    ["frozen Mexican meals", "frozen burritos, enchiladas, tamales, taquitos"],
    ["salad bar items", "mixed greens, cherry tomatoes, croutons, bacon bits"],
    ["olive bar and antipasto", "marinated artichokes, roasted peppers, feta, olives"],
    ["bulk bin items", "raw almonds, sunflower seeds, dried apricots, trail mix"],
    ["deli counter meats", "prosciutto, salami, turkey breast, roast beef, pastrami"],
    ["bakery department", "sourdough, croissants, brioche, ciabatta, dinner rolls"],
    ["leafy greens varieties", "arugula, romaine, kale, Swiss chard, watercress"],
    ["root vegetables", "parsnips, turnips, sweet potatoes, beets, rutabaga"],
    ["tropical fruits", "mango, papaya, dragonfruit, passion fruit, guava"],
    ["cheese counter", "brie, gouda, aged cheddar, manchego, gruyère, pecorino"],
    ["specialty cheese imports", "burrata, mascarpone, Roquefort, Comté, Stilton"],
    ["fresh pasta varieties", "ravioli, tortellini, gnocchi, fettuccine, pappardelle"],
    ["dried pasta shapes", "penne, rigatoni, orzo, farfalle, bucatini, cavatappi"],
    ["bread varieties", "pumpernickel, rye, challah, focaccia, naan, pita"],
    ["tortilla varieties", "corn tortillas, flour tortillas, low-carb wraps"],
    ["nut butters", "almond butter, cashew butter, sunflower seed butter, tahini"],
    ["seed varieties", "chia seeds, flax seeds, hemp hearts, pumpkin seeds, sesame"],
    ["cooking oils", "avocado oil, sesame oil, coconut oil, grapeseed oil, walnut oil"],
    ["vinegar varieties", "apple cider vinegar, sherry vinegar, champagne vinegar, malt"],
    ["specialty flours", "almond flour, coconut flour, tapioca, chickpea flour, rye"],
    ["sugar varieties", "coconut sugar, turbinado, muscovado, powdered, maple sugar"],
    ["canned tomato products", "crushed tomatoes, tomato paste, fire-roasted, San Marzano"],
    ["broth and stock varieties", "bone broth, vegetable stock, mushroom broth, dashi"],
    ["hot sauce varieties", "Tabasco, Frank's RedHot, Cholula, Valentina, Crystal"],
    ["salad dressing varieties", "ranch, Caesar, vinaigrette, blue cheese, thousand island"],
    ["pickle and fermented", "dill pickles, kimchi, sauerkraut, pickled jalapeños, capers"],
  ] as [string, string][]).map(([name, items]) => ({
    theme: name,
    prompt: `List 50 specific ${name} with realistic quantities. Include items like ${items}. Mix branded and generic. One per line, e.g. '1 can Campbell's Tomato Soup', '2 tbsp Tabasco'.`
  })),

  // ── Dietary & Lifestyle (30) ──
  ...([
    ["keto meals", "cauliflower rice, heavy cream, MCT oil, pork rinds, avocado"],
    ["vegan protein sources", "tempeh, seitan, edamame, nutritional yeast, hemp seeds"],
    ["vegan cheese/meat alternatives", "Beyond Burger, Daiya cheese, Impossible meat, Just Egg"],
    ["paleo ingredients", "sweet potato, ghee, coconut aminos, arrowroot, cassava flour"],
    ["Whole30 compliant items", "compliant mayo, coconut aminos, almond butter, dates"],
    ["gluten-free alternatives", "GF pasta, almond flour bread, rice flour, xanthan gum"],
    ["high-protein meal prep", "chicken breast, Greek yogurt, egg whites, cottage cheese"],
    ["bodybuilding staples", "brown rice, sweet potato, tilapia, broccoli, oats, whey"],
    ["diabetic-friendly snacks", "sugar-free Jello, cheese sticks, celery with PB, nuts"],
    ["heart-healthy foods", "salmon, walnuts, oats, berries, dark chocolate, olive oil"],
    ["anti-inflammatory foods", "turmeric, ginger, fatty fish, leafy greens, berries"],
    ["FODMAP-friendly items", "firm tofu, lactose-free milk, rice, oats, maple syrup"],
    ["Weight Watchers meals", "lean cuisine, 0-point foods, light bread, fat-free yogurt"],
    ["carnivore diet", "ribeye, bacon, butter, bone marrow, tallow, eggs, liver"],
    ["Mediterranean diet", "olive oil, whole grains, chickpeas, fish, red wine, figs"],
    ["baby-led weaning foods", "avocado strips, banana, sweet potato, egg yolk, toast"],
    ["post-workout foods", "protein shake, banana, chicken, rice, electrolyte drink"],
    ["intermittent fasting meals", "bone broth, black coffee, large salad, grilled chicken"],
    ["meal replacement items", "Soylent, Huel, Premier Protein, Ensure, SlimFast"],
    ["sugar-free products", "sugar-free syrup, Stevia, monk fruit, sugar-free candy"],
    ["organic produce items", "organic spinach, organic strawberries, organic chicken"],
    ["plant-based milk", "oat milk, almond milk, soy milk, cashew milk, coconut milk"],
    ["probiotic foods", "kefir, kombucha, miso, tempeh, sauerkraut, kimchi, yogurt"],
    ["high-fiber foods", "black beans, chia seeds, artichoke, raspberries, lentils"],
    ["iron-rich foods", "liver, spinach, red meat, lentils, tofu, dark chocolate"],
    ["calcium-rich foods", "milk, yogurt, sardines, kale, tofu, fortified orange juice"],
    ["low-calorie snacks", "rice cakes, air-popped popcorn, cucumber, watermelon"],
    ["collagen-rich foods", "bone broth, chicken skin, fish skin, egg whites, gelatin"],
    ["adaptogen ingredients", "ashwagandha, reishi, lion's mane, maca, cordyceps"],
    ["superfood smoothie items", "acai, spirulina, wheatgrass, cacao nibs, goji berries"],
  ] as [string, string][]).map(([name, items]) => ({
    theme: name,
    prompt: `List 50 common ${name} with realistic quantities as food diary entries. Include items like ${items}. One per line, e.g. '1 scoop whey protein', '1 cup Greek yogurt'.`
  })),

  // ── Beverages (20) ──
  ...([
    ["Starbucks drinks", "Grande Latte, Frappuccino, cold brew, matcha latte, chai"],
    ["Dunkin drinks", "medium iced coffee, donut, munchkins, coolatta"],
    ["coffee shop orders", "pour over, espresso, cappuccino, mocha, cold brew nitro"],
    ["craft beer", "IPA, stout, pilsner, wheat beer, sour, porter, lager"],
    ["wine varieties", "Cabernet Sauvignon, Chardonnay, Pinot Noir, Rosé, Prosecco"],
    ["cocktail ingredients", "vodka, simple syrup, bitters, lime juice, triple sec"],
    ["smoothie ingredients", "frozen banana, spinach, protein powder, almond milk, honey"],
    ["juice bar items", "cold-pressed green juice, wheatgrass shot, acai bowl"],
    ["energy drinks by brand", "Red Bull, Monster, Celsius, Bang, Reign, 5-hour Energy"],
    ["sports drinks", "Gatorade, Powerade, Body Armor, Liquid IV, LMNT"],
    ["herbal teas", "chamomile, peppermint, ginger tea, hibiscus, echinacea"],
    ["specialty coffee drinks", "Vietnamese coffee, Turkish coffee, affogato, cortado"],
    ["bubble tea", "boba pearls, taro milk tea, jasmine green tea, aloe vera"],
    ["non-alcoholic drinks", "Heineken 0.0, Athletic Brewing, Seedlip, sparkling water"],
    ["milkshakes and malts", "vanilla shake, chocolate malt, strawberry milkshake"],
    ["horchata and agua fresca", "horchata, jamaica, tamarind, cucumber lime, mango"],
    ["protein drinks by brand", "Fairlife, Muscle Milk, Orgain, Core Power, Premier Protein"],
    ["hot chocolate varieties", "Swiss Miss, Ghirardelli, Mexican hot chocolate, matcha latte"],
    ["sparkling water brands", "La Croix, Topo Chico, Perrier, San Pellegrino, Spindrift"],
    ["kombucha brands", "GT's Kombucha, Health-Ade, Humm, Kevita, Brew Dr."],
  ] as [string, string][]).map(([name, items]) => ({
    theme: name,
    prompt: `List 50 specific ${name} with realistic quantities as food diary entries. Include items like ${items}. One per line, e.g. '1 Grande Starbucks Caramel Macchiato', '12 oz Red Bull'.`
  })),

  // ── Restaurant Chains (20) ──
  ...([
    ["McDonald's menu", "Big Mac, Quarter Pounder, McNuggets, McFlurry, Egg McMuffin"],
    ["Chick-fil-A menu", "Original Chicken Sandwich, nuggets, waffle fries, lemonade"],
    ["Subway sandwiches", "6-inch turkey sub, Italian BMT, Veggie Delight, cookies"],
    ["Taco Bell items", "Crunchwrap Supreme, Baja Blast, bean burrito, nachos"],
    ["Pizza Hut items", "Personal Pan Pizza, breadsticks, stuffed crust, wings"],
    ["Domino's items", "medium pepperoni pizza, cheesy bread, chicken wings, lava cake"],
    ["Wendy's menu", "Dave's Single, Frosty, baked potato, spicy nuggets, chili"],
    ["Panda Express", "Orange Chicken, Beijing Beef, chow mein, fried rice"],
    ["Olive Garden", "breadsticks, Alfredo, chicken parm, minestrone, tiramisu"],
    ["Chipotle items", "burrito bowl, carnitas, guacamole, chips and salsa, queso"],
    ["In-N-Out", "Double-Double, animal style fries, Neapolitan shake"],
    ["Five Guys", "cheeseburger, cajun fries, vanilla milkshake, hot dog"],
    ["Shake Shack", "ShackBurger, crinkle fries, concrete, chicken shack"],
    ["Popeyes items", "chicken sandwich, red beans and rice, biscuit, coleslaw"],
    ["Panera Bread", "broccoli cheddar soup, Caesar salad, bakery items, Mac"],
    ["Starbucks food items", "egg bites, cake pop, croissant, protein box, oatmeal"],
    ["Wingstop items", "lemon pepper wings, ranch, cajun fried corn, fries"],
    ["Raising Cane's", "chicken fingers, Cane's sauce, Texas toast, coleslaw"],
    ["Crumbl Cookies", "pink sugar cookie, chocolate chip, weekly rotating flavors"],
    ["Dutch Bros drinks", "Rebel energy, Annihilator, caramelizer, soft top"],
  ] as [string, string][]).map(([name, items]) => ({
    theme: name,
    prompt: `List 50 specific ${name} items with realistic portions as food diary entries. Include items like ${items}. One per line, e.g. '1 Big Mac', '6 piece Chicken McNuggets'.`
  })),

  // ── Prepared & Composite (20) ──
  ...([
    ["homemade pasta dishes", "spaghetti bolognese, mac and cheese, alfredo, lasagna"],
    ["casseroles and bakes", "green bean casserole, tuna casserole, enchilada bake"],
    ["homemade soups", "chicken noodle, tomato bisque, minestrone, potato leek"],
    ["meal prep containers", "chicken + rice + broccoli, steak + sweet potato + asparagus"],
    ["salad combinations", "Caesar salad, Cobb salad, Greek salad, taco salad"],
    ["sandwich varieties", "BLT, club sandwich, grilled cheese, Reuben, Cuban"],
    ["breakfast combos", "eggs benedict, pancakes with bacon, avocado toast, omelet"],
    ["dinner plates", "pot roast with veggies, fish tacos, stir fry with rice"],
    ["appetizers and party food", "spinach dip, bruschetta, meatballs, stuffed mushrooms"],
    ["holiday meal items", "turkey, stuffing, cranberry sauce, green bean casserole"],
    ["BBQ and grilling", "pulled pork, ribs, brisket, corn on the cob, coleslaw"],
    ["pizza varieties", "margherita, pepperoni, supreme, Hawaiian, white pizza"],
    ["taco varieties", "fish tacos, al pastor, carnitas, birria, breakfast tacos"],
    ["rice bowl varieties", "poke bowl, bibimbap, teriyaki bowl, burrito bowl"],
    ["wrap varieties", "chicken Caesar wrap, Mediterranean wrap, Thai peanut wrap"],
    ["soup and salad combo", "French onion + wedge salad, tomato soup + grilled cheese"],
    ["brunch items", "eggs florentine, shakshuka, French toast, frittata, quiche"],
    ["potluck dishes", "seven layer dip, deviled eggs, pasta salad, brownies"],
    ["comfort food classics", "meatloaf, pot pie, chicken fried steak, beef stroganoff"],
    ["one-pot meals", "jambalaya, chili con carne, chicken cacciatore, curry"],
  ] as [string, string][]).map(([name, items]) => ({
    theme: name,
    prompt: `List 50 specific ${name} with realistic portions as food diary entries. Include ${items}. One per line, e.g. '1 cup chicken noodle soup', '2 slices pepperoni pizza'.`
  })),

  // ── Specialty & Niche (20) ──
  ...([
    ["Trader Joe's items", "mandarin chicken, cauliflower gnocchi, Everything seasoning"],
    ["Costco/Kirkland items", "rotisserie chicken, Kirkland protein bars, sheet cake"],
    ["Aldi store brand", "Simply Nature, Friendly Farms, Specially Selected items"],
    ["Whole Foods 365 brand", "organic milk, grain-free chips, sparkling water"],
    ["supplements and vitamins", "fish oil, vitamin D, B12, creatine, magnesium, zinc"],
    ["baby food and formula", "Gerber, Earth's Best, Enfamil, puffs, pouches"],
    ["camping and hiking food", "dehydrated meals, trail mix, jerky, energy gels, MRE"],
    ["hospital/medical diet", "clear broth, Jello, crackers, ginger ale, plain rice"],
    ["college dorm food", "ramen, Easy Mac, Hot Pockets, granola bars, Red Bull"],
    ["movie theater snacks", "large popcorn, nachos, candy, soda, pretzel bites"],
    ["gas station snacks", "Slim Jim, sunflower seeds, Red Bull, roller hot dog"],
    ["airport food items", "Starbucks, overpriced sandwich, trail mix, water bottle"],
    ["vending machine items", "Snickers, Doritos, M&Ms, Cheetos, Nature Valley bar"],
    ["office pantry items", "K-cup coffee, half and half, sugar packets, tea bags"],
    ["food truck items", "Korean BBQ tacos, lobster roll, elote, acai bowl"],
    ["county fair food", "funnel cake, corn dog, deep fried Oreos, cotton candy"],
    ["ice cream shop", "1 scoop vanilla, waffle cone, hot fudge sundae, banana split"],
    ["donut shop items", "glazed donut, Boston cream, maple bar, donut holes"],
    ["smoothie bowl toppings", "granola, coconut flakes, chia seeds, sliced banana, honey"],
    ["charcuterie board", "prosciutto, brie, fig jam, crackers, grapes, almonds"],
  ] as [string, string][]).map(([name, items]) => ({
    theme: name,
    prompt: `List 50 specific ${name} with realistic quantities. Include items like ${items}. One per line, e.g. '1 Trader Joe's Mandarin Orange Chicken (prepared)', '2 scoops creatine monohydrate'.`
  })),
];

// ── Ollama API ──────────────────────────────────────────────────────────────

async function callOllama(prompt: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: 'You are a nutrition assistant. Output ONLY ingredient lines, one per line. No numbering, no headers, no explanations.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.9,
        max_tokens: 4000,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content ?? '';

    return content.split('\n')
      .map((l: string) => l.replace(/^\d+[.)]\s*/, '').replace(/^\*+\s*/, '').replace(/^-\s*/, '').trim())
      .filter((l: string) => l.length > 3 && l.length < 200)
      .filter((l: string) => !l.startsWith('#'))
      .filter((l: string) => !/^(here|these|the|note|i |let)/i.test(l));
  } catch (err) {
    clearTimeout(timeout);
    console.error(`  ❌ Ollama error: ${(err as Error).message?.slice(0, 80)}`);
    return [];
  }
}

// ── Mapping ─────────────────────────────────────────────────────────────────

const seen = new Set<string>();

async function mapLine(line: string): Promise<boolean> {
  const key = line.toLowerCase().trim();
  if (seen.has(key)) { totalSkipped++; return false; }
  seen.add(key);

  try {
    const result = await mapIngredientWithFallback(line, { skipAiValidation: true, allowLiveFallback: true });
    if (result && 'foodName' in result) {
      totalMapped++;
      console.log(`  ✅ ${line} → ${result.foodName} [${result.source}]`);
      return true;
    }
    totalFailed++;
    return false;
  } catch {
    totalFailed++;
    return false;
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const startIdx = Number(process.argv.find(a => a.startsWith('--start='))?.split('=')[1] ?? '0');

  console.log('\n🏠 Expanded Ollama Ingredient Seeder');
  console.log(`   Model: ${OLLAMA_MODEL}`);
  console.log(`   Themes: ${THEMES.length} (starting at #${startIdx})`);
  console.log(`   Target: ~${THEMES.length * 50} ingredient lines\n`);

  // Verify Ollama
  try {
    const res = await fetch(`${OLLAMA_BASE_URL.replace('/v1', '')}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('not ok');
    console.log('✅ Ollama is reachable\n');
  } catch {
    console.error('❌ Cannot reach Ollama. Make sure it is running.'); process.exit(1);
  }

  const startTime = Date.now();

  for (let i = startIdx; i < THEMES.length; i++) {
    const { theme, prompt } = THEMES[i];
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🧠 [${i + 1}/${THEMES.length}] ${theme}`);
    console.log(`${'='.repeat(60)}\n`);

    const lines = await callOllama(prompt);
    totalGenerated += lines.length;
    console.log(`📦 Got ${lines.length} lines\n`);

    if (lines.length === 0) continue;

    for (const line of lines) {
      await mapLine(line);
      await sleep(DELAY_BETWEEN_ITEMS_MS);
    }

    const elapsed = Math.round((Date.now() - startTime) / 60000);
    console.log(`\n📊 Progress: Generated=${totalGenerated} Mapped=${totalMapped} Skipped=${totalSkipped} Failed=${totalFailed} (${elapsed}min)`);

    if (i < THEMES.length - 1) await sleep(DELAY_BETWEEN_BATCHES_MS);
  }

  const totalElapsed = Math.round((Date.now() - startTime) / 60000);
  console.log('\n' + '='.repeat(60));
  console.log('🏁 EXPANDED SEEDER COMPLETE');
  console.log('='.repeat(60));
  console.log(`   Total generated: ${totalGenerated}`);
  console.log(`   Mapped: ${totalMapped}`);
  console.log(`   Skipped: ${totalSkipped}`);
  console.log(`   Failed: ${totalFailed}`);
  console.log(`   Success rate: ${totalGenerated > 0 ? ((totalMapped / totalGenerated) * 100).toFixed(1) : 0}%`);
  console.log(`   Runtime: ${totalElapsed} minutes\n`);
}

main().then(() => process.exit(0)).catch(e => { console.error('Fatal:', e); process.exit(1); });
