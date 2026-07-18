/**
 * ingest-off-delta.ts — incremental Open Food Facts ingestion via OFF's
 * "delta" export.
 *
 * OFF publishes gzipped JSONL delta files covering a rolling 14-day window at
 * https://static.openfoodfacts.org/data/delta/index.txt — filenames encode
 * the UNIX start/end timestamp of the changes they contain
 * (openfoodfacts_products_<start>_<end>.json.gz). Each delta is a full
 * product record (same schema as the full dump), not a diff, so this script
 * applies the exact same filters as the full ingest (scripts/lib/off-parse.ts)
 * and UPSERTS by barcode — unlike ingest-off.ts's createMany+skipDuplicates,
 * this is what lets community nutrition edits/completions on products we
 * already have (e.g. a previously-empty row getting its calories filled in)
 * actually overwrite the stale row instead of being silently ignored.
 *
 * IMPORTANT LIMITATION (documented by OFF): deltas cannot represent
 * deletions — mongoexport has no way to signal "this product was removed."
 * Run a periodic full --fresh re-ingest (ingest-off.ts) alongside this
 * script — e.g. quarterly — to prune products deleted/merged upstream.
 * Deltas also only cover ~14 days of retention on the index; if this script
 * hasn't run in longer than that, the gap is only recoverable via a full
 * re-ingest, not by "catching up" on deltas (they'll have aged off the index).
 *
 * Usage:
 *   npx ts-node scripts/ingest-off-delta.ts              # normal incremental run
 *   npx ts-node scripts/ingest-off-delta.ts --dry-run     # preview counts, no DB writes, no state save
 *   npx ts-node scripts/ingest-off-delta.ts --since=<unix ts>  # force reprocessing from this point
 *
 * State (the end-timestamp of the last delta file successfully processed)
 * persists to data/off-delta-state.json.
 */
import * as https from 'https';
import * as readline from 'readline';
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import { parseOffProduct } from './lib/off-parse';

const prisma = new PrismaClient();

const BATCH_SIZE = 1000;
const INDEX_URL = 'https://static.openfoodfacts.org/data/delta/index.txt';
const DELTA_BASE_URL = 'https://static.openfoodfacts.org/data/delta/';
const STATE_PATH = path.resolve(__dirname, '../data/off-delta-state.json');
const DELTA_FILENAME_RE = /^openfoodfacts_products_(\d+)_(\d+)\.json\.gz$/;

const DRY_RUN = process.argv.includes('--dry-run');
const sinceArg = process.argv.find(a => a.startsWith('--since='));
const FORCE_SINCE = sinceArg ? parseInt(sinceArg.split('=')[1], 10) : null;

interface DeltaState {
  lastProcessedEnd: number;
  lastRunAt: string;
}

