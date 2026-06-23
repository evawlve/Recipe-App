/**
 * bulk-seed-branded-fdc.ts — Phase 2 Branded Cache Saturation via USDA FDC
 *
 * Strategy:
 *   1. Stream and parse food.csv -> Map<fdc_id, { name }>
 *   2. Stream and parse branded_food.csv -> Map<fdc_id, { name, brand, servingSize, servingUnit }>
 *   3. Stream and parse food_nutrient.csv -> Accumulate macros (1008, 1003, 1004, 1005)
 *   4. Filter to valid items (Atwater valid, brand exists, positive macros)
 *   5. Build brand-prefixed normalizedForm key
 *   6. Upsert directly into:
 *      - FdcFoodCache
 *      - FdcServingCache
 *      - ValidatedMapping
 *
 * Usage:
 *   npx tsx scripts/bulk-seed-branded-fdc.ts
 *   npx tsx scripts/bulk-seed-branded-fdc.ts --limit=5000
 *   npx tsx scripts/bulk-seed-branded-fdc.ts --dry-run
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';
import { PrismaClient } from '@prisma/client';
import { normalizeIngredientName, canonicalizeCacheKey } from '../src/lib/fatsecret/normalization-rules';

const prisma = new PrismaClient();

// ─── Config ─────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, '..', 'data', 'usda');
const FOOD_CSV = path.join(DATA_DIR, 'food.csv');
const BRANDED_CSV = path.join(DATA_DIR, 'branded_food.csv');
const NUTRIENT_CSV = path.join(DATA_DIR, 'food_nutrient.csv');

const STATE_FILE = path.join(__dirname, '..', 'logs', 'fdc-seed-state.json');

// Nutrient IDs FDC uses
const NUTRIENT_MAP = {
    '1008': 'kcal',
    '1003': 'protein',
    '1004': 'fat',
    '1005': 'carbs'
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface FdcProduct {
    fdcId: number;
    name?: string;
    brand?: string;
    servingSize?: number;
    servingUnit?: string;
    kcal?: number;
    protein?: number;
    fat?: number;
    carbs?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function atwaterValid(kcal: number, protein: number, carbs: number, fat: number): boolean {
    if (kcal <= 0) return false;
    const estimated = protein * 4 + carbs * 4 + fat * 9;
    if (estimated <= 0) return false;
    return kcal >= estimated * 0.7 && kcal <= estimated * 1.3;
}

function streamCsv<T>(filePath: string, onRow: (row: Record<string, string>) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        let count = 0;
        const fileStream = fs.createReadStream(filePath);
        Papa.parse(fileStream, {
            header: true,
            skipEmptyLines: true,
            step: (results) => {
                count++;
                if (count % 500000 === 0) {
                    console.log(`   ...parsed ${count.toLocaleString()} rows from ${path.basename(filePath)}`);
                }
                onRow(results.data as Record<string, string>);
            },
            complete: () => resolve(),
            error: (err) => reject(err)
        });
    });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);
    const isDryRun = args.includes('--dry-run');
    const isReset = args.includes('--reset');
    const limit = Number(args.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '0') || Infinity;
    const concurrency = Number(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] ?? '25');

    console.log(`🌍  USDA FDC Branded Seed — ${new Date().toISOString()}${isDryRun ? ' [DRY RUN]' : ''}`);

    if (!fs.existsSync(FOOD_CSV) || !fs.existsSync(BRANDED_CSV) || !fs.existsSync(NUTRIENT_CSV)) {
        console.error(`❌ Missing FDC CSV files!`);
        console.error(`Please download the FDC Branded Foods dataset from https://fdc.nal.usda.gov/download-datasets.html`);
        console.error(`Unzip it and place 'food.csv', 'branded_food.csv', and 'food_nutrient.csv' into:`);
        console.error(`  -> ${DATA_DIR}`);
        process.exit(1);
    }

    // ── Resumability ────────────────────────────────────────────────────────
    let processedSet = new Set<string>();
    if (!isReset && fs.existsSync(STATE_FILE)) {
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        processedSet = new Set(state.processedBarcodes || []);
        console.log(`📂 Resuming — ${processedSet.size} items already processed`);
    }

    function saveState(fdcId: string) {
        processedSet.add(fdcId);
        if (processedSet.size % 1000 === 0) {
            fs.writeFileSync(STATE_FILE, JSON.stringify({ processedBarcodes: [...processedSet] }), 'utf-8');
        }
    }

    // ── Load Existing VMs ───────────────────────────────────────────────────
    console.log('\n📦 Loading existing ValidatedMapping keys...');
    const existingVmForms = new Set(
        (await prisma.validatedMapping.findMany({
            where: { source: 'fdc' },
            select: { normalizedForm: true }
        })).map(m => m.normalizedForm)
    );
    console.log(`   Existing FDC VM entries: ${existingVmForms.size.toLocaleString()}`);

    // ── In-Memory Join ──────────────────────────────────────────────────────
    const products = new Map<number, FdcProduct>();

    console.log('\n🔍 Streaming food.csv...');
    await streamCsv(FOOD_CSV, (row) => {
        if (row.data_type === 'branded_food' || row.data_type === 'Branded') {
            const fdcId = parseInt(row.fdc_id, 10);
            products.set(fdcId, { fdcId, name: row.description });
        }
    });

    console.log('\n🔍 Streaming branded_food.csv...');
    await streamCsv(BRANDED_CSV, (row) => {
        const fdcId = parseInt(row.fdc_id, 10);
        const p = products.get(fdcId);
        if (p) {
            p.brand = row.brand_owner || row.brand_name;
            p.servingSize = parseFloat(row.serving_size);
            p.servingUnit = row.serving_size_unit;
        }
    });

    console.log('\n🔍 Streaming food_nutrient.csv...');
    await streamCsv(NUTRIENT_CSV, (row) => {
        const fdcId = parseInt(row.fdc_id, 10);
        const p = products.get(fdcId);
        if (p) {
            const prop = (NUTRIENT_MAP as Record<string, keyof FdcProduct>)[row.nutrient_id];
            if (prop) {
                (p as any)[prop] = parseFloat(row.amount);
            }
        }
    });

    // ── Filtering ───────────────────────────────────────────────────────────
    console.log('\n🧹 Filtering and Qualifying products...');
    const candidates: FdcProduct[] = [];

    let skippedNoMacros = 0;
    let skippedAtwater = 0;
    let skippedNoBrand = 0;

    for (const p of products.values()) {
        if (!p.name || !p.brand) { skippedNoBrand++; continue; }
        if (p.kcal === undefined || p.protein === undefined || p.fat === undefined || p.carbs === undefined) {
            skippedNoMacros++; continue;
        }
        if (!atwaterValid(p.kcal, p.protein, p.carbs, p.fat)) {
            skippedAtwater++; continue;
        }

        candidates.push(p);
    }

    console.log(`   Total raw Branded items: ${products.size.toLocaleString()}`);
    console.log(`   Missing brand/name:      ${skippedNoBrand.toLocaleString()}`);
    console.log(`   Missing macros:          ${skippedNoMacros.toLocaleString()}`);
    console.log(`   Atwater invalid:         ${skippedAtwater.toLocaleString()}`);
    console.log(`   ✅ Qualifying:           ${candidates.length.toLocaleString()}`);

    // Free up RAM
    products.clear();

    const toProcess = candidates.slice(0, limit === Infinity ? undefined : limit);
    console.log(`\n🚀 Processing ${toProcess.length.toLocaleString()} products...`);

    // ── Processing ──────────────────────────────────────────────────────────
    let inserted = 0;
    let skippedExisting = 0;
    let skippedAlreadyDone = 0;
    let errors = 0;

    for (let i = 0; i < toProcess.length; i += concurrency) {
        const batch = toProcess.slice(i, i + concurrency);

        await Promise.all(batch.map(async (product) => {
            const fdcIdStr = product.fdcId.toString();

            if (processedSet.has(fdcIdStr)) {
                skippedAlreadyDone++;
                return;
            }

            const { cleaned: normalizedName } = normalizeIngredientName(product.name!);
            if (!normalizedName || normalizedName.length < 3) {
                saveState(fdcIdStr);
                return;
            }

            const brandLower = product.brand!.toLowerCase().trim();
            const baseKey = canonicalizeCacheKey(normalizedName);
            if (!baseKey) {
                saveState(fdcIdStr);
                return;
            }

            const normalizedForm = baseKey.includes(brandLower)
                ? baseKey
                : `${brandLower} ${baseKey}`;

            if (existingVmForms.has(normalizedForm)) {
                skippedExisting++;
                saveState(fdcIdStr);
                return;
            }

            if (isDryRun) {
                console.log(`  [DRY RUN] ${product.brand} — ${product.name} → "${normalizedForm}"`);
                saveState(fdcIdStr);
                inserted++;
                return;
            }

            try {
                // Upsert FdcFoodCache
                await prisma.fdcFoodCache.upsert({
                    where: { id: product.fdcId },
                    create: {
                        id: product.fdcId,
                        description: product.name!,
                        brandName: product.brand,
                        dataType: 'Branded',
                        nutrients: { calories: product.kcal, protein: product.protein, fat: product.fat, carbohydrates: product.carbs },
                        servingSize: product.servingSize || null,
                        servingSizeUnit: product.servingUnit || null,
                        syncedAt: new Date(),
                        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
                    },
                    update: {
                        brandName: product.brand,
                        nutrients: { calories: product.kcal, protein: product.protein, fat: product.fat, carbohydrates: product.carbs },
                    }
                });

                // Upsert ValidatedMapping
                const vmId = `vm_fdc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
                await prisma.validatedMapping.upsert({
                    where: {
                        normalizedForm_source: { normalizedForm, source: 'fdc' }
                    },
                    create: {
                        id: vmId,
                        rawIngredient: `${product.brand} ${product.name} [FDC:${product.fdcId}]`,
                        normalizedForm,
                        foodId: product.fdcId.toString(),
                        foodName: product.name!,
                        brandName: product.brand,
                        source: 'fdc',
                        aiConfidence: 0.85,
                        validationReason: 'bulk_seed_fdc_branded',
                        isAlias: false,
                        validatedBy: 'bulk_seed',
                        usedCount: 0
                    },
                    update: { updatedAt: new Date() }
                });

                existingVmForms.add(normalizedForm);
                inserted++;
                saveState(fdcIdStr);

                if (inserted % 1000 === 0) {
                    console.log(`  ✅ ${inserted.toLocaleString()} inserted so far...`);
                }
            } catch (err) {
                errors++;
                saveState(fdcIdStr);
                if (errors <= 20) {
                    console.log(`  ⚠️  Error for FDC ${product.fdcId}: ${(err as Error).message.slice(0, 100)}`);
                }
            }
        }));
    }

    fs.writeFileSync(STATE_FILE, JSON.stringify({ processedBarcodes: [...processedSet] }), 'utf-8');

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('  FDC BRANDED SEED COMPLETE');
    console.log('══════════════════════════════════════════════════════════════');
    console.log(`  Processed (this run) : ${toProcess.length.toLocaleString()}`);
    console.log(`  Inserted into VM     : ${inserted.toLocaleString()}`);
    console.log(`  Skipped (existing)   : ${skippedExisting.toLocaleString()}`);
    console.log(`  Skipped (resumed)    : ${skippedAlreadyDone.toLocaleString()}`);
    console.log(`  Errors               : ${errors.toLocaleString()}`);

    await prisma.$disconnect();
}

main().catch(e => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
});
