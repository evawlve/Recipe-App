/**
 * bulk-seed-branded-off.ts — Phase 2 Branded Cache Saturation via OpenFoodFacts
 *
 * Strategy:
 *   1. Stream the OFF CSV dump (tab-separated, gzipped)
 *   2. Filter to US products with complete macro data and ≥MIN_SCANS unique scans
 *   3. Sort the qualifying set by scan count (popularity) descending
 *   4. For each product:
 *      a. Parse brand + product name into a brand-prefixed normalizedForm key
 *      b. Validate macros via Atwater check
 *      c. Upsert directly into:
 *         - OpenFoodFactsServingCache (barcode, serving details)
 *         - ValidatedMapping (brand-prefixed normalizedForm, source=openfoodfacts)
 *   5. Resumable via state file (skip already-processed barcodes)
 *
 * Usage:
 *   npx tsx scripts/bulk-seed-branded-off.ts
 *   npx tsx scripts/bulk-seed-branded-off.ts --limit=5000       # first 5k by scan count
 *   npx tsx scripts/bulk-seed-branded-off.ts --min-scans=100    # stricter quality gate
 *   npx tsx scripts/bulk-seed-branded-off.ts --dry-run          # preview without DB writes
 *   npx tsx scripts/bulk-seed-branded-off.ts --reset            # ignore previous state
 *   npx tsx scripts/bulk-seed-branded-off.ts --concurrency=16   # parallel inserts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as zlib from 'zlib';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { normalizeIngredientName, canonicalizeCacheKey } from '../src/lib/fatsecret/normalization-rules';

const prisma = new PrismaClient();

// ─── Config ─────────────────────────────────────────────────────────────────

const OFF_CSV_PATH = 'data/openfoodfacts.csv.gz';

// Minimum unique scans — quality gate. 50 = product has been scanned by 50+ real users
const DEFAULT_MIN_SCANS = 50;

// State file for resumability
const STATE_FILE = path.join(__dirname, '..', 'logs', 'off-seed-state.json');

// Categories to skip — these aren't useful recipe ingredients
const SKIP_CATEGORY_PATTERNS = [
    /beauty|cosmetic|pet food|dog food|cat food|baby formula|infant formula/i,
    /supplement|vitamins|dietary supplement/i,
];

// Column indices (validated against the OFF CSV header on 2026-04-24)
const COL = {
    code: 0,
    product_name: 10,
    brands: 18,
    categories_en: 23,
    countries_tags: 40,
    serving_size: 50,
    serving_quantity: 51,
    completeness: 77,
    unique_scans_n: 75,
    main_category_en: 81,
    kcal_100g: 89,       // energy-kcal_100g
    fat_100g: 92,
    carbs_100g: 129,     // carbohydrates_100g
    proteins_100g: 150,
    lang: -1,            // not a fixed column — detected via product_name language heuristic
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseFloat0(s: string): number {
    const v = parseFloat(s);
    return isNaN(v) ? -1 : v;
}

function parseScanCount(s: string): number {
    const v = parseInt(s, 10);
    return isNaN(v) ? 0 : v;
}

function parseServingGrams(servingQuantity: string, servingSize: string): number | null {
    // serving_quantity is already in grams if present
    const q = parseFloat(servingQuantity);
    if (!isNaN(q) && q > 0) return q;

    // Fallback: parse "30g", "1 oz (28g)", "1 cup (240 ml)" etc.
    const gMatch = servingSize.match(/(\d+(?:\.\d+)?)\s*g\b/i);
    if (gMatch) return parseFloat(gMatch[1]);

    const ozMatch = servingSize.match(/(\d+(?:\.\d+)?)\s*oz\b/i);
    if (ozMatch) return parseFloat(ozMatch[1]) * 28.3495;

    const mlMatch = servingSize.match(/(\d+(?:\.\d+)?)\s*ml\b/i);
    if (mlMatch) return parseFloat(mlMatch[1]); // ~1g per ml for water-like foods

    return null;
}

/** Atwater check: estimated kcal from macros should be within 30% of labeled kcal */
function atwaterValid(kcal: number, protein: number, carbs: number, fat: number): boolean {
    if (kcal <= 0) return false;
    const estimated = protein * 4 + carbs * 4 + fat * 9;
    if (estimated <= 0) return false;
    return kcal >= estimated * 0.7 && kcal <= estimated * 1.3;
}

