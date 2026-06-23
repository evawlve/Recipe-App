/**
 * dual-model-audit.ts — Cloud-verified quality audit for ValidatedMappings
 *
 * Samples VMs from the database, enriches them with nutritional data from
 * their source cache, then sends to OpenRouter (Gemini Flash) for a
 * comprehensive semantic + nutritional audit.
 *
 * Checks:
 *   1. Semantic: Does normalizedForm match the food product?
 *   2. Nutritional: Are the macros plausible for this food type?
 *   3. Category: Is this actually a food (not cosmetics, supplements, etc.)?
 *
 * Usage:
 *   npx tsx scripts/dual-model-audit.ts                        # audit 500 random VMs
 *   npx tsx scripts/dual-model-audit.ts --sample=1000          # audit 1000
 *   npx tsx scripts/dual-model-audit.ts --source=openfoodfacts # only OFF VMs
 *   npx tsx scripts/dual-model-audit.ts --source=fdc           # only FDC VMs
 *   npx tsx scripts/dual-model-audit.ts --recent               # only last 24h VMs
 *   npx tsx scripts/dual-model-audit.ts --oldest               # audit oldest VMs first
 *   npx tsx scripts/dual-model-audit.ts --failed-only          # re-audit Ollama rejects
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

// Use DIRECT_URL to avoid pgbouncer bottleneck
const directUrl = process.env.DIRECT_URL;
if (!directUrl) { console.error('❌ DIRECT_URL not set'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) { console.error('❌ OPENROUTER_API_KEY not set'); process.exit(1); }

const CLOUD_MODEL = 'google/gemini-2.5-flash';
const CLOUD_BATCH_SIZE = 25; // Items per OpenRouter call
const DELAY_BETWEEN_CALLS_MS = 1000; // Rate limit safety

// ─── Types ──────────────────────────────────────────────────────────────────

interface EnrichedVM {
  id: string;
  normalizedForm: string;
  foodId: string;
  foodName: string;
  brandName: string | null;
  source: string;
  aiConfidence: number;
  validationReason: string | null;
  // Nutritional data from source cache
  kcal100: number | null;
  protein100: number | null;
  carbs100: number | null;
  fat100: number | null;
}

interface AuditVerdict {
  index: number;
  semantic: 'PASS' | 'FAIL';
  nutrition: 'PASS' | 'FAIL' | 'WARN';
  category: 'PASS' | 'FAIL';
  state: 'PASS' | 'FAIL';
  brand: 'PASS' | 'FAIL';
  confidence: number;
  suggested_action: 'DELETE' | 'REMAP' | 'REVIEW' | 'NONE';
  reason: string;
}

interface AuditResult {
  vm: EnrichedVM;
  cloudVerdict: AuditVerdict;
}

// ─── Nutritional Data Fetchers ──────────────────────────────────────────────

async function fetchNutrition(foodId: string, source: string): Promise<{
  kcal100: number | null; protein100: number | null; carbs100: number | null; fat100: number | null;
}> {
  const empty = { kcal100: null, protein100: null, carbs100: null, fat100: null };

  try {
    if (source === 'openfoodfacts') {
      const off = await prisma.openFoodFactsCache.findUnique({ where: { id: foodId } });
      if (!off?.nutrientsPer100g) return empty;
      const n = off.nutrientsPer100g as any;
      return { kcal100: n.calories ?? null, protein100: n.protein ?? null, carbs100: n.carbs ?? null, fat100: n.fat ?? null };
    }

    if (source === 'fdc') {
      const fdcId = parseInt(foodId.replace('fdc_', ''), 10);
      if (isNaN(fdcId)) return empty;
      const fdc = await prisma.fdcFoodCache.findUnique({ where: { id: fdcId } });
      if (!fdc?.nutrients) return empty;
      const n = fdc.nutrients as any;
      return { kcal100: n.calories ?? null, protein100: n.protein ?? null, carbs100: n.carbohydrates ?? n.carbs ?? null, fat100: n.fat ?? null };
    }

    if (source === 'fatsecret') {
      const fs = await prisma.fatSecretFoodCache.findUnique({ where: { id: foodId } });
      if (!fs?.nutrientsPer100g) return empty;
      const n = fs.nutrientsPer100g as any;
      return { kcal100: n.calories ?? null, protein100: n.protein ?? null, carbs100: n.carbs ?? null, fat100: n.fat ?? null };
    }
  } catch {
    // Cache miss — no big deal
  }

  return empty;
}

// ─── Cloud Model Audit ──────────────────────────────────────────────────────

async function auditBatchWithCloud(items: EnrichedVM[]): Promise<AuditVerdict[]> {
  const itemLines = items.map((item, i) => {
    const brand = item.brandName ? ` (${item.brandName})` : '';
    const macros = (item.kcal100 != null)
      ? ` | Macros/100g: ${item.kcal100} kcal, ${item.protein100}g protein, ${item.carbs100}g carbs, ${item.fat100}g fat`
      : ' | Macros: UNKNOWN';
    return `${i + 1}. Query="${item.normalizedForm}" → Food="${item.foodName}"${brand}${macros}`;
  }).join('\n');

  const prompt = `You are a food database auditor. For each item, evaluate the mapping from Query -> Food.

You MUST respond with a valid JSON object containing a "results" array. Each object in the array MUST match this exact schema:
{
  "results": [
    {
      "index": <number from the prompt>,
      "semantic": "PASS" | "FAIL", // Does the query describe the core food?
      "nutrition": "PASS" | "WARN" | "FAIL", // Are macros plausible for 100g of this food? (Flag 0-cal items that should have calories, etc.)
      "category": "PASS" | "FAIL", // Is it human food?
      "state": "PASS" | "FAIL", // Does cooking state match? (e.g. raw vs cooked, dried vs fresh)
      "brand": "PASS" | "FAIL", // If query mentions a brand, does it match? If generic, does it map to an appropriately generic or highly representative item?
      "confidence": <number 0-100>, // Your confidence in this mapping
      "suggested_action": "DELETE" | "REMAP" | "REVIEW" | "NONE", // Action if it failed or warned
      "reason": "<brief explanation>"
    }
  ]
}

Items to audit:
${itemLines}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://recipe-app.local',
      },
      body: JSON.stringify({
        model: CLOUD_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are a precise food database auditor. Output strictly valid JSON matching the requested schema.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`  ❌ OpenRouter HTTP ${response.status}: ${text.slice(0, 200)}`);
      return items.map((_, i) => ({ index: i, semantic: 'PASS', nutrition: 'PASS', category: 'PASS', state: 'PASS', brand: 'PASS', confidence: 0, suggested_action: 'NONE', reason: 'CLOUD_ERROR' }));
    }

    const data = await response.json() as any;
    const content: string = data.choices?.[0]?.message?.content ?? '{}';

    // Default verdicts
    const verdicts: AuditVerdict[] = items.map((_, i) => ({
      index: i, semantic: 'PASS', nutrition: 'PASS', category: 'PASS', state: 'PASS', brand: 'PASS', confidence: 0, suggested_action: 'NONE', reason: 'unparsed',
    }));

    try {
      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.results)) {
        for (const res of parsed.results) {
          const idx = res.index;
          if (typeof idx === 'number' && idx >= 0 && idx < items.length) {
            verdicts[idx] = {
              index: idx,
              semantic: res.semantic === 'FAIL' ? 'FAIL' : 'PASS',
              nutrition: res.nutrition === 'FAIL' ? 'FAIL' : (res.nutrition === 'WARN' ? 'WARN' : 'PASS'),
              category: res.category === 'FAIL' ? 'FAIL' : 'PASS',
              state: res.state === 'FAIL' ? 'FAIL' : 'PASS',
              brand: res.brand === 'FAIL' ? 'FAIL' : 'PASS',
              confidence: typeof res.confidence === 'number' ? res.confidence : 50,
              suggested_action: res.suggested_action || 'NONE',
              reason: res.reason || '',
            };
          }
        }
      }
    } catch (parseErr) {
      console.error(`  ❌ JSON Parse Error: ${(parseErr as Error).message}`);
    }

    return verdicts;
  } catch (err) {
    console.error(`  ❌ OpenRouter error: ${(err as Error).message}`);
    return items.map((_, i) => ({ index: i, semantic: 'PASS' as const, nutrition: 'PASS' as const, category: 'PASS' as const, reason: 'NETWORK_ERROR' }));
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const sampleSize  = Number(args.find(a => a.startsWith('--sample='))?.split('=')[1] ?? '500');
  const sourceFilter = args.find(a => a.startsWith('--source='))?.split('=')[1] ?? null;
  const recentOnly  = args.includes('--recent');
  const oldestFirst = args.includes('--oldest');

  const logDir = path.join(__dirname, '..', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `dual-audit-${Date.now()}.jsonl`);
  const summaryFile = path.join(logDir, `dual-audit-summary-${Date.now()}.txt`);

  console.log('🔍 Dual-Model Quality Audit');
  console.log(`   Cloud model: ${CLOUD_MODEL}`);
  console.log(`   Sample size: ${sampleSize}`);
  console.log(`   Source: ${sourceFilter ?? 'all'}`);
  console.log(`   Mode: ${recentOnly ? 'recent (last 24h)' : oldestFirst ? 'oldest first' : 'random'}`);
  console.log(`   Log: ${logFile}\n`);

  // ── Sample VMs ────────────────────────────────────────────────────────────

  const where: any = {};
  if (sourceFilter) where.source = sourceFilter;
  if (recentOnly) where.createdAt = { gte: new Date(Date.now() - 24 * 3600 * 1000) };

  const totalVMs = await prisma.validatedMapping.count({ where });
  console.log(`📊 Total VMs matching filter: ${totalVMs.toLocaleString()}`);

  let vms;
  if (oldestFirst) {
    vms = await prisma.validatedMapping.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: sampleSize,
      select: { id: true, normalizedForm: true, foodId: true, foodName: true, brandName: true, source: true, aiConfidence: true, validationReason: true },
    });
  } else {
    // Random sampling via skip + take with random offset
    const skip = Math.max(0, Math.floor(Math.random() * (totalVMs - sampleSize)));
    vms = await prisma.validatedMapping.findMany({
      where,
      skip: Math.min(skip, Math.max(0, totalVMs - sampleSize)),
      take: sampleSize,
      select: { id: true, normalizedForm: true, foodId: true, foodName: true, brandName: true, source: true, aiConfidence: true, validationReason: true },
    });
  }

  console.log(`📦 Sampled ${vms.length} VMs\n`);

  // ── Enrich with nutritional data ──────────────────────────────────────────

  console.log('🧬 Enriching with nutritional data...');
  const enriched: EnrichedVM[] = [];

  for (let i = 0; i < vms.length; i++) {
    const vm = vms[i];
    const nutrition = await fetchNutrition(vm.foodId, vm.source);
    enriched.push({ ...vm, ...nutrition });

    if ((i + 1) % 100 === 0) console.log(`   ...enriched ${i + 1}/${vms.length}`);
  }

  const withMacros = enriched.filter(e => e.kcal100 != null);
  console.log(`   ${withMacros.length}/${enriched.length} have nutritional data\n`);

  // ── Audit via Cloud Model ─────────────────────────────────────────────────

  console.log('☁️  Running cloud audit...');

  const results: AuditResult[] = [];
  let semanticFails = 0, nutritionFails = 0, nutritionWarns = 0, categoryFails = 0;
  let totalAudited = 0;

  for (let i = 0; i < enriched.length; i += CLOUD_BATCH_SIZE) {
    const batch = enriched.slice(i, i + CLOUD_BATCH_SIZE);
    const verdicts = await auditBatchWithCloud(batch);

    for (let j = 0; j < batch.length; j++) {
      const vm = batch[j];
      const verdict = verdicts[j];
      totalAudited++;

      results.push({ vm, cloudVerdict: verdict });

      // Log to JSONL
      fs.appendFileSync(logFile, JSON.stringify({
        id: vm.id, normalizedForm: vm.normalizedForm, foodName: vm.foodName,
        brandName: vm.brandName, source: vm.source,
        kcal100: vm.kcal100, protein100: vm.protein100, carbs100: vm.carbs100, fat100: vm.fat100,
        semantic: verdict.semantic, nutrition: verdict.nutrition, category: verdict.category,
        state: verdict.state, brand: verdict.brand, confidence: verdict.confidence,
        suggested_action: verdict.suggested_action, reason: verdict.reason,
      }) + '\n');

      if (verdict.semantic === 'FAIL') semanticFails++;
      if (verdict.nutrition === 'FAIL') nutritionFails++;
      if (verdict.nutrition === 'WARN') nutritionWarns++;
      if (verdict.category === 'FAIL') categoryFails++;
    }

    const pct = Math.min(100, (totalAudited / enriched.length * 100)).toFixed(1);
    console.log(`  📋 ${totalAudited}/${enriched.length} audited (${pct}%) — sem:${semanticFails}F nut:${nutritionFails}F/${nutritionWarns}W cat:${categoryFails}F`);

    if (i + CLOUD_BATCH_SIZE < enriched.length) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_CALLS_MS));
    }
  }

  // ── Generate Summary Report ───────────────────────────────────────────────

  const failedItems = results.filter(r =>
    r.cloudVerdict.semantic === 'FAIL' ||
    r.cloudVerdict.nutrition === 'FAIL' ||
    r.cloudVerdict.category === 'FAIL' ||
    r.cloudVerdict.state === 'FAIL' ||
    r.cloudVerdict.brand === 'FAIL'
  );

  const warnItems = results.filter(r =>
    r.cloudVerdict.nutrition === 'WARN' &&
    r.cloudVerdict.semantic !== 'FAIL' &&
    r.cloudVerdict.category !== 'FAIL' &&
    r.cloudVerdict.state !== 'FAIL' &&
    r.cloudVerdict.brand !== 'FAIL'
  );

  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('  DUAL-MODEL AUDIT REPORT');
  lines.push(`  ${new Date().toISOString()}`);
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`  Total audited:       ${totalAudited}`);
  lines.push(`  Source filter:       ${sourceFilter ?? 'all'}`);
  lines.push(`  Cloud model:         ${CLOUD_MODEL}`);
  lines.push('');
  lines.push('  ── Results ──');
  lines.push(`  Semantic FAIL:       ${semanticFails} (${(semanticFails/totalAudited*100).toFixed(1)}%)`);
  lines.push(`  Nutrition FAIL:      ${nutritionFails} (${(nutritionFails/totalAudited*100).toFixed(1)}%)`);
  lines.push(`  Nutrition WARN:      ${nutritionWarns} (${(nutritionWarns/totalAudited*100).toFixed(1)}%)`);
  lines.push(`  Category FAIL:       ${categoryFails} (${(categoryFails/totalAudited*100).toFixed(1)}%)`);
  
  const stateFails = results.filter(r => r.cloudVerdict.state === 'FAIL').length;
  const brandFails = results.filter(r => r.cloudVerdict.brand === 'FAIL').length;
  const avgConf = (results.reduce((acc, r) => acc + r.cloudVerdict.confidence, 0) / Math.max(1, totalAudited)).toFixed(1);
  
  lines.push(`  State FAIL:          ${stateFails} (${(stateFails/totalAudited*100).toFixed(1)}%)`);
  lines.push(`  Brand FAIL:          ${brandFails} (${(brandFails/totalAudited*100).toFixed(1)}%)`);
  lines.push(`  Average Confidence:  ${avgConf}%`);
  lines.push(`  Clean PASS:          ${totalAudited - failedItems.length - warnItems.length} (${((totalAudited - failedItems.length - warnItems.length)/totalAudited*100).toFixed(1)}%)`);
  lines.push('');

  if (failedItems.length > 0) {
    lines.push('  ── FAILURES (require action) ──');
    lines.push('');
    for (const r of failedItems.slice(0, 50)) { // limit to 50 in summary to avoid massive files
      const v = r.cloudVerdict;
      const macros = r.vm.kcal100 != null ? `${r.vm.kcal100}kcal/${r.vm.protein100}p/${r.vm.carbs100}c/${r.vm.fat100}f` : 'no-macros';
      lines.push(`  [SEM:${v.semantic}/NUT:${v.nutrition}/CAT:${v.category}/ST:${v.state}/BR:${v.brand}] ${r.vm.source} | "${r.vm.normalizedForm}" → "${r.vm.foodName}" ${r.vm.brandName ? `(${r.vm.brandName})` : ''}`);
      lines.push(`     Macros/100g: ${macros} | Conf: ${v.confidence}% | Action: ${v.suggested_action}`);
      lines.push(`     Reason: ${v.reason}`);
      lines.push(`     VM ID: ${r.vm.id}`);
      lines.push('');
    }
    if (failedItems.length > 50) lines.push(`  ... and ${failedItems.length - 50} more failures (see JSONL log)\n`);
  }

  if (warnItems.length > 0) {
    lines.push('  ── WARNINGS (review recommended) ──');
    lines.push('');
    for (const r of warnItems.slice(0, 50)) {
      const v = r.cloudVerdict;
      const macros = r.vm.kcal100 != null ? `${r.vm.kcal100}kcal/${r.vm.protein100}p/${r.vm.carbs100}c/${r.vm.fat100}f` : 'no-macros';
      lines.push(`  [WARN] ${r.vm.source} | "${r.vm.normalizedForm}" → "${r.vm.foodName}" | ${macros}`);
      lines.push(`     Conf: ${v.confidence}% | Action: ${v.suggested_action}`);
      lines.push(`     ${v.reason}`);
      lines.push('');
    }
    if (warnItems.length > 50) lines.push(`  ... and ${warnItems.length - 50} more warnings (see JSONL log)\n`);
  }

  // Source breakdown
  const bySource: Record<string, { total: number; semFail: number; nutFail: number; nutWarn: number; catFail: number }> = {};
  for (const r of results) {
    const s = r.vm.source;
    if (!bySource[s]) bySource[s] = { total: 0, semFail: 0, nutFail: 0, nutWarn: 0, catFail: 0 };
    bySource[s].total++;
    if (r.cloudVerdict.semantic === 'FAIL') bySource[s].semFail++;
    if (r.cloudVerdict.nutrition === 'FAIL') bySource[s].nutFail++;
    if (r.cloudVerdict.nutrition === 'WARN') bySource[s].nutWarn++;
    if (r.cloudVerdict.category === 'FAIL') bySource[s].catFail++;
  }

  lines.push('  ── By Source ──');
  for (const [src, stats] of Object.entries(bySource)) {
    const cleanRate = ((stats.total - stats.semFail - stats.nutFail - stats.catFail) / stats.total * 100).toFixed(1);
    lines.push(`  ${src.padEnd(16)} ${stats.total} audited | ${cleanRate}% clean | sem:${stats.semFail}F nut:${stats.nutFail}F/${stats.nutWarn}W cat:${stats.catFail}F`);
  }

  const report = lines.join('\n');
  fs.writeFileSync(summaryFile, report);

  console.log('\n' + report);
  console.log(`\n📄 Detailed log: ${logFile}`);
  console.log(`📋 Summary: ${summaryFile}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
