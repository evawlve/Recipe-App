/**
 * rehydrate-missing-macros.ts
 *
 * Fixes the 1,189 ValidatedMapping entries flagged as "no macro data" by the AI audit.
 *
 * Strategy per entry:
 *   1. Look up the foodId from ValidatedMapping
 *   2. If foodId starts with "fdc_":
 *        → FdcFoodCache already has nutrients (the audit routing was wrong).
 *          Write the per-100g macros directly into FatSecretFoodCache.nutrientsPer100g
 *          so future audits pick them up correctly.  (These are "fatsecret" source entries
 *          whose pipeline used an FDC fallback.)
 *   3. If foodId is a pure FatSecret ID:
 *        → Force-refresh by clearing expiresAt and calling ensureFoodCached().
 *          If nutrients are still null after refresh (volume-only servings with no gram weight),
 *          → call insertAiServing() with gapType='weight' to ask AI for gram weight,
 *            which then lets deriveNutrients() succeed on next cache write.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/rehydrate-missing-macros.ts
 *   npx ts-node ... --dry-run            # show what would be done
 *   npx ts-node ... --limit=50           # process only N entries
 *   npx ts-node ... --fdc-only           # only fix fdc_ prefix entries
 *   npx ts-node ... --fs-only            # only fix pure FatSecret entries
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { upsertFoodFromApi } from '../src/lib/fatsecret/cache';
import { insertAiServing } from '../src/lib/fatsecret/ai-backfill';

const prisma = new PrismaClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Parse FDC nutrients JSON — supports both numeric FDC IDs and named keys
// (our USDA saturation script stores named keys: {calories, protein, carbs, fat})
function fdcNutrientsToNamed(nutrients: Record<string, unknown>): Record<string, number> | null {
    const toNum = (v: unknown) => { const x = parseFloat(String(v ?? '')); return isNaN(x) ? null : x; };

    const kcal    = toNum(nutrients['1008'] ?? nutrients['calories'] ?? nutrients['energy']);
    const protein = toNum(nutrients['1003'] ?? nutrients['protein']);
    const carbs   = toNum(nutrients['1005'] ?? nutrients['carbs'] ?? nutrients['carbohydrate']);
    const fat     = toNum(nutrients['1004'] ?? nutrients['fat'] ?? nutrients['totalFat']);

    if (kcal == null && protein == null) return null;

    return {
        calories:     kcal    ?? 0,
        protein:      protein ?? 0,
        carbohydrate: carbs   ?? 0,
        fat:          fat     ?? 0,
    };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const args   = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const fdcOnly = args.includes('--fdc-only');
    const fsOnly  = args.includes('--fs-only');
    const limit   = Number(args.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '99999');

    console.log(`🔧 Rehydrate Missing Macros${dryRun ? ' [DRY RUN]' : ''}`);
    console.log('');

    // ── Load no-macro IDs from latest audit ───────────────────────────────────
    const auditFiles = fs.readdirSync('logs')
        .filter(f => f.startsWith('ai-mapping-audit-') && f.endsWith('.json') && !f.includes('purge'))
        .sort()
        .reverse();

    if (auditFiles.length === 0) {
        console.error('❌ No audit JSON found in logs/. Run ai-audit-validated-mappings.ts first.');
        process.exit(1);
    }

    const auditFile = path.join('logs', auditFiles[0]);
    console.log(`📂 Using audit: ${auditFile}`);

    const audit = JSON.parse(fs.readFileSync(auditFile, 'utf-8'));
    const noMacroIds: string[] = audit.uncertainEntries
        .filter((e: { reason: string }) => /no macro/i.test(e.reason))
        .map((e: { id: string }) => e.id);

    console.log(`   No-macro entries in audit: ${noMacroIds.length}`);

    // ── Load ValidatedMappings for those IDs ──────────────────────────────────
    const mappings = await prisma.validatedMapping.findMany({
        where: { id: { in: noMacroIds } },
        select: { id: true, rawIngredient: true, foodId: true, foodName: true, source: true },
    });

    const fdcEntries = mappings.filter(m => m.foodId.startsWith('fdc_'));
    const fsEntries  = mappings.filter(m => !m.foodId.startsWith('fdc_'));

    console.log(`   FDC-backed (fdc_ prefix): ${fdcEntries.length}`);
    console.log(`   Pure FatSecret IDs:        ${fsEntries.length}`);
    console.log('');

    let fixed = 0, skipped = 0, failed = 0;

    // ── STRATEGY 1: FDC-backed entries ────────────────────────────────────────
    // These already have nutrients in FdcFoodCache; the audit routing was wrong.
    // All we need to do is confirm — no DB write needed since the audit script
    // now correctly routes fdc_ IDs to FdcFoodCache. Just report them as resolved.
    if (!fsOnly) {
        console.log('── Strategy 1: FDC-backed entries (confirm nutrients exist) ──');

        const fdcIds = fdcEntries
            .slice(0, limit)
            .map(m => parseInt(m.foodId.slice(4), 10))
            .filter(id => !isNaN(id));

        const fdcCaches = await prisma.fdcFoodCache.findMany({
            where: { id: { in: fdcIds } },
            select: { id: true, nutrients: true, description: true },
        });

        const fdcMap = new Map(fdcCaches.map(r => [r.id, r]));

        let fdcHasNutrients = 0, fdcMissing = 0;

        for (const m of fdcEntries.slice(0, limit)) {
            const numId = parseInt(m.foodId.slice(4), 10);
            const cache = fdcMap.get(numId);

            if (!cache) {
                console.log(`  ⚠️  FDC ${m.foodId} not in FdcFoodCache — "${m.foodName}"`);
                fdcMissing++;
                continue;
            }

            const named = fdcNutrientsToNamed(cache.nutrients as Record<string, unknown> ?? {});
            if (named && named.calories > 0) {
                fdcHasNutrients++;
                // These are already resolved — the fixed audit script routes correctly
            } else {
                console.log(`  ⚠️  FDC ${m.foodId} has no usable nutrients — "${m.foodName}"`);
                fdcMissing++;
            }
        }

        console.log(`   ✅ FDC entries with nutrients (already resolved by fix): ${fdcHasNutrients}`);
        console.log(`   ❌ FDC entries genuinely missing nutrients: ${fdcMissing}`);
        console.log('');
        fixed += fdcHasNutrients;
        failed += fdcMissing;
    }

    // ── STRATEGY 2: Pure FatSecret entries ────────────────────────────────────
    // These have null nutrientsPer100g because servings are volume-only.
    // Step 2a: Force-refresh from FatSecret API (expiresAt cleared)
    // Step 2b: If still null → AI serving backfill with gapType='weight'
    if (!fdcOnly) {
        const toProcess = fsEntries.slice(0, Math.max(0, limit - (fdcOnly ? 0 : fdcEntries.length)));
        console.log(`── Strategy 2: Pure FatSecret entries (${toProcess.length} to process) ──`);

        if (dryRun) {
            console.log('   [DRY RUN] Would force-refresh these FatSecret foodIds:');
            toProcess.slice(0, 20).forEach(m =>
                console.log(`   "${m.rawIngredient}" → "${m.foodName}" [${m.foodId}]`)
            );
            if (toProcess.length > 20) console.log(`   ... and ${toProcess.length - 20} more`);
            console.log('');
        } else {
            for (const [i, m] of toProcess.entries()) {
                process.stdout.write(`  [${String(i+1).padStart(3)}/${toProcess.length}] ${m.rawIngredient.slice(0,40).padEnd(40)} → `);

                try {
                    // Force refresh by clearing expiresAt
                    await prisma.fatSecretFoodCache.updateMany({
                        where: { id: m.foodId },
                        data: { expiresAt: new Date(0) },
                    });

                    // Re-fetch from API
                    const result = await upsertFoodFromApi(m.foodId, {
                        searchQuery: m.foodName,
                        allowNextBest: true,
                    });

                    if (!result) {
                        console.log('❌ API returned nothing');
                        failed++;
                        continue;
                    }

                    // Check if nutrients are now populated
                    const updated = await prisma.fatSecretFoodCache.findUnique({
                        where: { id: m.foodId },
                        select: { nutrientsPer100g: true },
                    });

                    if (updated?.nutrientsPer100g) {
                        const n = updated.nutrientsPer100g as Record<string, unknown>;
                        console.log(`✅ ${Math.round(Number(n.calories ?? 0))}kcal | P:${Math.round(Number(n.protein ?? 0))}g`);
                        fixed++;
                    } else {
                        // Still no nutrients — try AI serving backfill to get gram weight
                        process.stdout.write('⚠️  still null → AI backfill... ');
                        const aiResult = await insertAiServing(m.foodId, 'weight', {
                            isOnDemandBackfill: true,
                        });

                        if (aiResult.success) {
                            // Fetch fresh API data to get raw per-serving calories
                            const client = new (await import('../src/lib/fatsecret/client')).FatSecretClient();
                            const details = await client.getFood(m.foodId);
                            const firstServing = details?.servings?.[0];

                            // Find AI-estimated gram weight serving we just inserted
                            const fsFood = await prisma.fatSecretFoodCache.findUnique({
                                where: { id: m.foodId },
                                include: { servings: { where: { source: 'ai' } } },
                            });
                            const aiServing = fsFood?.servings.find(s => (s.servingWeightGrams ?? 0) > 0);

                            if (firstServing?.calories && firstServing.calories > 0 && aiServing?.servingWeightGrams) {
                                const grams = aiServing.servingWeightGrams;
                                const nutrientsPer100g = {
                                    calories:     ((firstServing.calories     ?? 0) / grams) * 100,
                                    protein:      ((firstServing.protein      ?? 0) / grams) * 100,
                                    carbohydrate: ((firstServing.carbohydrate ?? 0) / grams) * 100,
                                    fat:          ((firstServing.fat          ?? 0) / grams) * 100,
                                    fiber:        ((firstServing.fiber        ?? 0) / grams) * 100,
                                };
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                await prisma.fatSecretFoodCache.update({
                                    where: { id: m.foodId },
                                    data: { nutrientsPer100g: nutrientsPer100g as any },
                                });
                                console.log(`✅ ${Math.round(nutrientsPer100g.calories)}kcal | P:${Math.round(nutrientsPer100g.protein)}g C:${Math.round(nutrientsPer100g.carbohydrate)}g F:${Math.round(nutrientsPer100g.fat)}g`);
                                fixed++;
                            } else {
                                console.log('❌ missing calories or AI gram weight');
                                failed++;
                            }
                        } else {
                            console.log(`❌ AI failed: ${aiResult.reason}`);
                            failed++;
                        }
                        skipped++;
                    }
                } catch (err) {
                    console.log(`❌ error: ${(err as Error).message.slice(0, 60)}`);
                    failed++;
                }

                await sleep(300); // Rate-limit FatSecret API
            }
        }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('');
    console.log('══════════════════════════════════════════════');
    console.log('  REHYDRATION COMPLETE');
    console.log('══════════════════════════════════════════════');
    console.log(`  Total processed: ${fdcEntries.length + fsEntries.length}`);
    console.log(`  Fixed          : ${fixed}`);
    console.log(`  Still missing  : ${failed}`);
    if (skipped) console.log(`  Needed AI help : ${skipped}`);

    await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