/** Map scan count → confidence score */
function confidenceFromScans(scans: number): number {
    if (scans >= 1000) return 0.95;
    if (scans >= 200) return 0.90;
    if (scans >= 100) return 0.85;
    return 0.80;
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);
    const isDryRun    = args.includes('--dry-run');
    const isReset     = args.includes('--reset');
    const limit       = Number(args.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '0') || Infinity;
    const minScans    = Number(args.find(a => a.startsWith('--min-scans='))?.split('=')[1] ?? String(DEFAULT_MIN_SCANS));
    const concurrency = Number(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] ?? '12');

    // Ensure logs dir exists
    const logDir = path.join(__dirname, '..', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, `off-seed-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
    const logLines: string[] = [];
    function log(line: string) {
        console.log(line);
        logLines.push(line);
    }
    function flushLog() {
        fs.writeFileSync(logFile, logLines.join('\n'), 'utf-8');
    }

    log(`🌍  OpenFoodFacts Branded Seed — ${new Date().toISOString()}${isDryRun ? ' [DRY RUN]' : ''}`);
    log(`   minScans=${minScans}  limit=${limit === Infinity ? '∞' : limit}  concurrency=${concurrency}`);

    // ── Load resumability state ───────────────────────────────────────────────
    type SeedState = { processedBarcodes: string[] };
    let state: SeedState = { processedBarcodes: [] };
    if (!isReset && fs.existsSync(STATE_FILE)) {
        state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        log(`📂 Resuming — ${state.processedBarcodes.length} barcodes already processed`);
    }
    const processedSet = new Set(state.processedBarcodes);

    function saveState(barcode: string) {
        processedSet.add(barcode);
        if (processedSet.size % 500 === 0) {
            fs.writeFileSync(STATE_FILE, JSON.stringify({ processedBarcodes: [...processedSet] }), 'utf-8');
        }
    }

    // ── Load existing VM normalizedForms to skip duplicates ──────────────────
    log('\n📦 Loading existing ValidatedMapping keys (openfoodfacts source)...');
    const existingVmForms = new Set(
        (await prisma.validatedMapping.findMany({
            where: { source: 'openfoodfacts' },
            select: { normalizedForm: true },
        })).map(m => m.normalizedForm)
    );
    log(`   Existing OFF VM entries: ${existingVmForms.size}`);

    // ── Stream + parse the CSV ────────────────────────────────────────────────
    log('\n🔍 Streaming OpenFoodFacts CSV...');

    if (!fs.existsSync(OFF_CSV_PATH)) {
        log(`❌ CSV not found at: ${OFF_CSV_PATH}`);
        log(`   Download it from: https://world.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz`);
        process.exit(1);
    }

    interface OffProduct {
        barcode: string;
        productName: string;
        brand: string;
        categoriesEn: string;
        servingSize: string;
        servingQuantity: string;
        scans: number;
        completeness: number;
        kcal: number;
        fat: number;
        carbs: number;
        protein: number;
    }

    const candidates: OffProduct[] = [];
    let totalRows = 0;
    let skippedNoUs = 0;
    let skippedNoMacros = 0;
    let skippedNoBrand = 0;
    let skippedNoName = 0;
    let skippedLowScans = 0;
    let skippedAtwater = 0;
    let skippedCategory = 0;

    const csvStream = fs.createReadStream(OFF_CSV_PATH)
        .pipe(zlib.createGunzip());

    let buffer = '';
    let headerParsed = false;

    // Parse with streaming line reader
    for await (const chunk of csvStream) {
        buffer += chunk.toString('utf-8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
            if (!line.trim()) continue;

            // Skip header row
            if (!headerParsed) {
                headerParsed = true;
                continue;
            }

            totalRows++;
            if (totalRows % 200000 === 0) {
                log(`   ...scanned ${(totalRows / 1000).toFixed(0)}k rows, ${candidates.length} candidates so far...`);
            }

            const cols = line.split('\t');
            if (cols.length < 160) continue; // malformed row

            const code = cols[COL.code]?.trim() ?? '';
            const productName = cols[COL.product_name]?.trim() ?? '';
            const brand = cols[COL.brands]?.trim().split(',')[0].trim() ?? ''; // Take first brand
            const countriesTags = cols[COL.countries_tags]?.trim() ?? '';
            const categoriesEn = cols[COL.categories_en]?.trim() ?? '';
            const servingSize = cols[COL.serving_size]?.trim() ?? '';
            const servingQuantity = cols[COL.serving_quantity]?.trim() ?? '';
            const completeness = parseFloat0(cols[COL.completeness]?.trim() ?? '');
            const scans = parseScanCount(cols[COL.unique_scans_n]?.trim() ?? '');

    // ── Filters ──────────────────────────────────────────────────────

            // Accept if: US product, OR worldwide, OR English lang tagged.
            // OFF is a global DB — most popular branded products
            // (Coca-Cola, Barilla, Nutella) are not exclusively US-tagged
            // but are sold and used in US recipes.
            const isUsProduct = countriesTags.includes('en:united-states') || countriesTags.includes('en:world');
            const isEnglishProduct = /^[a-zA-Z0-9 ',.-]+$/.test(productName) && productName.length > 2;
            if (!isUsProduct && !isEnglishProduct) {
                skippedNoUs++;
                continue;
            }

            if (!productName) { skippedNoName++; continue; }
            if (!brand) { skippedNoBrand++; continue; }
            if (scans < minScans) { skippedLowScans++; continue; }

            // Skip non-food categories
            const skipCat = SKIP_CATEGORY_PATTERNS.some(p => p.test(categoriesEn));
            if (skipCat) { skippedCategory++; continue; }

            const kcal    = parseFloat0(cols[COL.kcal_100g]?.trim() ?? '');
            const fat     = parseFloat0(cols[COL.fat_100g]?.trim() ?? '');
            const carbs   = parseFloat0(cols[COL.carbs_100g]?.trim() ?? '');
            const protein = parseFloat0(cols[COL.proteins_100g]?.trim() ?? '');

            if (kcal < 0 || fat < 0 || carbs < 0 || protein < 0) { skippedNoMacros++; continue; }
            if (!atwaterValid(kcal, protein, carbs, fat)) { skippedAtwater++; continue; }

            candidates.push({
                barcode: code,
                productName,
                brand,
                categoriesEn,
                servingSize,
                servingQuantity,
                scans,
                completeness,
                kcal,
                fat,
                carbs,
                protein,
            });
        }
    }
    if (buffer.trim()) {
        // process last line if no trailing newline
        totalRows++;
    }

    log(`\n📊 CSV Scan Complete:`);
    log(`   Total rows:         ${totalRows.toLocaleString()}`);
    log(`   Not US products:    ${skippedNoUs.toLocaleString()}`);
    log(`   No product name:    ${skippedNoName.toLocaleString()}`);
    log(`   No brand:           ${skippedNoBrand.toLocaleString()}`);
    log(`   Low scans (<${minScans}): ${skippedLowScans.toLocaleString()}`);
    log(`   Bad macros:         ${skippedNoMacros.toLocaleString()}`);
    log(`   Atwater invalid:    ${skippedAtwater.toLocaleString()}`);
    log(`   Skipped category:   ${skippedCategory.toLocaleString()}`);
    log(`   ✅ Qualifying:       ${candidates.length.toLocaleString()}`);

    // Sort by scan count descending (most popular first)
    candidates.sort((a, b) => b.scans - a.scans);

    // Apply limit
    const toProcess = candidates.slice(0, limit === Infinity ? undefined : limit);
    log(`\n🚀 Processing top ${toProcess.length.toLocaleString()} products (sorted by scan count)...`);
    if (isDryRun) log('   [DRY RUN — no DB writes]');

    // ── Process ───────────────────────────────────────────────────────────────
    let inserted = 0;
    let skippedExisting = 0;
    let skippedAlreadyDone = 0;
    let errors = 0;

    // Process in batches for concurrency without needing p-queue
    for (let i = 0; i < toProcess.length; i += concurrency) {
        const batch = toProcess.slice(i, i + concurrency);

        await Promise.all(batch.map(async (product) => {
            const { barcode, productName, brand, servingSize, servingQuantity,
                scans, kcal, fat, carbs, protein } = product;

            // Skip already processed barcodes (resumability)
            if (processedSet.has(barcode)) {
                skippedAlreadyDone++;
                return;
            }

            // Build brand-prefixed normalizedForm (Option A)
            const { cleaned: normalizedName } = normalizeIngredientName(productName);
            if (!normalizedName || normalizedName.length < 3) {
                saveState(barcode);
                return;
            }

            const brandLower = brand.toLowerCase().trim();
            const baseKey = canonicalizeCacheKey(normalizedName);
            if (!baseKey) {
                saveState(barcode);
                return;
            }

            // Brand-prefix the key so it doesn't collide with generic entries
            const normalizedForm = baseKey.includes(brandLower)
                ? baseKey
                : `${brandLower} ${baseKey}`;

            // Skip if already in VM
            if (existingVmForms.has(normalizedForm)) {
                skippedExisting++;
                saveState(barcode);
                return;
            }

            const confidence = confidenceFromScans(scans);
            const servingGrams = parseServingGrams(servingQuantity, servingSize) ?? 100;

            if (isDryRun) {
                log(`  [DRY RUN] ${brand} — ${productName} → "${normalizedForm}" (${scans} scans, ${kcal} kcal/100g)`);
                saveState(barcode);
                inserted++;
                return;
            }

            try {
                const offId = `off_${barcode}`;

                // 1. Upsert into OpenFoodFactsCache (primary OFF product record)
                await prisma.openFoodFactsCache.upsert({
                    where: { barcode },
                    create: {
                        id: offId,
                        barcode,
                        name: productName,
                        brandName: brand,
                        nutrientsPer100g: { calories: kcal, fat, carbs, protein } as any,
                        servingSize: servingSize || null,
                        servingGrams,
                        syncedAt: new Date(),
                        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                    },
                    update: {
                        syncedAt: new Date(),
                        servingGrams,
                        nutrientsPer100g: { calories: kcal, fat, carbs, protein } as any,
                    },
                });

                // 2. Upsert into ValidatedMapping
                const vmId = `vm_off_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
                await prisma.validatedMapping.upsert({
                    where: {
                        normalizedForm_source: {
                            normalizedForm,
                            source: 'openfoodfacts',
                        },
                    },
                    create: {
                        id: vmId,
                        rawIngredient: `${brand} ${productName} [${barcode}]`,
                        normalizedForm,
                        foodId: `off_${barcode}`,
                        foodName: productName,
                        brandName: brand,
                        source: 'openfoodfacts',
                        aiConfidence: confidence,
                        validationReason: `bulk_seed_off_scans_${scans}`,
                        isAlias: false,
                        validatedBy: 'bulk_seed',
                        usedCount: 0,
                    },
                    update: {
                        // If already exists, just refresh confidence based on latest scan count
                        aiConfidence: confidence,
                        updatedAt: new Date(),
                    },
                });

                existingVmForms.add(normalizedForm); // local dedup for this run
                inserted++;
                saveState(barcode);

                if (inserted % 1000 === 0) {
                    log(`  ✅ ${inserted.toLocaleString()} inserted so far...`);
                    flushLog();
                }
            } catch (err) {
                errors++;
                saveState(barcode);
                if (errors <= 20) {
                    log(`  ⚠️  Error for barcode ${barcode}: ${(err as Error).message.slice(0, 100)}`);
                }
            }
        }));
    }

    // Final state flush
    fs.writeFileSync(STATE_FILE, JSON.stringify({ processedBarcodes: [...processedSet] }), 'utf-8');

    const finalCount = isDryRun ? 0 : await prisma.validatedMapping.count();
    log('');
    log('══════════════════════════════════════════════════════════════');
    log('  OPENFOODFACTS BRANDED SEED COMPLETE');
    log('══════════════════════════════════════════════════════════════');
    log(`  Qualifying products  : ${candidates.length.toLocaleString()}`);
    log(`  Processed (this run) : ${toProcess.length.toLocaleString()}`);
    log(`  Inserted into VM     : ${inserted.toLocaleString()}`);
    log(`  Skipped (existing)   : ${skippedExisting.toLocaleString()}`);
    log(`  Skipped (resumed)    : ${skippedAlreadyDone.toLocaleString()}`);
    log(`  Errors               : ${errors.toLocaleString()}`);
    if (!isDryRun) log(`  ValidatedMapping total: ${finalCount.toLocaleString()}`);
    if (toProcess.length < candidates.length) {
        log(`\n  ⏭️  ${(candidates.length - toProcess.length).toLocaleString()} products remain (remove --limit or increase it to continue)`);
    }

    flushLog();
    log(`\n📄 Log: ${logFile}`);
    log(`📂 State: ${STATE_FILE}`);

    await prisma.$disconnect();
}

main().catch(e => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
});
