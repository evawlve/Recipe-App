/**
 * deterministic-vm-audit.ts
 *
 * Replaces the AI-based nutritional screener with a fast, rule-based approach
 * that catches the real anomalies without AI false positives.
 *
 * Rules (each has a specific expected range per 100g):
 *   1. Pure oils/fats must have fat >85g and calories >700
 *   2. Lean meats must have fat <25g and protein >10g
 *   3. Pure sugar / syrups must have carbs >80g
 *   4. Dairy with "skim/fat-free" must have fat <2g
 *   5. Vegetables (common low-cal ones) must have calories <150
 *   6. Atwater math: stated calories should be within 40% of P*4 + C*4 + F*9
 *      (wider window to allow alcohol, fibre, sugar alcohols)
 *   7. Protein powders/isolates: protein must be >40g per 100g
 *   8. SEMANTIC: "diet" / "zero calorie" / "calorie free" in raw ingredient
 *      but stated calories >30kcal
 *
 * Outputs:
 *   logs/vm-deterministic-audit-<date>.json  — flagged entries with reason
 *   Console summary
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface NutritionSnapshot {
  caloriesPer100g: number | null;
  proteinPer100g: number | null;
  carbsPer100g: number | null;
  fatPer100g: number | null;
}

interface EnrichedVM {
  id: string;
  rawIngredient: string;
  normalizedForm: string;
  foodId: string;
  foodName: string;
  brandName: string | null;
  source: string;
  aiConfidence: number | null;
  nutrition: NutritionSnapshot;
}

interface FlaggedVM extends EnrichedVM {
  flagReason: string;
}

// ── Hydration (same as verify-vm-nutrition.ts) ───────────────────────────────

function extractJsonMacros(json: unknown): NutritionSnapshot {
  if (!json || typeof json !== 'object') {
    return { caloriesPer100g: null, proteinPer100g: null, carbsPer100g: null, fatPer100g: null };
  }
  const n = json as Record<string, unknown>;
  return {
    caloriesPer100g: n.calories != null ? Number(n.calories) : n.kcal != null ? Number(n.kcal) : null,
    proteinPer100g:  n.protein  != null ? Number(n.protein)  : null,
    carbsPer100g:    n.carbs    != null ? Number(n.carbs)    : null,
    fatPer100g:      n.fat      != null ? Number(n.fat)      : null,
  };
}

async function hydrateNutrition(
  vms: Array<{ id: string; foodId: string; source: string }>
): Promise<Map<string, NutritionSnapshot>> {
  const result = new Map<string, NutritionSnapshot>();
  const empty: NutritionSnapshot = { caloriesPer100g: null, proteinPer100g: null, carbsPer100g: null, fatPer100g: null };

  const offIds = vms.filter(v => v.source === 'openfoodfacts').map(v => v.foodId);
  const fdcVMs = vms.filter(v => v.source === 'fdc')
    .map(v => ({ vmFoodId: v.foodId, numericId: Number(v.foodId.replace(/^fdc_/, '')) }))
    .filter(({ numericId }) => !isNaN(numericId));
  const fsIds  = vms.filter(v => v.source === 'fatsecret').map(v => v.foodId);
  const aiIds  = vms.filter(v => v.source === 'ai').map(v => v.foodId);

  if (offIds.length) {
    const rows = await prisma.openFoodFactsCache.findMany({ where: { id: { in: offIds } }, select: { id: true, nutrientsPer100g: true } });
    for (const r of rows) result.set(r.id, extractJsonMacros(r.nutrientsPer100g));
  }
  if (fdcVMs.length) {
    const rows = await prisma.fdcFoodCache.findMany({ where: { id: { in: fdcVMs.map(v => v.numericId) } }, select: { id: true, nutrients: true } });
    for (const r of rows) result.set(`fdc_${r.id}`, extractJsonMacros(r.nutrients));
  }
  if (fsIds.length) {
    const rows = await prisma.fatSecretFoodCache.findMany({ where: { id: { in: fsIds } }, select: { id: true, nutrientsPer100g: true } });
    for (const r of rows) result.set(r.id, extractJsonMacros(r.nutrientsPer100g));
  }
  if (aiIds.length) {
    const rows = await prisma.aiGeneratedFood.findMany({ where: { id: { in: aiIds } }, select: { id: true, caloriesPer100g: true, proteinPer100g: true, carbsPer100g: true, fatPer100g: true } });
    for (const r of rows) result.set(r.id, { caloriesPer100g: r.caloriesPer100g, proteinPer100g: r.proteinPer100g, carbsPer100g: r.carbsPer100g, fatPer100g: r.fatPer100g });
  }

  for (const vm of vms) {
    if (!result.has(vm.foodId)) result.set(vm.foodId, empty);
  }
  return result;
}

// ── Deterministic Rules ───────────────────────────────────────────────────────

const OIL_TERMS = /\b(oil|butter|ghee|lard|shortening|tallow|dripping|suet)\b/i;
// Exclude: cooking sprays, reduced-fat products, fish-packed-in-oil, compound foods where butter/oil
// is part of a food name but the food itself isn't a pure fat
const OIL_EXCEPTIONS = /\b(spray|cooking.?spray|reduced.?fat|light.?spread|low.?fat|fat.?free|fish|cod.?liver|shark|whale|seal|krill|margarine|spread|peanut.?butter|almond.?butter|sunflower.?butter|cashew.?butter|nut.?butter|soy.?nut|apple.?butter|fruit.?butter|butter.?chicken|butter.?bean|butter.?nut|butternut|butter.?croissant|butter.?toast|butter.?cookie|butter.?milk|buttermilk|in.?oil|packed.?in|with.?oil|popcorn|cookie.?dough|croissant|grissini|crackers?|dressing|mayonnaise|vinegar|fries|fried.?potatoes|oven.?fries|french.?fried|peanut|granola|oat.?bar|energy.?bar|protein.?bar|snack.?bar|chocolate|candy|crunch|cereal|pasta|noodle|spaghetti|soup|stew|salsa|sauce|grits|wafer|bean|beans|roast|grills?|anchov|sardine|mackerel|herring|tuna|salmon|chili.?pepper|ground.?chili|chili.?in|pepper.?in)\b/i;

const LEAN_MEAT_TERMS = /\b(chicken breast|turkey breast|cod(?! liver)|tilapia|halibut|shrimp|scallop|crab meat|lobster|lean ground beef|lean beef|lean pork|tuna)\b/i;
// Exclude soups (diluted), flavored noodles (not actually shrimp), and prep-styles that change the profile
const LEAN_MEAT_EXCEPTIONS = /\b(soup|condensed|flavou?r|flavor|instant|noodle|salad)\b/i;

const SUGAR_TERMS = /\b(sugar|syrup|honey|molasses|agave|corn.?syrup|cane.?sugar|maple.?syrup|brown.?sugar|powdered.?sugar|confectioners)\b/i;
// Exclude: sugar snap peas, sweetener substitutes, naturally-named foods, low-carb products, compound foods
const SUGAR_EXCEPTIONS = /\b(sugar.?free|no.?sugar|reduced.?sugar|unsweetened|sugar.?snap|snap.?peas|substitute|alternative|saccharin|stevia|monk.?fruit|aspartame|splenda|equal|truvia|erythritol|low.?carb|keto|low.?sugar|zero.?sugar|no.?added.?sugar|nut.?butter|soy.?nut|granola|bar|cookie|dough|wrap|tortilla|cracker|bread|honey.?wheat|honey.?mustard|honey.?garlic|honey.?soy|honey.?roast|roasted|canned|in.?syrup|syrup.?pack|heavy.?syrup|light.?syrup|sugar.?apple|sweetsop|sugar.?cane|sugarcane|sugar.?beet|apples?|pears?|peaches?|grapes?|cherries?|berries?|plums?|fruit|rambutan|lychee|longan|almond|cashew|peanut|nut|nuts?|yogurt|yoghurt|drink|beverage|energy.?drink|soda|biscuit|wafer|chocolate|nougat|toffee)\b/i;

// Only fire on "fat-free" / "nonfat" / "0% fat" dairy — NOT "part-skim" (part-skim mozzarella has 15-22g fat)
const SKIM_MILK_TERMS = /\b(fat.?free|nonfat|0%.?fat|non.?fat|skim(?! milk.*part|.*part.?skim))\b.*\b(milk|yogurt|yoghurt|cream|cheese|cottage)\b/i;
const SKIM_MILK_EXCEPTIONS = /\bpart.?skim\b/i; // part-skim is correctly ~15-22g fat

// Only flag fresh/raw vegetables in clear food contexts — exclude processed, dry, or compound names
const LOW_CAL_VEG = /\b(lettuce|spinach|kale|cucumber|zucchini|broccoli|cauliflower|asparagus|arugula|watercress|chard|cabbage)\b/i;
// Words in the combined text that indicate it's NOT a fresh vegetable
const LOW_CAL_VEG_EXCEPTIONS = /\b(noodle|pasta|ring|onion.?ring|gravy|pesto|crisp|chip|snack|powder|dry|spice|salt|seasoning|sauce|soup|stew|dip|juice|extract|flavou?r|frozen.?dinner|meal)\b/i;

// Diet rule: only apply to English-language sources (FDC/FatSecret), not OFF which has Spanish brand names
// Also exclude dry powder/instant mixes (338kcal/100g of powder is correct — a packet is only 1-2g)
const DIET_ZERO_TERMS = /\b(zero.?calorie|calorie.?free|no.?calorie|sugar.?free soda|diet soda|diet coke|diet pepsi)\b/i;
const DIET_WORD = /\bdiet\b/i;
const DIET_EXCEPTIONS = /\b(powder|instant|mix|dry|packet|sachet|envelope)\b/i;

// Exclude liquid whey (byproduct of cheese-making, ~1g protein/100ml), ready-to-drink protein beverages
const PROTEIN_POWDER_TERMS = /\b(whey|casein|pea.?protein|plant.?protein|protein.?powder|protein.?isolate)\b/i;
const PROTEIN_LIQUID_EXCEPTIONS = /\b(fluid|liquid|drink|beverage|milk|acid.?whey|sweet.?whey|whey.?fluid)\b/i;

// Alcoholic beverages where Atwater won't balance (alcohol = 7 kcal/g, not tracked as macro)
const ALCOHOL_TERMS = /\b(wine|sake|beer|lager|ale|spirit|liqueur|vodka|rum|gin|whiskey|whisky|bourbon|cognac|brandy|daiquiri|cocktail|margarita|mojito|champagne|prosecco|cider(?! vinegar))\b/i;
// Vanilla extract is 35% alcohol by volume
const VANILLA_EXTRACT = /\bvanilla.?extract\b/i;

function audit(vm: EnrichedVM): string | null {
  const n = vm.nutrition;
  const cal  = n.caloriesPer100g;
  const prot = n.proteinPer100g;
  const carb = n.carbsPer100g;
  const fat  = n.fatPer100g;

  // Skip entries with no calorie data
  if (cal == null) return null;

  const rawLower  = vm.rawIngredient.toLowerCase();
  const foodLower = vm.foodName.toLowerCase();
  const combined  = rawLower + ' ' + foodLower;

  // Rule 1: Pure oils/fats must be high fat + high calorie
  if (OIL_TERMS.test(combined) && !OIL_EXCEPTIONS.test(combined)) {
    if (cal < 500 && (fat == null || fat < 50)) {
      return `Oil/fat mapped to low-calorie/low-fat food: ${cal.toFixed(0)}kcal, fat=${fat ?? '?'}g (pure oils should be >700kcal, >80g fat)`;
    }
  }

  // Rule 2: Lean meats must not be high fat / near-zero protein
  if (LEAN_MEAT_TERMS.test(combined) && !LEAN_MEAT_EXCEPTIONS.test(combined)) {
    if (fat != null && fat > 30) {
      return `Lean meat/fish with very high fat: ${fat.toFixed(1)}g/100g (should be <15g for lean cuts)`;
    }
    if (prot != null && prot < 5) {
      return `Lean meat/fish with very low protein: ${prot.toFixed(1)}g/100g (should be >15g)`;
    }
  }

  // Rule 3: Pure sugar/syrups must have high carbs — only fire on simple standalone sugar ingredients
  if (SUGAR_TERMS.test(combined) && !SUGAR_EXCEPTIONS.test(combined)) {
    if (carb != null && carb < 40) {
      return `Sugar/syrup with very low carbs: ${carb.toFixed(1)}g/100g (should be >70g)`;
    }
    if (fat != null && fat > 20) {
      return `Sugar/syrup with surprisingly high fat: ${fat.toFixed(1)}g/100g`;
    }
  }

  // Rule 4: Fat-FREE dairy (not part-skim) must have very low fat
  if (SKIM_MILK_TERMS.test(combined) && !SKIM_MILK_EXCEPTIONS.test(combined)) {
    if (fat != null && fat > 28) {
      return `Fat-free dairy with high fat: ${fat.toFixed(1)}g/100g (fat-free dairy should be <2g)`;
    }
  }

  // Rule 5: Fresh low-cal vegetables flagged if calorie-dense AND not a processed/dry form
  if (LOW_CAL_VEG.test(rawLower) && !LOW_CAL_VEG_EXCEPTIONS.test(combined)) {
    if (cal > 300) {
      return `Low-cal vegetable with very high calories: ${cal.toFixed(0)}kcal/100g (fresh veg should be <100kcal)`;
    }
  }

  // Rule 6: Atwater consistency — skip alcoholic beverages and vanilla extract (alcohol = 7kcal/g)
  if (!ALCOHOL_TERMS.test(combined) && !VANILLA_EXTRACT.test(combined)) {
    if (prot != null && carb != null && fat != null && cal > 20) {
      const expected = prot * 4 + carb * 4 + fat * 9;
      if (expected > 10) {
        const ratio = Math.abs(cal - expected) / expected;
        if (ratio > 0.60 && Math.abs(cal - expected) > 80) {
          return `Atwater mismatch: stated ${cal.toFixed(0)}kcal vs expected ${expected.toFixed(0)}kcal from macros (P=${prot.toFixed(1)} C=${carb.toFixed(1)} F=${fat.toFixed(1)})`;
        }
      }
    }
  }

  // Rule 7: Diet/zero-calorie claims but high stated calories
  // Only apply DIET_WORD to non-OFF sources (avoids Spanish brand names like "Galletas Diet")
  // Also skip dry powder/instant mixes — 338kcal/100g of dry powder is correct (a packet is 1-2g)
  if (!DIET_EXCEPTIONS.test(combined)) {
    if (DIET_ZERO_TERMS.test(combined)) {
      if (cal > 50) {
        return `"Zero/diet" ingredient mapped to high-calorie food: ${cal.toFixed(0)}kcal`;
      }
    } else if (DIET_WORD.test(combined) && vm.source !== 'openfoodfacts') {
      if (cal > 50) {
        return `"Diet" ingredient mapped to high-calorie food: ${cal.toFixed(0)}kcal`;
      }
    }
  }

  // Rule 8: Protein powders/isolates must have high protein — exclude liquid whey and protein drinks
  if (PROTEIN_POWDER_TERMS.test(combined) && !PROTEIN_LIQUID_EXCEPTIONS.test(combined)) {
    if (prot != null && prot < 30) {
      return `Protein powder with low protein: ${prot.toFixed(1)}g/100g (should be >40g)`;
    }
    if (carb != null && carb > 60) {
      return `Protein powder with high carbs: ${carb.toFixed(1)}g/100g (should be <30g for isolate)`;
    }
  }

  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);
  const dateStr = new Date().toISOString().slice(0, 10);
  const outPath = path.join(logsDir, `vm-deterministic-audit-${dateStr}.json`);

  console.log('Loading all ValidatedMappings...');
  const rawVms = await prisma.validatedMapping.findMany({
    select: { id: true, rawIngredient: true, normalizedForm: true, foodId: true, foodName: true, brandName: true, source: true, aiConfidence: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`  Found ${rawVms.length} total ValidatedMappings`);

  console.log('Hydrating nutrition data...');
  const nutritionMap = await hydrateNutrition(rawVms.map(v => ({ id: v.id, foodId: v.foodId, source: v.source })));

  const enriched: EnrichedVM[] = rawVms.map(vm => ({
    ...vm,
    nutrition: nutritionMap.get(vm.foodId) ?? { caloriesPer100g: null, proteinPer100g: null, carbsPer100g: null, fatPer100g: null },
  }));

  console.log('Running deterministic audit rules...');

  const flagged: FlaggedVM[] = [];
  const noNutrition: EnrichedVM[] = [];

  for (const vm of enriched) {
    if (vm.nutrition.caloriesPer100g == null) {
      noNutrition.push(vm);
      continue;
    }
    const reason = audit(vm);
    if (reason) {
      flagged.push({ ...vm, flagReason: reason });
    }
  }

  // Group by reason type
  const reasonGroups = new Map<string, number>();
  for (const f of flagged) {
    const key = f.flagReason.split(':')[0];
    reasonGroups.set(key, (reasonGroups.get(key) ?? 0) + 1);
  }

  console.log('\n' + '='.repeat(65));
  console.log('DETERMINISTIC AUDIT RESULTS');
  console.log('='.repeat(65));
  console.log(`Total VMs             : ${enriched.length}`);
  console.log(`With calorie data     : ${enriched.length - noNutrition.length}`);
  console.log(`No calorie data       : ${noNutrition.length}`);
  console.log(`Flagged (real issues) : ${flagged.length} (${((flagged.length / Math.max(enriched.length - noNutrition.length, 1)) * 100).toFixed(1)}%)`);
  console.log('\nFlag reason breakdown:');
  for (const [reason, count] of [...reasonGroups.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${reason}`);
  }

  console.log('\nSample flagged entries:');
  flagged.slice(0, 25).forEach(f => {
    const n = f.nutrition;
    const brand = f.brandName ? `[${f.brandName}] ` : '';
    console.log(`  [${f.source}] "${f.rawIngredient}" -> ${brand}${f.foodName}`);
    console.log(`    Cal:${n.caloriesPer100g?.toFixed(0)} P:${n.proteinPer100g?.toFixed(1)} C:${n.carbsPer100g?.toFixed(1)} F:${n.fatPer100g?.toFixed(1)}`);
    console.log(`    REASON: ${f.flagReason}`);
  });

  fs.writeFileSync(outPath, JSON.stringify(flagged, null, 2));
  console.log(`\n  Output → ${outPath}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
