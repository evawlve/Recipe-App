/**
 * preemptive-backfill-all.ts — Offline Preemptive Serving Backfill
 *
 * Iterates ALL foods in FatSecretFoodCache + FdcFoodCache and generates
 * category-aware servings (volume + count-based) for any food that:
 *   1. Matches a known category (produce, chips, bread, yogurt, etc.)
 *   2. Does NOT already have the target serving type cached
 *
 * Uses qwen-turbo via OpenRouter (~$0.000075/food). Full run costs ~$1-2.
 *
 * Usage:
 *   npx tsx scripts/preemptive-backfill-all.ts
 *   npx tsx scripts/preemptive-backfill-all.ts --dry-run         # preview, no API calls
 *   npx tsx scripts/preemptive-backfill-all.ts --source=fatsecret
 *   npx tsx scripts/preemptive-backfill-all.ts --source=fdc
 *   npx tsx scripts/preemptive-backfill-all.ts --category=chips  # single category
 *   npx tsx scripts/preemptive-backfill-all.ts --concurrency=8
 *   npx tsx scripts/preemptive-backfill-all.ts --max-servings=2  # fewer AI calls/food
 *   npx tsx scripts/preemptive-backfill-all.ts --reset           # ignore state file
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import {
    detectFoodCategory,
    generatePreemptiveServings,
    CATEGORY_PREEMPTIVE_SERVINGS,
} from '../src/lib/fatsecret/preemptive-backfill';

const prisma = new PrismaClient({ log: [] }); // Suppress prisma:query noise

const STATE_FILE = path.join(__dirname, '..', 'logs', 'preemptive-backfill-state.json');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    fn: (item: T, idx: number) => Promise<void>
) {
    let idx = 0;
    async function worker() {
        while (idx < items.length) {
            const i = idx++;
            await fn(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);
    const isDryRun    = args.includes('--dry-run');
    const isReset     = args.includes('--reset');
    const source      = args.find(a => a.startsWith('--source='))?.split('=')[1]; // 'fatsecret' | 'fdc' | 'off' | undefined
    const filterCat   = args.find(a => a.startsWith('--category='))?.split('=')[1];
    const concurrency = Number(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] ?? '4');
    const maxServings = Number(args.find(a => a.startsWith('--max-servings='))?.split('=')[1] ?? '3');

    // Ensure logs dir
    const logDir = path.join(__dirname, '..', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, `preemptive-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
    const logLines: string[] = [];
    function log(line: string) { console.log(line); logLines.push(line); }
    function flushLog() { fs.writeFileSync(logFile, logLines.join('\n'), 'utf-8'); }

    log(`🧠  Preemptive Serving Backfill — ${new Date().toISOString()}${isDryRun ? ' [DRY RUN]' : ''}`);
    log(`   source=${source ?? 'all'}  category=${filterCat ?? 'all'}  maxServings=${maxServings}  concurrency=${concurrency}`);

    // ── Load state ────────────────────────────────────────────────
    type State = { processedFoodIds: string[] };
    let state: State = { processedFoodIds: [] };
    if (!isReset && fs.existsSync(STATE_FILE)) {
        state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        log(`📂 Resuming — ${state.processedFoodIds.length} foods already processed`);
    }
    const processedSet = new Set(state.processedFoodIds);
    function saveState(id: string) {
        processedSet.add(id);
        if (processedSet.size % 200 === 0) {
            fs.writeFileSync(STATE_FILE, JSON.stringify({ processedFoodIds: [...processedSet] }), 'utf-8');
        }
    }

    // ── Print category coverage table ─────────────────────────────
    const allCategories = Object.keys(CATEGORY_PREEMPTIVE_SERVINGS);
    const activeCategories = filterCat ? [filterCat] : allCategories;
    log(`\n📋 Categories to process (${activeCategories.length}):`);
    for (const cat of activeCategories) {
        const defs = CATEGORY_PREEMPTIVE_SERVINGS[cat] ?? [];
        const servingLabels = defs.slice(0, maxServings).map(d => {
            const label = d.modifier ? `${d.unit} ${d.modifier}` : d.unit;
            return d.gapType === 'count' ? `${label} (count)` : label;
        });
        log(`   ${cat.padEnd(16)}: ${servingLabels.join(', ')}`);
    }

    // ── Fetch foods ───────────────────────────────────────────────
    interface FoodRecord { id: string; name: string; source: 'fatsecret' | 'fdc' | 'off'; }
    const foods: FoodRecord[] = [];

    if (!source || source === 'fatsecret') {
        const fsFoods = await prisma.fatSecretFoodCache.findMany({
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        });
        for (const f of fsFoods) foods.push({ id: f.id, name: f.name, source: 'fatsecret' });
        log(`\n📦 FatSecretFoodCache: ${fsFoods.length.toLocaleString()} foods`);
    }

    if (!source || source === 'fdc') {
        const fdcFoods = await prisma.fdcFoodCache.findMany({
            select: { id: true, description: true },
            orderBy: { description: 'asc' },
        });
        for (const f of fdcFoods) foods.push({ id: `fdc_${f.id}`, name: f.description, source: 'fdc' });
        log(`📦 FdcFoodCache: ${fdcFoods.length.toLocaleString()} foods`);
    }

    if (!source || source === 'off') {
        const offFoods = await prisma.openFoodFactsCache.findMany({
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        });
        for (const f of offFoods) foods.push({ id: f.id, name: f.name, source: 'off' });
        log(`📦 OpenFoodFactsCache: ${offFoods.length.toLocaleString()} foods`);
    }

    // ── Filter by category ────────────────────────────────────────
    const qualifying = foods.filter(f => {
        const cat = detectFoodCategory(f.name);
        if (!cat) return false;
        if (filterCat && cat !== filterCat) return false;
        return true;
    });

    log(`\n✅ Qualifying foods (have a known category): ${qualifying.length.toLocaleString()}`);
    log(`🔄 Already processed: ${processedSet.size.toLocaleString()}`);
    const toProcess = qualifying.filter(f => !processedSet.has(f.id));
    log(`🚀 To process: ${toProcess.length.toLocaleString()}`);

    if (toProcess.length === 0) {
        log('\n✨ Nothing to do — all qualifying foods already processed!');
        await prisma.$disconnect();
        return;
    }

    if (isDryRun) {
        log('\n[DRY RUN] Sample foods that would be processed:');
        for (const f of toProcess.slice(0, 30)) {
            const cat = detectFoodCategory(f.name)!;
            const defs = CATEGORY_PREEMPTIVE_SERVINGS[cat]?.slice(0, maxServings) ?? [];
            const labels = defs.map(d => d.modifier ? `${d.unit} ${d.modifier}` : d.unit);
            log(`   [${f.source}] ${f.name} → ${cat} → [${labels.join(', ')}]`);
        }
        log(`\n💰 Estimated cost: ${(toProcess.length * maxServings * 0.000025).toFixed(2)} USD`);
        await prisma.$disconnect();
        return;
    }

    // ── Process ───────────────────────────────────────────────────
    let done = 0;
    let totalGenerated = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    const startTime = Date.now();

    await runWithConcurrency(toProcess, concurrency, async (food) => {
        try {
            const result = await generatePreemptiveServings(food.id, food.name, {
                maxServings,
                dryRun: false,
            });

            if (result.category === null) {
                totalSkipped++;
            } else {
                totalGenerated += result.servingsGenerated;
                totalFailed += result.servingsFailed;
            }
        } catch (err) {
            totalFailed++;
        }

        saveState(food.id);
        done++;

        if (done % 100 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            const rate = (done / ((Date.now() - startTime) / 60000)).toFixed(0);
            log(`   ${done.toLocaleString()} / ${toProcess.length.toLocaleString()} | ✅ ${totalGenerated} servings | ⏱️ ${elapsed}s | ~${rate}/min`);
            flushLog();
        }
    });

    // Final state flush
    fs.writeFileSync(STATE_FILE, JSON.stringify({ processedFoodIds: [...processedSet] }), 'utf-8');

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(0);

    log('');
    log('══════════════════════════════════════════════════════════════');
    log('  PREEMPTIVE BACKFILL COMPLETE');
    log('══════════════════════════════════════════════════════════════');
    log(`  Foods processed     : ${done.toLocaleString()}`);
    log(`  Servings generated  : ${totalGenerated.toLocaleString()}`);
    log(`  Servings failed     : ${totalFailed.toLocaleString()} (low confidence, already exist, etc.)`);
    log(`  Skipped (no cat)    : ${totalSkipped.toLocaleString()}`);
    log(`  Elapsed             : ${elapsedSec}s`);
    log(`  Est. API cost       : ~$${(done * maxServings * 0.000025).toFixed(2)}`);

    flushLog();
    log(`\n📄 Log saved: ${logFile}`);
    log(`📂 State:     ${STATE_FILE}`);

    await prisma.$disconnect();
}

main().catch(e => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
});