function loadState(): DeltaState {
  if (FORCE_SINCE !== null) {
    return { lastProcessedEnd: FORCE_SINCE, lastRunAt: 'forced via --since' };
  }
  if (!fs.existsSync(STATE_PATH)) {
    return { lastProcessedEnd: 0, lastRunAt: 'never' };
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
}

function saveState(state: DeltaState) {
  if (DRY_RUN) return;
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`GET ${url} -> HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf-8');
      res.on('data', chunk => (body += chunk));
      res.on('end', () => resolve(body));
      res.on('error', reject);
    }).on('error', reject);
  });
}

class Stats {
  totalLines = 0;
  processedCount = 0;
  derivedFromServing = 0;
  skippedNoName = 0;
  skippedNotUsOrEn = 0;
  skippedCategory = 0;
  skippedNoMacros = 0;
  skippedAtwater = 0;

  bump(reason: 'no_name' | 'not_us_or_en' | 'category' | 'no_macros' | 'atwater') {
    switch (reason) {
      case 'no_name': this.skippedNoName++; break;
      case 'not_us_or_en': this.skippedNotUsOrEn++; break;
      case 'category': this.skippedCategory++; break;
      case 'no_macros': this.skippedNoMacros++; break;
      case 'atwater': this.skippedAtwater++; break;
    }
  }

  print() {
    console.log('\n✅ Delta ingestion finished.');
    console.log('══════════════════════════════════════════════════════════════');
    console.log(`  Total Lines Scanned       : ${this.totalLines.toLocaleString()}`);
    console.log(`  Upserted (new or updated) : ${this.processedCount.toLocaleString()}`);
    console.log(`    ...derived from _serving: ${this.derivedFromServing.toLocaleString()}`);
    console.log(`  Skipped (No name/code)    : ${this.skippedNoName.toLocaleString()}`);
    console.log(`  Skipped (Not US/EN)       : ${this.skippedNotUsOrEn.toLocaleString()}`);
    console.log(`  Skipped (Non-food cat)    : ${this.skippedCategory.toLocaleString()}`);
    console.log(`  Skipped (Bad macros)      : ${this.skippedNoMacros.toLocaleString()}`);
    console.log(`  Skipped (Atwater fail)    : ${this.skippedAtwater.toLocaleString()}`);
    console.log('══════════════════════════════════════════════════════════════');
  }
}

/**
 * Multi-row upsert by barcode. Uses raw SQL (not createMany+skipDuplicates)
 * because the whole point of the delta path is to let updated nutrition data
 * on already-ingested barcodes overwrite the stale row.
 */
async function upsertFoods(foods: {
  barcode: string;
  name: string;
  brandName: string | null;
  nutrientsPer100g: Record<string, number | null>;
  servingSize: string | null;
  servingGrams: number | null;
}[]) {
  if (DRY_RUN || foods.length === 0) return;

  const values = foods.map(f => Prisma.sql`(
    ${f.barcode}, ${f.name}, ${f.brandName},
    ${JSON.stringify(f.nutrientsPer100g)}::jsonb,
    ${f.servingSize}, ${f.servingGrams}, now(), now()
  )`);

  await prisma.$executeRaw`
    INSERT INTO "OffFood" (barcode, name, "brandName", "nutrientsPer100g", "servingSize", "servingGrams", "syncedAt", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT (barcode) DO UPDATE SET
      name = EXCLUDED.name,
      "brandName" = EXCLUDED."brandName",
      "nutrientsPer100g" = EXCLUDED."nutrientsPer100g",
      "servingSize" = EXCLUDED."servingSize",
      "servingGrams" = EXCLUDED."servingGrams",
      "syncedAt" = now(),
      "updatedAt" = now()
  `;
}

async function upsertServings(servings: {
  barcode: string;
  description: string;
  grams: number;
  source: string;
  isAiEstimated: boolean;
}[]) {
  if (DRY_RUN || servings.length === 0) return;
  // Servings only insert-if-new for now (matches ingest-off.ts behavior) —
  // OffServing has no natural single-value "current" column to overwrite the
  // way nutrientsPer100g does, so a stale duplicate serving description isn't
  // the same data-quality problem as stale/missing macros.
  await prisma.offServing.createMany({ data: servings, skipDuplicates: true });
}

async function flush(foodBatch: any[], servingBatch: any[]) {
  try {
    await upsertFoods(foodBatch);
    await upsertServings(servingBatch);
  } catch (err) {
    console.error('⚠️  Failed to flush batch database write:', (err as Error).message);
  }
}

function httpsGet(url: string): Promise<import('http').IncomingMessage> {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`GET ${url} -> HTTP ${res.statusCode}`));
        return;
      }
      resolve(res);
    }).on('error', reject);
  });
}

async function processDeltaFile(url: string, stats: Stats): Promise<void> {
  const res = await httpsGet(url);
  const rl = readline.createInterface({
    input: res.pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });

  let foodBatch: any[] = [];
  let servingBatch: any[] = [];

  for await (const line of rl) {
    stats.totalLines++;
    if (!line.trim()) continue;

    let product: any;
    try {
      product = JSON.parse(line);
    } catch {
      continue;
    }

    const parsed = parseOffProduct(product);
    if (parsed.skip) {
      stats.bump(parsed.reason);
      continue;
    }

    const d = parsed.data;
    stats.processedCount++;
    if (d.derivedFromServing) stats.derivedFromServing++;

    foodBatch.push({
      barcode: d.barcode,
      name: d.name,
      brandName: d.brandName,
      nutrientsPer100g: {
        calories: d.kcal >= 0 ? d.kcal : null,
        protein: d.protein >= 0 ? d.protein : null,
        carbs: d.carbs >= 0 ? d.carbs : null,
        fat: d.fat >= 0 ? d.fat : null,
        fiber: d.fiber >= 0 ? d.fiber : null,
        sugars: d.sugar >= 0 ? d.sugar : null,
        sodium: d.sodium >= 0 ? d.sodium : null,
      },
      servingSize: d.servingSize,
      servingGrams: d.servingGrams,
    });

    if (d.servingSize && d.servingGrams) {
      servingBatch.push({
        barcode: d.barcode,
        description: d.servingSize,
        grams: d.servingGrams,
        source: 'openfoodfacts',
        isAiEstimated: false,
      });
    }

    if (foodBatch.length >= BATCH_SIZE) {
      await flush(foodBatch, servingBatch);
      foodBatch = [];
      servingBatch = [];
    }
  }

  if (foodBatch.length > 0) {
    await flush(foodBatch, servingBatch);
  }
}

async function main() {
  console.log('🚀 OFF delta ingestion starting...');
  console.log(`Database URL: ${process.env.DATABASE_URL ? '✓ Configured' : '❌ MISSING'} | dryRun=${DRY_RUN}`);

  const state = loadState();
  console.log(`Last processed delta end-timestamp: ${state.lastProcessedEnd} (last run: ${state.lastRunAt})`);

  const indexText = await fetchText(INDEX_URL);
  const pending = indexText
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(name => {
      const m = name.match(DELTA_FILENAME_RE);
      if (!m) return null;
      return { name, start: parseInt(m[1], 10), end: parseInt(m[2], 10) };
    })
    .filter((f): f is { name: string; start: number; end: number } => !!f && f.start >= state.lastProcessedEnd)
    .sort((a, b) => a.start - b.start);

  if (pending.length === 0) {
    console.log('✅ No new delta files since last run. Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  console.log(`📦 ${pending.length} new delta file(s) to process.`);

  if (state.lastProcessedEnd > 0 && pending[0].start > state.lastProcessedEnd + 60) {
    console.warn(
      `⚠️  Gap detected: last processed end (${state.lastProcessedEnd}) vs. earliest pending delta start (${pending[0].start}). ` +
      `Changes in that gap may have already aged out of OFF's ~14-day delta retention — consider a full --fresh re-ingest (ingest-off.ts) to catch up.`
    );
  }

  const stats = new Stats();
  for (const file of pending) {
    console.log(`\n⬇️  ${file.name}  (${new Date(file.start * 1000).toISOString()} → ${new Date(file.end * 1000).toISOString()})`);
    await processDeltaFile(DELTA_BASE_URL + file.name, stats);
    saveState({ lastProcessedEnd: file.end, lastRunAt: new Date().toISOString() });
    console.log(`   running totals — upserted=${stats.processedCount.toLocaleString()} derivedFromServing=${stats.derivedFromServing.toLocaleString()}`);
  }

  stats.print();
}

main()
  .catch(err => {
    console.error('❌ Process crashed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
