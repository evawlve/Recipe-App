/**
 * verify-vm-nutrition.ts
 *
 * Verifies ALL ValidatedMappings for nutritional soundness (not just mathematical
 * plausibility). Joins each VM to its source cache to retrieve macro data.
 *
 *  - First HALF  → sent to OpenRouter AI for semantic nutritional review.
 *                  Flagged entries printed to console + written to
 *                  logs/vm-nutrition-ai-flagged-<date>.json
 *
 *  - Second HALF → written as a human-readable mapping-summary log to
 *                  logs/vm-nutrition-review-<date>.txt for IDE agent review.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register tmp/verify-vm-nutrition.ts
 *
 * Optional env overrides:
 *   AI_BATCH_SIZE=30           # mappings per AI prompt (default 25)
 *   AI_CONCURRENCY=8           # parallel AI requests (default 6)
 *   CHEAP_AI_MODEL_PRIMARY     # OpenRouter model slug (default mistralai/mistral-nemo)
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
// gemini-flash has much better nutritional knowledge than mistral-nemo, far fewer false positives
const MODEL = process.env.CHEAP_AI_MODEL_PRIMARY || 'google/gemini-flash-1.5-8b';
const BATCH_SIZE = parseInt(process.env.AI_BATCH_SIZE || '25', 10);
const CONCURRENCY = parseInt(process.env.AI_CONCURRENCY || '8', 10);

// ─── Types ────────────────────────────────────────────────────────────────────

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
  aiConfidence: number;
  nutrition: NutritionSnapshot;
}

// ─── Nutrition Hydration ──────────────────────────────────────────────────────

function extractJsonMacros(json: unknown): NutritionSnapshot {
  if (!json || typeof json !== 'object') {
    return { caloriesPer100g: null, proteinPer100g: null, carbsPer100g: null, fatPer100g: null };
  }
  const n = json as Record<string, unknown>;
  return {
    // OFF stores energy as 'kcal', FatSecret/FDC use 'calories' — handle both
    caloriesPer100g: n.calories != null ? Number(n.calories)
                   : n.kcal     != null ? Number(n.kcal)
                   : null,
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

  const offIds    = vms.filter(v => v.source === 'openfoodfacts' || v.foodId.startsWith('off_')).map(v => v.foodId);
  // FDC — VMs store foodId as 'fdc_<numeric>' (e.g. 'fdc_380742'), not a bare integer
  const fdcIds    = vms
    .filter(v => v.source === 'fdc')
    .map(v => ({ vmFoodId: v.foodId, numericId: Number(v.foodId.replace(/^fdc_/, '')) }))
    .filter(({ numericId }) => !isNaN(numericId));
  const fsIds     = vms.filter(v => v.source === 'fatsecret').map(v => v.foodId);
  const aiIds     = vms.filter(v => v.source === 'ai').map(v => v.foodId);

  // OFF
  if (offIds.length) {
    const rows = await prisma.openFoodFactsCache.findMany({
      where: { id: { in: offIds } },
      select: { id: true, nutrientsPer100g: true },
    });
    for (const r of rows) result.set(r.id, extractJsonMacros(r.nutrientsPer100g));
  }

  // FDC
  if (fdcIds.length) {
    const rows = await prisma.fdcFoodCache.findMany({
      where: { id: { in: fdcIds.map(({ numericId }) => numericId) } },
      select: { id: true, nutrients: true },
    });
    // Re-key by original 'fdc_<id>' string to match VM's foodId
    for (const r of rows) result.set(`fdc_${r.id}`, extractJsonMacros(r.nutrients));
  }

  // FatSecret
  if (fsIds.length) {
    const rows = await prisma.fatSecretFoodCache.findMany({
      where: { id: { in: fsIds } },
      select: { id: true, nutrientsPer100g: true },
    });
    for (const r of rows) result.set(r.id, extractJsonMacros(r.nutrientsPer100g));
  }

  // AI-generated
  if (aiIds.length) {
    const rows = await prisma.aiGeneratedFood.findMany({
      where: { id: { in: aiIds } },
      select: { id: true, caloriesPer100g: true, proteinPer100g: true, carbsPer100g: true, fatPer100g: true },
    });
    for (const r of rows) {
      result.set(r.id, {
        caloriesPer100g: r.caloriesPer100g,
        proteinPer100g:  r.proteinPer100g,
        carbsPer100g:    r.carbsPer100g,
        fatPer100g:      r.fatPer100g,
      });
    }
  }

  // Fill any that had no cache row with empty
  for (const vm of vms) {
    if (!result.has(vm.foodId)) result.set(vm.foodId, empty);
  }

  return result;
}

// ─── AI Review (First Half) ───────────────────────────────────────────────────

function formatNutrition(n: NutritionSnapshot): string {
  const fmt = (v: number | null, unit: string) => v != null ? `${v.toFixed(1)}${unit}` : '?';
  return `Cal:${fmt(n.caloriesPer100g, 'kcal')} P:${fmt(n.proteinPer100g, 'g')} C:${fmt(n.carbsPer100g, 'g')} F:${fmt(n.fatPer100g, 'g')} (per 100g)`;
}

async function evaluateBatch(batch: EnrichedVM[], attempt = 1): Promise<string[]> {
  // Only called for entries that already HAVE calorie data — skip null-calorie entries upstream
  const lines = batch.map(m => {
    const brand = m.brandName ? `[${m.brandName}] ` : '';
    return `${m.id}: [${m.rawIngredient}] -> ${brand}${m.foodName} | ${formatNutrition(m.nutrition)}`;
  });

  const prompt = `You are an expert food scientist reviewing ingredient-to-food database mappings.
All entries below HAVE calorie data. Your job is to catch CLEAR nutritional errors only.

Flag an entry ONLY when macros are unambiguously wrong for the food category:
   BAD: Chicken breast -> 40g fat/100g (lean breast should be ~3g)
   BAD: Olive oil -> 5g fat/100g (pure oil should be ~99g)
   BAD: Table sugar -> 0g carbs (sugar is 100% carbs ~387 kcal)
   BAD: Butter -> 0g fat (butter is ~81g fat)
   BAD: Lettuce -> 500 kcal/100g (should be ~15 kcal)
   BAD: Whey protein -> 70g carbs (should be ~10g)
   BAD: Ghee with 53g protein/100g (pure clarified fat — 0 protein)
   BAD: Semantic mismatch (apple ingredient mapped to a meat product)

NEVER flag these — they are always nutritionally correct:
   OK: Pure oils (olive, canola, coconut, sesame, avocado): 800-920 kcal, ~100g fat
   OK: Dry spices & herbs (cumin, paprika, garlic powder, basil, thyme): 250-450 kcal (concentrated)
   OK: Low-calorie vegetables (lettuce, cucumber, tomato, pepper, carrot): 15-80 kcal
   OK: Erythritol/monk fruit/sucralose sweeteners: 0 kcal with high carbs (non-digestible)
   OK: Alcoholic beverages (wine, spirits) and vanilla extract: P+C+F won't match kcal (alcohol = 7 kcal/g)
   OK: Diet drinks, plain teas, vinegars: 0-15 kcal
   OK: Dry goods measured per 100g (grains, flours, pasta, crackers, nuts): 300-600 kcal
   OK: Branded version of a generic food
   OK: +/-25% caloric variance from expected

Return ONLY a valid JSON array of the problem IDs. Return [] if nothing is clearly wrong.
No explanations, no markdown — just the raw JSON array.

Entries:
${lines.join('\n')}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      }),
    });

    if (!response.ok) {
      console.error(`  [AI] HTTP ${response.status} on attempt ${attempt}`);
      if (attempt < 3) return evaluateBatch(batch, attempt + 1);
      return [];
    }

    const data = await response.json();
    const content = (data.choices?.[0]?.message?.content ?? '').trim();
    const match = content.match(/\[.*\]/s);
    if (match) return (JSON.parse(match[0]) as unknown[]).map(String);
    return [];
  } catch (err) {
    if (attempt < 3) return evaluateBatch(batch, attempt + 1);
    console.error('  [AI] Evaluation error:', err);
    return [];
  }
}

interface AiReviewResult {
  flagged: EnrichedVM[];
  noNutrition: EnrichedVM[];
}

async function runAiReview(vms: EnrichedVM[]): Promise<AiReviewResult> {
  // Pre-split: only send entries with at least calorie data to the AI.
  // Entries with null calories are segregated as 'no-nutrition' — they're a
  // data-completeness problem, not a nutritional soundness problem.
  const withNutrition = vms.filter(v => v.nutrition.caloriesPer100g != null);
  const noNutrition   = vms.filter(v => v.nutrition.caloriesPer100g == null);

  console.log(`\n[AI REVIEW] ${vms.length} total VMs`);
  console.log(`  With calorie data (sent to AI) : ${withNutrition.length}`);
  console.log(`  Missing calorie data (skipped)  : ${noNutrition.length}`);


  const batches: EnrichedVM[][] = [];
  for (let i = 0; i < withNutrition.length; i += BATCH_SIZE) {
    batches.push(withNutrition.slice(i, i + BATCH_SIZE));
  }
  console.log(`  Sending ${batches.length} batches (model: ${MODEL}, concurrency: ${CONCURRENCY})`);

  const flagged: EnrichedVM[] = [];
  let completed = 0;
  let batchIndex = 0;

  async function worker() {
    while (batchIndex < batches.length) {
      const idx = batchIndex++;
      const batch = batches[idx];
      const flaggedIds = await evaluateBatch(batch);
      completed++;

      if (completed % 10 === 0 || flaggedIds.length > 0) {
        console.log(`  Progress: ${completed}/${batches.length} batches | flagged so far: ${flagged.length}`);
      }

      for (const fid of flaggedIds) {
        const m = batch.find(x => x.id === fid);
        if (m) {
          flagged.push(m);
          console.log(`  [FLAGGED] [${m.rawIngredient}] -> [${m.brandName ?? ''}] ${m.foodName} | ${formatNutrition(m.nutrition)}`);
        }
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, worker);
  await Promise.all(workers);

  return { flagged, noNutrition };
}

// ─── Log File (Second Half) ───────────────────────────────────────────────────

function buildLogLine(vm: EnrichedVM): string {
  const n = vm.nutrition;
  const brand = vm.brandName ? ` [${vm.brandName}]` : '';
  const src = vm.source.toUpperCase().padEnd(14);
  const conf = (vm.aiConfidence * 100).toFixed(0).padStart(3);
  const cals = n.caloriesPer100g != null ? n.caloriesPer100g.toFixed(1).padStart(7) : '      ?';
  const prot = n.proteinPer100g  != null ? n.proteinPer100g.toFixed(1).padStart(6)  : '     ?';
  const carb = n.carbsPer100g    != null ? n.carbsPer100g.toFixed(1).padStart(6)    : '     ?';
  const fat  = n.fatPer100g      != null ? n.fatPer100g.toFixed(1).padStart(6)      : '     ?';

  return (
    `[${src}] conf:${conf}% | ` +
    `${cals}kcal  P:${prot}g  C:${carb}g  F:${fat}g  | ` +
    `"${vm.rawIngredient}" -> ${brand} ${vm.foodName}`
  );
}

function writeLogFile(vms: EnrichedVM[], filePath: string) {
  const lines: string[] = [
    '# VM Nutrition Review Log — Second Half (for IDE Agent Review)',
    `# Generated: ${new Date().toISOString()}`,
    `# Total entries: ${vms.length}`,
    `# Columns: [SOURCE] conf:XX% | kcal/100g  Protein  Carbs  Fat  | "raw ingredient" -> [Brand] Food Name`,
    '#',
    '# REVIEW GUIDE — flag any of these:',
    '#   • Calories wildly inconsistent with the ingredient type',
    '#   • All macros are 0 or null for a caloric food',
    '#   • Fat modifier mismatch (e.g., "skim milk" mapped to full-fat)',
    '#   • Semantic inversion (e.g., "chicken breast" -> "duck confit")',
    '#   • Extremely high protein for a non-protein food',
    '#   • Extreme weight bloat in serving (noted via raw ingredient context)',
    '#',
    `# Source breakdown: OFF(off_*), FDC(numeric), FatSecret(other), AI(ai-generated)`,
    '',
    '=' .repeat(120),
    '',
  ];

  // Group by source for easier scanning
  const groups: Record<string, EnrichedVM[]> = {};
  for (const vm of vms) {
    const key = vm.source;
    if (!groups[key]) groups[key] = [];
    groups[key].push(vm);
  }

  for (const [source, entries] of Object.entries(groups)) {
    lines.push(`── ${source.toUpperCase()} (${entries.length} entries) ${'─'.repeat(80)}`);
    lines.push('');
    for (const vm of entries) {
      lines.push(buildLogLine(vm));
    }
    lines.push('');
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set in environment');
  }

  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

  const dateStr = new Date().toISOString().slice(0, 10);
  const aiOutputPath  = path.join(logsDir, `vm-nutrition-ai-flagged-${dateStr}.json`);
  const logOutputPath = path.join(logsDir, `vm-nutrition-review-${dateStr}.txt`);

  // ── 1. Load all VMs
  console.log('Loading all ValidatedMappings...');
  const rawVms = await prisma.validatedMapping.findMany({
    select: {
      id: true,
      rawIngredient: true,
      normalizedForm: true,
      foodId: true,
      foodName: true,
      brandName: true,
      source: true,
      aiConfidence: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`  Found ${rawVms.length} total ValidatedMappings`);

  // ── 2. Hydrate nutrition from source caches
  console.log('Hydrating nutrition data from source caches...');
  const nutritionMap = await hydrateNutrition(rawVms.map(v => ({ id: v.id, foodId: v.foodId, source: v.source })));

  const enriched: EnrichedVM[] = rawVms.map(vm => ({
    ...vm,
    nutrition: nutritionMap.get(vm.foodId) ?? { caloriesPer100g: null, proteinPer100g: null, carbsPer100g: null, fatPer100g: null },
  }));

  // ── 3. Source breakdown
  const sourceCounts = rawVms.reduce<Record<string, number>>((acc, v) => {
    acc[v.source] = (acc[v.source] ?? 0) + 1;
    return acc;
  }, {});
  console.log('\nSource breakdown:');
  for (const [src, count] of Object.entries(sourceCounts)) {
    console.log(`  ${src.padEnd(16)} ${count}`);
  }

  // ── 4. Full AI review of all VMs
  const { flagged, noNutrition } = await runAiReview(enriched);

  const withNutritionCount = enriched.filter(v => v.nutrition.caloriesPer100g != null).length;
  console.log(`\n[AI REVIEW] Complete.`);
  console.log(`  Total VMs             : ${enriched.length}`);
  console.log(`  With calorie data     : ${withNutritionCount}`);
  console.log(`  Flagged as bad        : ${flagged.length} (${((flagged.length / Math.max(withNutritionCount, 1)) * 100).toFixed(1)}%)`);
  console.log(`  No-nutrition entries  : ${noNutrition.length}`);

  fs.writeFileSync(aiOutputPath, JSON.stringify(flagged, null, 2));
  console.log(`  AI flagged results  → ${aiOutputPath}`);

  const noNutritionPath = path.join(logsDir, `vm-no-nutrition-${dateStr}.json`);
  fs.writeFileSync(noNutritionPath, JSON.stringify(noNutrition, null, 2));
  console.log(`  No-nutrition entries→ ${noNutritionPath}`);

  // ── 5. Summary
  console.log('\n' + '='.repeat(60));
  console.log('VERIFICATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total VMs checked         : ${enriched.length}`);
  console.log(`With calorie data         : ${withNutritionCount}  →  ${flagged.length} flagged bad (${((flagged.length / Math.max(withNutritionCount, 1)) * 100).toFixed(1)}%)`);
  console.log(`Missing calorie data      : ${noNutrition.length}  →  logged to no-nutrition file`);
  console.log(`Outputs:`);
  console.log(`  AI flagged  → ${aiOutputPath}`);
  console.log(`  No-nutrition→ ${noNutritionPath}`);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
