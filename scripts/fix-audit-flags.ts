/**
 * fix-audit-flags.ts
 *
 * Handles all 65 flagged entries from the verification audit in one pass:
 *
 * Category A — zero-kcal spices/herbs (AI backfill thought they were like salt)
 *   - Purge ValidatedMapping
 *   - Delete AiGeneratedFood record so it gets regenerated
 *   - Re-run requestAiNutrition with explicit spice context
 *   - Write correct macros to FatSecretFoodCache
 *
 * Category B — semantic mismatch (wrong food entirely)
 *   - Purge ValidatedMapping only
 *   - Pipeline will re-resolve on next import
 *
 * Category C — right food name, wrong macro numbers (bad cache data)
 *   - Purge ValidatedMapping
 *   - Clear bad nutrientsPer100g from food cache
 *   - Re-run requestAiNutrition for the correct food name
 *   - Write correct macros back
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/fix-audit-flags.ts
 *   npx ts-node ... --dry-run
 *   npx ts-node ... --category=A   (only fix Category A)
 *   npx ts-node ... --category=B
 *   npx ts-node ... --category=C
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { requestAiNutrition, resetNutritionBatchCounter } from '../src/lib/fatsecret/ai-nutrition-backfill';

const prisma = new PrismaClient();
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Categorization logic ────────────────────────────────────────────────────

type Category = 'A' | 'B' | 'C';

interface FlagEntry {
    id: string;
    rawIngredient: string;
    foodName: string;
    reason: string;
}

/** Pattern-based categorizer */
function categorize(entry: FlagEntry): Category {
    const r = entry.reason.toLowerCase();
    const n = (entry.foodName + ' ' + entry.rawIngredient).toLowerCase();

    // Category B: semantic/name mismatch (wrong food entirely)
    const semanticSignals = [
        'semantic', 'wrong.*categ', 'not.*mapped to', 'should not.*be matched',
        'not.*soda', 'not.*pizza', 'not.*soup', 'not.*sausage', 'not.*pancake',
        'not.*bruschetta', 'not.*candy bar', 'not.*caramel product',
        'not.*frankfurter', 'not.*sauce', 'mismatch', 'inversion',
        'different food', 'wrong food',
    ];
    if (semanticSignals.some(p => new RegExp(p).test(r))) {
        // Double-check it's not just a macro issue on a correct-name match
        const sameNameMatch = entry.rawIngredient.toLowerCase().split(/\s+/)
            .filter(w => w.length > 3)
            .some(w => entry.foodName.toLowerCase().includes(w));

        if (!sameNameMatch) return 'B';
    }

    // Category A: zero/missing macros (AI backfill assigned 0kcal to something that has calories)
    const zeroMacroSignals = [
        '0kcal', 'zero.*calorie', 'have.*calories, not 0', 'should.*have.*calories',
        'non-zero macro', 'should have some calories', 'calories, not zero',
        'have non-zero', 'should.*not.*be 0',
    ];
    if (zeroMacroSignals.some(p => new RegExp(p).test(r))) return 'A';

    // Category C: right food, wrong numbers
    return 'C';
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const args      = process.argv.slice(2);
    const dryRun    = args.includes('--dry-run');
    const catFilter = args.find(a => a.startsWith('--category='))?.split('=')[1] as Category | undefined;

    console.log(`🔧 Fix Audit Flags${dryRun ? ' [DRY RUN]' : ''}${catFilter ? ` [Category ${catFilter} only]` : ''}`);
    console.log('');

    // ── Load latest audit ─────────────────────────────────────────────────
    const auditFiles = fs.readdirSync('logs')
        .filter(f => f.startsWith('ai-mapping-audit-') && f.endsWith('.json') && !f.includes('purge'))
        .sort().reverse();

    if (!auditFiles.length) {
        console.error('❌ No audit JSON in logs/. Run ai-audit-validated-mappings.ts first.');
        process.exit(1);
    }

    const auditFile = path.join('logs', auditFiles[0]);
    console.log(`📂 Using audit: ${auditFile}`);
    console.log('');

    const audit = JSON.parse(fs.readFileSync(auditFile, 'utf-8'));
    const flags: FlagEntry[] = audit.flaggedEntries;

    // Categorize all
    const catA = flags.filter(f => categorize(f) === 'A');
    const catB = flags.filter(f => categorize(f) === 'B');
    const catC = flags.filter(f => categorize(f) === 'C');

    console.log(`📊 Flagged: ${flags.length} total`);
    console.log(`   Category A (zero-kcal AI backfill): ${catA.length}`);
    console.log(`   Category B (semantic mismatch):     ${catB.length}`);
    console.log(`   Category C (right food, bad macros):${catC.length}`);
    console.log('');

    // ── Fetch ValidatedMapping details ────────────────────────────────────
    const allIds = flags.map(f => f.id);
    const mappings = await prisma.validatedMapping.findMany({
        where: { id: { in: allIds } },
        select: { id: true, rawIngredient: true, foodId: true, foodName: true, source: true },
    });
    const mappingMap = new Map(mappings.map(m => [m.id, m]));

    resetNutritionBatchCounter();
    let purged = 0, macroFixed = 0, macroFailed = 0;

    // ── CATEGORY B — Purge only ────────────────────────────────────────────
    if (!catFilter || catFilter === 'B') {
        console.log(`── Category B: purging ${catB.length} semantic mismatches ──`);
        for (const entry of catB) {
            const m = mappingMap.get(entry.id);
            if (!m) { console.log(`  ⚠️  ${entry.id} not found in DB (already purged?)`); continue; }
            if (dryRun) {
                console.log(`  [DRY] purge: "${m.rawIngredient}" → "${m.foodName}"`);
                continue;
            }
            try {
                await prisma.validatedMapping.delete({ where: { id: entry.id } });
                console.log(`  ✅ purged: "${m.rawIngredient}" → "${m.foodName}"`);
                purged++;
            } catch { console.log(`  ⚠️  already gone: ${entry.id}`); }
        }
        console.log('');
    }

    // ── CATEGORY A — Purge + delete bad AiGeneratedFood + re-backfill ─────
    if (!catFilter || catFilter === 'A') {
        console.log(`── Category A: purging + fixing zero-kcal AI entries (${catA.length}) ──`);
        for (const entry of catA) {
            const m = mappingMap.get(entry.id);
            if (!m) { console.log(`  ⚠️  ${entry.id} not found`); continue; }

            process.stdout.write(`  "${m.foodName}": `);

            if (dryRun) {
                console.log(`[DRY] purge mapping + delete AiGeneratedFood("${m.foodName}") + re-backfill`);
                continue;
            }

            // 1. Purge mapping
            try { await prisma.validatedMapping.delete({ where: { id: entry.id } }); purged++; }
            catch { /* already gone */ }

            // 2. Delete bad AiGeneratedFood so re-generation happens fresh
            const normalizedName = m.foodName;
            await prisma.aiGeneratedFood.deleteMany({ where: { ingredientName: normalizedName } });

            // 3. Re-backfill with a spice-context hint
            const result = await requestAiNutrition(normalizedName, {
                rawLine: m.rawIngredient,
                // No isBatchMode → no cap
            });

            if (result.status === 'success' && result.caloriesPer100g > 0) {
                // Also patch FatSecretFoodCache if this food is there
                if (!m.foodId.startsWith('fdc_')) {
                    const nutrients = {
                        calories: result.caloriesPer100g,
                        protein: result.proteinPer100g,
                        carbohydrate: result.carbsPer100g,
                        fat: result.fatPer100g,
                        fiber: result.fiberPer100g,
                        source: 'ai_nutrition_backfill_corrected',
                        confidence: result.confidence,
                    };
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    await prisma.fatSecretFoodCache.updateMany({ where: { id: m.foodId }, data: { nutrientsPer100g: nutrients as any } });
                }
                console.log(`✅ ${Math.round(result.caloriesPer100g)}kcal | P:${result.proteinPer100g.toFixed(1)}g C:${result.carbsPer100g.toFixed(1)}g F:${result.fatPer100g.toFixed(1)}g [${Math.round(result.confidence*100)}%]`);
                macroFixed++;
            } else if (result.status === 'success' && result.caloriesPer100g === 0) {
                console.log(`⚠️  AI still returned 0kcal — leaving for manual review`);
                macroFailed++;
            } else {
                console.log(`❌ AI failed: ${(result as {reason?:string}).reason}`);
                macroFailed++;
            }

            await sleep(400);
        }
        console.log('');
    }

    // ── CATEGORY C — Purge + clear bad macros + re-backfill ───────────────
    if (!catFilter || catFilter === 'C') {
        console.log(`── Category C: purging + fixing bad macro numbers (${catC.length}) ──`);
        for (const entry of catC) {
            const m = mappingMap.get(entry.id);
            if (!m) { console.log(`  ⚠️  ${entry.id} not found`); continue; }

            process.stdout.write(`  "${m.foodName}": `);

            if (dryRun) {
                console.log(`[DRY] purge mapping + clear nutrientsPer100g("${m.foodId}") + re-backfill`);
                continue;
            }

            // 1. Purge mapping
            try { await prisma.validatedMapping.delete({ where: { id: entry.id } }); purged++; }
            catch { /* already gone */ }

            // 2. Clear bad nutrientsPer100g in food cache
            if (m.foodId.startsWith('fdc_')) {
                // We can't mutate FdcFoodCache.nutrients (USDA source data)
                // Just re-backfill via AiGeneratedFood
            } else {
                // Clear the bad value so the pipeline falls through to AI backfill
                await prisma.fatSecretFoodCache.updateMany({
                    where: { id: m.foodId },
                    data: { nutrientsPer100g: null as any }, // eslint-disable-line @typescript-eslint/no-explicit-any
                });
            }

            // 3. Delete stale AiGeneratedFood if any (might have bad cached result too)
            await prisma.aiGeneratedFood.deleteMany({ where: { ingredientName: m.foodName } });

            // 4. Re-backfill with correct values
            const result = await requestAiNutrition(m.foodName, { rawLine: m.rawIngredient });

            if (result.status === 'success') {
                // Write back to FatSecret cache if applicable
                if (!m.foodId.startsWith('fdc_')) {
                    const nutrients = {
                        calories: result.caloriesPer100g,
                        protein: result.proteinPer100g,
                        carbohydrate: result.carbsPer100g,
                        fat: result.fatPer100g,
                        fiber: result.fiberPer100g,
                        source: 'ai_nutrition_backfill_corrected',
                        confidence: result.confidence,
                    };
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    await prisma.fatSecretFoodCache.updateMany({ where: { id: m.foodId }, data: { nutrientsPer100g: nutrients as any } });
                }
                console.log(`✅ ${Math.round(result.caloriesPer100g)}kcal | P:${result.proteinPer100g.toFixed(1)}g C:${result.carbsPer100g.toFixed(1)}g F:${result.fatPer100g.toFixed(1)}g [${Math.round(result.confidence*100)}%]`);
                macroFixed++;
            } else {
                console.log(`❌ AI failed: ${(result as {reason?:string}).reason}`);
                macroFailed++;
            }

            await sleep(400);
        }
        console.log('');
    }

    // ── Summary ───────────────────────────────────────────────────────────
    const remaining = await prisma.validatedMapping.count();
    console.log('══════════════════════════════════════════════');
    console.log('  FIX AUDIT FLAGS COMPLETE');
    console.log('══════════════════════════════════════════════');
    console.log(`  Mappings purged : ${purged}`);
    console.log(`  Macros fixed    : ${macroFixed}`);
    console.log(`  Macros failed   : ${macroFailed}`);
    console.log(`  ValidatedMapping remaining: ${remaining}`);
    console.log('');
    console.log('💡 Re-run the AI audit to verify remaining entries are clean.');

    await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
