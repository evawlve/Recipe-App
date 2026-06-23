/**
 * seed-off-validated.ts — OFF Bulk Seed with Ollama Quality Gate
 *
 * Streams the OFF CSV, filters candidates, validates each batch via local Ollama,
 * then inserts only PASS items into ValidatedMapping.
 *
 * Usage:
 *   npx tsx scripts/seed-off-validated.ts
 *   npx tsx scripts/seed-off-validated.ts --min-scans=5
 *   npx tsx scripts/seed-off-validated.ts --min-scans=1 --limit=50000
 *   npx tsx scripts/seed-off-validated.ts --skip-ollama   # bypass quality gate
 *   npx tsx scripts/seed-off-validated.ts --dry-run
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as zlib from 'zlib';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { normalizeIngredientName, canonicalizeCacheKey } from '../src/lib/fatsecret/normalization-rules';
import { checkBatchQuality, verifyOllamaReady, QUALITY_GATE_BATCH_SIZE } from './lib/ollama-quality-gate';

// Use DIRECT_URL to bypass pgbouncer (connection_limit=1) for bulk operations
const directUrl = process.env.DIRECT_URL;
if (!directUrl) {
  console.error('❌ DIRECT_URL not set in .env — needed for bulk DB operations');
  process.exit(1);
}
const prisma = new PrismaClient({
  datasources: { db: { url: directUrl } },
});

// ─── Config ─────────────────────────────────────────────────────────────────

const OFF_CSV_PATH = 'data/openfoodfacts.csv.gz';
const STATE_FILE = path.join(__dirname, '..', 'logs', 'off-validated-state.json');
const DEFAULT_MIN_SCANS = 5;

const SKIP_CATEGORY_PATTERNS = [
  /beauty|cosmetic|pet food|dog food|cat food|baby formula|infant formula/i,
  /supplement|vitamins|dietary supplement/i,
];

// OFF CSV column indices (validated 2026-04-24)
const COL = {
  code: 0, product_name: 10, brands: 18, categories_en: 23,
  countries_tags: 40, serving_size: 50, serving_quantity: 51,
  completeness: 77, unique_scans_n: 75, main_category_en: 81,
  kcal_100g: 89, fat_100g: 92, carbs_100g: 129, proteins_100g: 150,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseNum(s: string): number { const v = parseFloat(s); return isNaN(v) ? -1 : v; }
function parseScans(s: string): number { const v = parseInt(s, 10); return isNaN(v) ? 0 : v; }

function parseServingGrams(servingQuantity: string, servingSize: string): number | null {
  const q = parseFloat(servingQuantity);
  if (!isNaN(q) && q > 0) return q;
  const gMatch = servingSize.match(/(\d+(?:\.\d+)?)\s*g\b/i);
  if (gMatch) return parseFloat(gMatch[1]);
  const ozMatch = servingSize.match(/(\d+(?:\.\d+)?)\s*oz\b/i);
  if (ozMatch) return parseFloat(ozMatch[1]) * 28.3495;
  const mlMatch = servingSize.match(/(\d+(?:\.\d+)?)\s*ml\b/i);
  if (mlMatch) return parseFloat(mlMatch[1]);
  return null;
}

function atwaterValid(kcal: number, protein: number, carbs: number, fat: number): boolean {
  if (kcal <= 0) return false;
  const est = protein * 4 + carbs * 4 + fat * 9;
  if (est <= 0) return false;
  return kcal >= est * 0.7 && kcal <= est * 1.3;
}

function confidenceFromScans(scans: number): number {
  if (scans >= 1000) return 0.95;
  if (scans >= 200) return 0.90;
  if (scans >= 100) return 0.85;
  if (scans >= 20) return 0.80;
  return 0.75;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface OffCandidate {
  barcode: string;
  productName: string;
  brand: string;
  servingSize: string;
  servingQuantity: string;
  scans: number;
  kcal: number; fat: number; carbs: number; protein: number;
  // Computed during prep phase
  normalizedForm?: string;
  confidence?: number;
  servingGrams?: number;
}

// ─── Main ────────────────────────────────────────────────────────────────────

interface PreparedCandidate {
  barcode: string;
  productName: string;
  brand: string;
  servingSize: string;
  servingQuantity: string;
  scans: number;
  kcal: number; fat: number; carbs: number; protein: number;
  normalizedForm: string;
  confidence: number;
  servingGrams: number;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun    = args.includes('--dry-run');
  const skipOllama  = args.includes('--skip-ollama');
  const limit       = Number(args.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '0') || Infinity;
  const minScans    = Number(args.find(a => a.startsWith('--min-scans='))?.split('=')[1] ?? String(DEFAULT_MIN_SCANS));

  const logDir = path.join(__dirname, '..', 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  console.log(`🌍  OFF Validated Seed — ${new Date().toISOString()}${isDryRun ? ' [DRY RUN]' : ''}`);
  console.log(`   minScans=${minScans}  limit=${limit === Infinity ? '∞' : limit}  ollamaCheck=${!skipOllama}`);

  if (!skipOllama) {
    const ok = await verifyOllamaReady();
    if (!ok) { console.error('❌ Cannot reach Ollama.'); process.exit(1); }
    console.log('✅ Ollama is reachable\n');
  }

  // ── Load state + existing VMs ─────────────────────────────────────────────
  let processedSet = new Set<string>();
  if (fs.existsSync(STATE_FILE)) {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    processedSet = new Set(state.processedBarcodes || []);
    console.log(`📂 Resuming — ${processedSet.size} barcodes already processed`);
  }

  console.log('📦 Loading existing OFF VM keys...');
  const existingVmForms = new Set(
    (await prisma.validatedMapping.findMany({
      where: { source: 'openfoodfacts' },
      select: { normalizedForm: true },
    })).map(m => m.normalizedForm)
  );
  console.log(`   Existing OFF VMs: ${existingVmForms.size}\n`);

  // ── Streaming inline processing ───────────────────────────────────────────
  // Instead of collecting ALL candidates in memory, we buffer small batches
  // and process them inline as the CSV streams. This keeps memory flat.

  console.log('🔍 Streaming + processing OFF CSV inline...');

  if (!fs.existsSync(OFF_CSV_PATH)) {
    console.error(`❌ CSV not found: ${OFF_CSV_PATH}`);
    process.exit(1);
  }

  let totalRows = 0, totalQualified = 0;
  let skipNoUs = 0, skipNoName = 0, skipNoBrand = 0;
  let skipLowScans = 0, skipBadMacros = 0, skipAtwater = 0, skipCategory = 0;
  let inserted = 0, skippedExisting = 0, skippedAlreadyDone = 0;
  let ollamaRejected = 0, errors = 0;

  const batchSize = skipOllama ? 50 : QUALITY_GATE_BATCH_SIZE;
  let pendingBatch: PreparedCandidate[] = [];

  function saveState(barcode: string) {
    processedSet.add(barcode);
    if (processedSet.size % 2000 === 0) {
      fs.writeFileSync(STATE_FILE, JSON.stringify({ processedBarcodes: [...processedSet] }), 'utf-8');
    }
  }

  async function flushBatch() {
    if (pendingBatch.length === 0) return;
    const batch = pendingBatch;
    pendingBatch = [];

    // Ollama quality gate
    let passFlags = new Array(batch.length).fill(true);
    if (!skipOllama) {
      passFlags = await checkBatchQuality(
        batch.map(c => ({ normalizedForm: c.normalizedForm, foodName: c.productName, brandName: c.brand }))
      );
    }

    const passed = batch.filter((_, idx) => passFlags[idx]);
    ollamaRejected += batch.length - passed.length;

    if (isDryRun) {
      for (const c of passed) { inserted++; saveState(c.barcode); }
      return;
    }

    for (const c of passed) {
      try {
        const offId = `off_${c.barcode}`;
        await prisma.openFoodFactsCache.upsert({
          where: { barcode: c.barcode },
          create: {
            id: offId, barcode: c.barcode, name: c.productName, brandName: c.brand,
            nutrientsPer100g: { calories: c.kcal, fat: c.fat, carbs: c.carbs, protein: c.protein } as any,
            servingSize: c.servingSize || null, servingGrams: c.servingGrams,
            syncedAt: new Date(), expiresAt: new Date(Date.now() + 365 * 86400000),
          },
          update: { syncedAt: new Date(), servingGrams: c.servingGrams,
            nutrientsPer100g: { calories: c.kcal, fat: c.fat, carbs: c.carbs, protein: c.protein } as any },
        });

        const vmId = `vm_off_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        await prisma.validatedMapping.upsert({
          where: { normalizedForm_source: { normalizedForm: c.normalizedForm, source: 'openfoodfacts' } },
          create: {
            id: vmId, rawIngredient: `${c.brand} ${c.productName} [${c.barcode}]`,
            normalizedForm: c.normalizedForm, foodId: offId,
            foodName: c.productName, brandName: c.brand,
            source: 'openfoodfacts', aiConfidence: c.confidence,
            validationReason: `off_validated_scans_${c.scans}`,
            isAlias: false, validatedBy: skipOllama ? 'bulk_seed' : 'ollama_quality_gate', usedCount: 0,
          },
          update: { aiConfidence: c.confidence, updatedAt: new Date() },
        });

        existingVmForms.add(c.normalizedForm);
        inserted++;
        saveState(c.barcode);

        if (inserted % 1000 === 0) {
          console.log(`  ✅ ${inserted.toLocaleString()} inserted | ${ollamaRejected} rejected | ${totalRows.toLocaleString()} rows scanned`);
        }
      } catch (err) {
        errors++;
        saveState(c.barcode);
        if (errors <= 5) console.log(`  ⚠️  ${c.barcode}: ${(err as Error).message.slice(0, 300)}`);
      }
    }

    for (let j = 0; j < batch.length; j++) {
      if (!passFlags[j]) saveState(batch[j].barcode);
    }
  }

  // ── Stream CSV ────────────────────────────────────────────────────────────
  const csvStream = fs.createReadStream(OFF_CSV_PATH).pipe(zlib.createGunzip());
  let csvBuffer = '';
  let headerParsed = false;

  for await (const chunk of csvStream) {
    csvBuffer += chunk.toString('utf-8');
    const lines = csvBuffer.split('\n');
    csvBuffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      if (!headerParsed) { headerParsed = true; continue; }
      if (inserted >= limit) break;

      totalRows++;
      if (totalRows % 500000 === 0) {
        console.log(`   ...${(totalRows / 1000).toFixed(0)}k rows | ${totalQualified} qualified | ${inserted} inserted...`);
      }

      const cols = line.split('\t');
      if (cols.length < 160) continue;

      const code = cols[COL.code]?.trim() ?? '';
      const productName = cols[COL.product_name]?.trim() ?? '';
      const brand = cols[COL.brands]?.trim().split(',')[0].trim() ?? '';
      const countriesTags = cols[COL.countries_tags]?.trim() ?? '';
      const categoriesEn = cols[COL.categories_en]?.trim() ?? '';
      const servingSize = cols[COL.serving_size]?.trim() ?? '';
      const servingQuantity = cols[COL.serving_quantity]?.trim() ?? '';
      const scans = parseScans(cols[COL.unique_scans_n]?.trim() ?? '');

      const isUs = countriesTags.includes('en:united-states') || countriesTags.includes('en:world');
      const isEnglish = /^[a-zA-Z0-9 ',.\-/&()]+$/.test(productName) && productName.length > 2;
      if (!isUs && !isEnglish) { skipNoUs++; continue; }
      if (!productName) { skipNoName++; continue; }
      if (!brand) { skipNoBrand++; continue; }
      if (scans < minScans) { skipLowScans++; continue; }
      if (SKIP_CATEGORY_PATTERNS.some(p => p.test(categoriesEn))) { skipCategory++; continue; }

      const kcal = parseNum(cols[COL.kcal_100g]?.trim() ?? '');
      const fat = parseNum(cols[COL.fat_100g]?.trim() ?? '');
      const carbs = parseNum(cols[COL.carbs_100g]?.trim() ?? '');
      const protein = parseNum(cols[COL.proteins_100g]?.trim() ?? '');

      if (kcal < 0 || fat < 0 || carbs < 0 || protein < 0) { skipBadMacros++; continue; }
      if (!atwaterValid(kcal, protein, carbs, fat)) { skipAtwater++; continue; }

      // ── Inline prepare ──
      if (processedSet.has(code)) { skippedAlreadyDone++; continue; }

      const { cleaned: normalizedName } = normalizeIngredientName(productName);
      if (!normalizedName || normalizedName.length < 3) { saveState(code); continue; }

      const brandLower = brand.toLowerCase().trim();
      const baseKey = canonicalizeCacheKey(normalizedName);
      if (!baseKey) { saveState(code); continue; }

      const normalizedForm = baseKey.includes(brandLower) ? baseKey : `${brandLower} ${baseKey}`;
      if (existingVmForms.has(normalizedForm)) { skippedExisting++; saveState(code); continue; }

      totalQualified++;
      pendingBatch.push({
        barcode: code, productName, brand, servingSize, servingQuantity, scans,
        kcal, fat, carbs, protein, normalizedForm,
        confidence: confidenceFromScans(scans),
        servingGrams: parseServingGrams(servingQuantity, servingSize) ?? 100,
      });

      if (pendingBatch.length >= batchSize) {
        await flushBatch();
      }
    }
    if (inserted >= limit) break;
  }

  // Flush remaining
  await flushBatch();

  // Final state flush
  fs.writeFileSync(STATE_FILE, JSON.stringify({ processedBarcodes: [...processedSet] }), 'utf-8');

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  OFF VALIDATED SEED COMPLETE');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Total rows      : ${totalRows.toLocaleString()}`);
  console.log(`  Qualified       : ${totalQualified.toLocaleString()}`);
  console.log(`  Inserted        : ${inserted.toLocaleString()}`);
  console.log(`  Ollama rejected : ${ollamaRejected.toLocaleString()}`);
  console.log(`  Skipped existing: ${skippedExisting.toLocaleString()}`);
  console.log(`  Skipped resumed : ${skippedAlreadyDone.toLocaleString()}`);
  console.log(`  Errors          : ${errors.toLocaleString()}`);

  if (!isDryRun) {
    const total = await prisma.validatedMapping.count();
    console.log(`\n  📊 Total VMs now: ${total.toLocaleString()}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
