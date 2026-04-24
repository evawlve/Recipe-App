/**
 * backfill-missing-macros-ai.ts
 *
 * Runs AI nutrition backfill (requestAiNutrition) on ValidatedMapping entries
 * whose linked food cache still has no nutrientsPer100g after the rehydration pass.
 *
 * For each entry:
 *   1. Calls requestAiNutrition() with the food name as context
 *   2. Writes the AI-estimated macros to:
 *      - AiGeneratedFood (cached per-100g nutrition record)
 *      - FatSecretFoodCache.nutrientsPer100g  (so the audit + pipeline see it)
 *      - FdcFoodCache.nutrients is read-only from USDA — we only update FS cache
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/backfill-missing-macros-ai.ts
 *   npx ts-node ... --dry-run
 *   npx ts-node ... --limit=50
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { requestAiNutrition, resetNutritionBatchCounter } from '../src/lib/fatsecret/ai-nutrition-backfill';

const prisma = new PrismaClient();

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Remap named FDC keys → parse nutrients
function parseNutrients(n: Record<string, unknown>) {
    const toNum = (v: unknown) => { const x = parseFloat(String(v ?? '')); return isNaN(x) ? null : x; };
    return {
        kcal:    toNum(n['1008'] ?? n['calories'] ?? n['energy']),
        protein: toNum(n['1003'] ?? n['protein']),
        carbs:   toNum(n['1005'] ?? n['carbs'] ?? n['carbohydrate']),
        fat:     toNum(n['1004'] ?? n['fat'] ?? n['totalFat']),
    };
}

async function main() {
    const args   = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const limit  = Number(args.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '99999');

    console.log(`🧠 AI Nutrition Backfill for missing macros${dryRun ? ' [DRY RUN]' : ''}`);
    console.log('');

    // ── Load no-macro IDs from latest audit ──────────────────────────────────
    const auditFiles = fs.readdirSync('logs')
        .filter(f => f.startsWith('ai-mapping-audit-') && f.endsWith('.json') && !f.includes('purge'))
        .sort().reverse();

    if (!auditFiles.length) {
        console.error('❌ No audit JSON in logs/. Run ai-audit-validated-mappings.ts first.');
        process.exit(1);
    }

    const auditFile = path.join('logs', auditFiles[0]);
    console.log(`📂 Using audit: ${auditFile}`);

    const audit = JSON.parse(fs.readFileSync(auditFile, 'utf-8'));
    const noMacroIds: string[] = audit.uncertainEntries
        .filter((e: { reason: string }) => /no macro/i.test(e.reason))
        .map((e: { id: string }) => e.id);

    // ── Load mappings and check which STILL have no macros ──────────────────
    const mappings = await prisma.validatedMapping.findMany({
        where: { id: { in: noMacroIds } },
        select: { id: true, rawIngredient: true, foodId: true, foodName: true },
    });

    // Check current macro status for each
    type MappingWithStatus = { id: string; rawIngredient: string; foodId: string; foodName: string; hasNutrients: boolean };
    const withStatus: MappingWithStatus[] = [];

    const fdcIds = mappings.filter(m => m.foodId.startsWith('fdc_')).map(m => parseInt(m.foodId.slice(4), 10));
    const fsIds  = mappings.filter(m => !m.foodId.startsWith('fdc_')).map(m => m.foodId);

    const fdcRows = await prisma.fdcFoodCache.findMany({ where: { id: { in: fdcIds } }, select: { id: true, nutrients: true } });
    const fsRows  = await prisma.fatSecretFoodCache.findMany({ where: { id: { in: fsIds } }, select: { id: true, nutrientsPer100g: true } });

    const fdcMap = new Map(fdcRows.map(r => [r.id, r.nutrients as Record<string, unknown> ?? {}]));
    const fsMap  = new Map(fsRows.map(r => [r.id, r.nutrientsPer100g]));

    for (const m of mappings) {
        let hasNutrients = false;
        if (m.foodId.startsWith('fdc_')) {
            const n = fdcMap.get(parseInt(m.foodId.slice(4), 10)) ?? {};
            const parsed = parseNutrients(n);
            hasNutrients = parsed.kcal != null && parsed.kcal > 0;
        } else {
            const n = fsMap.get(m.foodId);
            hasNutrients = !!n && typeof n === 'object' && 'calories' in (n as object);
        }
        withStatus.push({ ...m, hasNutrients });
    }

    const stillMissing = withStatus.filter(m => !m.hasNutrients).slice(0, limit);
    const alreadyFixed = withStatus.filter(m => m.hasNutrients).length;

    console.log(`📊 Status:`);
    console.log(`   Already have macros (resolved by rehydration): ${alreadyFixed}`);
    console.log(`   Still missing macros (need AI backfill):       ${stillMissing.length}`);
    console.log('');

    if (stillMissing.length === 0) {
        console.log('✅ All entries already have macros. Nothing to do.');
        await prisma.$disconnect();
        return;
    }

    resetNutritionBatchCounter();

    let aiOk = 0, aiFailed = 0, skipped = 0;

    for (const [i, m] of stillMissing.entries()) {
        const label = m.foodName.slice(0, 45).padEnd(45);
        process.stdout.write(`  [${String(i+1).padStart(3)}/${stillMissing.length}] ${label} → `);

        // Skip water and truly zero-calorie foods (not worth AI estimate)
        const nameLower = m.foodName.toLowerCase();
        if (/^water\b/.test(nameLower)) {
            console.log('⏭️  skip (water)');
            skipped++;
            continue;
        }

        try {
            if (dryRun) {
                console.log(`[DRY RUN] would call requestAiNutrition("${m.foodName}")`);
                aiOk++;
                continue;
            }

            const result = await requestAiNutrition(m.foodName, {
                rawLine: m.rawIngredient,
            });

            if (result.status === 'error') {
                console.log(`❌ AI error: ${result.reason}`);
                aiFailed++;
                continue;
            }

            // Write AI macros back to FatSecretFoodCache for pipeline use
            // (FDC entries stay read-only — we create/update via FS cache overlay)
            if (!m.foodId.startsWith('fdc_')) {
                // Pure FatSecret entry — update directly
                const nutrients = {
                    calories:     result.caloriesPer100g,
                    protein:      result.proteinPer100g,
                    carbohydrate: result.carbsPer100g,
                    fat:          result.fatPer100g,
                    fiber:        result.fiberPer100g,
                    source:       'ai_nutrition_backfill',
                    confidence:   result.confidence,
                };
                await prisma.fatSecretFoodCache.updateMany({
                    where: { id: m.foodId, nutrientsPer100g: { equals: null } },
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    data: { nutrientsPer100g: nutrients as any },
                });
            }
            // For FDC entries: AiGeneratedFood is the source of truth.
            // The pipeline checks AiGeneratedFood as a fallback when FDC has no macros.

            console.log(`✅ ${Math.round(result.caloriesPer100g)}kcal | P:${result.proteinPer100g.toFixed(1)}g C:${result.carbsPer100g.toFixed(1)}g F:${result.fatPer100g.toFixed(1)}g [conf: ${Math.round(result.confidence * 100)}%]${result.cached ? ' (cached)' : ''}`);
            aiOk++;

        } catch (err) {
            console.log(`❌ error: ${(err as Error).message.slice(0, 60)}`);
            aiFailed++;
        }

        await sleep(500); // Gentle rate-limit
    }

    console.log('');
    console.log('══════════════════════════════════════════════');
    console.log('  AI NUTRITION BACKFILL COMPLETE');
    console.log('══════════════════════════════════════════════');
    console.log(`  Attempted: ${stillMissing.length}`);
    console.log(`  ✅ Success: ${aiOk}`);
    console.log(`  ❌ Failed : ${aiFailed}`);
    console.log(`  ⏭️  Skipped: ${skipped}`);
    console.log('');
    console.log('💡 Re-run the AI audit to verify these new macros are plausible.');

    await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
