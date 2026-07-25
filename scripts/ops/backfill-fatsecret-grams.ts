#!/usr/bin/env ts-node
/**
 * backfill-fatsecret-grams.ts — repair FatSecretFood rows whose
 * nutrientsPer100g is `{}` because their only serving is measured in ML.
 *
 * The defect: derivePer100gFromServings (src/lib/mapping/fatsecret-lane.ts)
 * only accepts a serving with metric_serving_unit === 'g' or an explicit
 * serving_weight_grams. A serving reported as "1 cup (240 ml)" persists as
 * FatSecretServing.volumeMl = 240 with grams = NULL, so the food is written
 * with nutrientsPer100g = {} — it serves 0 kcal everywhere downstream, and
 * every one of its servings is invisible to the serving-option paths that
 * filter on `grams != null && grams > 0`
 * (build-fatsecret-result.ts usableServings, /api/foods/[id]/serving).
 *
 * Measured on the production DB: 3,504 foods carry an empty per-100g panel.
 *   - 976 are the ML class — recoverable, and the ONLY class this script
 *     touches: grams = volumeMl x category density.
 *   - 2,528 are the "1 serving" class, with neither grams nor volumeMl. Their
 *     per-100g is genuinely underivable and this script LEAVES THEM ALONE.
 *     Do not "fix" them by assuming a serving weight — that fabricates data.
 *
 * Density comes from inferCategoryFromName(food.name) -> categoryDensity(...)
 * (src/lib/units/density.ts), defaulting to 1.0 g/ml (water) when the name
 * matches no category. This class is overwhelmingly beverages/condiments, so
 * water is the right neutral prior: it is exact for the drinks that dominate
 * the class and errs small (<=10%) for the sauces that do not.
 *
 * Grams are written for EVERY serving of a repaired food that has volumeMl > 0
 * and grams IS NULL (not just the per-100g anchor) — the density applies
 * equally to "1 cup" and "1 fl oz", and it is what un-breaks serving options.
 * Existing non-null grams are never overwritten.
 *
 * nutrientsPer100g is then recomputed by mirroring derivePer100gFromServings
 * exactly: the serving with the LARGEST derived grams that carries calories,
 * scaled by 100/grams, keys `calories`/`protein`/`carbs`/`fat` plus optional
 * `fiber`/`sugars`/`saturatedFat` rounded to 2dp, and `sodium` converted from
 * fatsecret's mg to GRAMS (Math.round(mg * factor) / 1000) to match the
 * OffFood convention.
 *
 * Any result that lands above the physical ceilings (>900 kcal/100g, or
 * protein+carbs+fat > 105 g/100g) is logged and SKIPPED, not written: it means
 * the density guess or the source panel is wrong, and a corrupt panel is worse
 * than an empty one.
 *
 * DRY-RUN BY DEFAULT — nothing is written without --apply.
 *
 * Run (from repo root; DATABASE_URL must point at the target DB):
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     scripts/ops/backfill-fatsecret-grams.ts [--apply] [--limit N] [--verbose]
 *
 * Flags:
 *   --dry-run   report only (the default; accepted for explicitness)
 *   --apply     actually write the grams + per-100g panels
 *   --limit N   stop after examining N candidate foods (foods whose panel is
 *               actually empty — so a small --limit is a real smoke test)
 *   --verbose   print a before -> after sample table
 *
 * Idempotent: a repaired food no longer has an empty panel, so re-runs skip it.
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import {
    inferCategoryFromName,
    categoryDensity,
    DRY_GRANULE_DENSITY_CATEGORIES,
} from '../../src/lib/units/density';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
}
const APPLY = args.includes('--apply');
const VERBOSE = args.includes('--verbose');
const LIMIT = argValue('--limit') ? parseInt(argValue('--limit')!, 10) : undefined;

const READ_PAGE = 500;
const WRITE_BATCH = 200;
const SAMPLE_ROWS = 25;

/** Water, for names that match no density category. */
const FALLBACK_DENSITY_GML = 1.0;

// Physical ceilings — pure fat is 900 kcal/100g, and macros cannot exceed the
// mass they are measured in (105 leaves headroom for label rounding).
const MAX_KCAL_PER_100G = 900;
const MAX_MACRO_SUM_PER_100G = 105;

/** Per-100g shape written to FatSecretFood.nutrientsPer100g. Mirrors
 *  FsNutrientsPer100g in src/lib/mapping/fatsecret-lane.ts. */
interface Per100g {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber?: number;
    sugars?: number;
    sodium?: number;
    saturatedFat?: number;
}

interface ServingRow {
    id: string;
    description: string;
    grams: number | null;
    volumeMl: number | null;
    nutrients: Prisma.JsonValue | null;
}

interface FoodRow {
    fsId: string;
    name: string;
    nutrientsPer100g: Prisma.JsonValue;
    servings: ServingRow[];
}

interface Repair {
    fsId: string;
    name: string;
    category: string;
    densityGml: number;
    /** servingId -> derived grams, for every ml serving missing grams. */
    gramsByServing: Array<{ id: string; grams: number }>;
    anchorMl: number;
    anchorGrams: number;
    per100: Per100g;
}

interface Rejection {
    fsId: string;
    name: string;
    reason: string;
}

/** True when the stored panel carries nothing at all (JSON null or `{}`).
 *  Deliberately strict: a partially-populated panel is somebody else's bug. */
function isEmptyPer100g(v: Prisma.JsonValue): boolean {
    if (v === null || v === undefined) return true;
    if (typeof v !== 'object' || Array.isArray(v)) return false;
    return Object.keys(v).length === 0;
}

/** Finite numeric field out of a FatSecretServing.nutrients Json blob. */
function num(nutrients: Prisma.JsonValue | null, key: string): number | undefined {
    if (!nutrients || typeof nutrients !== 'object' || Array.isArray(nutrients)) return undefined;
    const v = (nutrients as Record<string, unknown>)[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function round2(v: number): number {
    return Math.round(v * 100) / 100;
}

/**
 * Density for a food name: category default, else water.
 *
 * Dry-granule categories are refused, because everything this script touches
 * was REPORTED IN ML and is therefore a liquid, while those densities describe
 * the dry solid. inferCategoryFromName matches on substrings, so "Oat Milk"
 * reaches `oats` (0.36 g/ml, dry flakes) and "Almond Nog" reaches `nut`
 * (0.55); a 240 ml oat milk would be recorded as 86 g and its per-100g panel
 * would land ~3x too high. Must stay in step with servingGramsOf in
 * src/lib/mapping/fatsecret-lane.ts, which applies the same rule at ingest.
 */
function densityFor(name: string): { category: string; densityGml: number } {
    const inferred = inferCategoryFromName(name);
    const category = inferred && !DRY_GRANULE_DENSITY_CATEGORIES.has(inferred) ? inferred : null;
    const density = categoryDensity(category);
    return {
        category: category ?? (inferred ? `${inferred} (refused: dry-granule)` : 'none'),
        densityGml: density ?? FALLBACK_DENSITY_GML,
    };
}

/**
 * Scale one serving's raw macros to 100 g. Byte-for-byte the same key names,
 * units and rounding as derivePer100gFromServings — including sodium mg -> g.
 */
function per100FromServing(nutrients: Prisma.JsonValue | null, grams: number): Per100g | null {
    if (!(grams > 0)) return null;
    const factor = 100 / grams;
    const scale = (v: number | undefined): number | undefined =>
        v === undefined ? undefined : round2(v * factor);

    const per100: Per100g = {
        calories: scale(num(nutrients, 'calories')) ?? 0,
        protein: scale(num(nutrients, 'protein')) ?? 0,
        carbs: scale(num(nutrients, 'carbohydrate')) ?? 0,
        fat: scale(num(nutrients, 'fat')) ?? 0,
    };

    const fiber = scale(num(nutrients, 'fiber'));
    if (fiber !== undefined) per100.fiber = fiber;
    const sugars = scale(num(nutrients, 'sugar'));
    if (sugars !== undefined) per100.sugars = sugars;
    // fatsecret sodium is mg per serving; OffFood convention stores grams.
    const sodiumMg = num(nutrients, 'sodium');
    if (sodiumMg !== undefined) per100.sodium = Math.round(sodiumMg * factor) / 1000;
    const saturatedFat = scale(num(nutrients, 'saturatedFat'));
    if (saturatedFat !== undefined) per100.saturatedFat = saturatedFat;

    return per100;
}

/** Physical-plausibility gate. Returns a reason string when the panel is refused. */
function sanityRefusal(per100: Per100g): string | null {
    if (per100.calories > MAX_KCAL_PER_100G) {
        return `calories ${per100.calories}/100g > ${MAX_KCAL_PER_100G}`;
    }
    const macroSum = per100.protein + per100.carbs + per100.fat;
    if (macroSum > MAX_MACRO_SUM_PER_100G) {
        return `macro sum ${round2(macroSum)}g/100g > ${MAX_MACRO_SUM_PER_100G}`;
    }
    return null;
}

/** Build the repair for one food, or explain why it is not repairable. */
function planRepair(food: FoodRow): { repair?: Repair; rejection?: Rejection } {
    const { category, densityGml } = densityFor(food.name);

    // Derive grams for every ml serving that lacks them; never clobber real grams.
    const derived = food.servings
        .filter(s => s.grams == null && s.volumeMl != null && s.volumeMl > 0)
        .map(s => ({ serving: s, grams: round2(s.volumeMl! * densityGml) }))
        .filter(d => d.grams > 0);

    if (derived.length === 0) {
        return { rejection: { fsId: food.fsId, name: food.name, reason: 'no ml serving to convert' } };
    }

    // Same preference as derivePer100gFromServings: LARGEST usable grams that
    // carries calories. (The exact-100g-metric-panel short circuit cannot fire
    // here — by construction none of these servings is a gram panel.)
    let anchor: { serving: ServingRow; grams: number } | null = null;
    for (const d of derived) {
        if (num(d.serving.nutrients, 'calories') === undefined) continue;
        if (!anchor || d.grams > anchor.grams) anchor = d;
    }
    if (!anchor) {
        return { rejection: { fsId: food.fsId, name: food.name, reason: 'no ml serving carries calories' } };
    }

    const per100 = per100FromServing(anchor.serving.nutrients, anchor.grams);
    if (!per100) {
        return { rejection: { fsId: food.fsId, name: food.name, reason: 'anchor serving derived 0 g' } };
    }

    const refusal = sanityRefusal(per100);
    if (refusal) {
        return {
            rejection: {
                fsId: food.fsId,
                name: food.name,
                reason: `implausible (${refusal}) from ${anchor.serving.volumeMl}ml x ${densityGml} = ${anchor.grams}g`,
            },
        };
    }

    return {
        repair: {
            fsId: food.fsId,
            name: food.name,
            category,
            densityGml,
            gramsByServing: derived.map(d => ({ id: d.serving.id, grams: d.grams })),
            anchorMl: anchor.serving.volumeMl!,
            anchorGrams: anchor.grams,
            per100,
        },
    };
}

/** Write one batch of repairs atomically. */
async function flush(batch: Repair[]): Promise<void> {
    if (batch.length === 0) return;
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (const r of batch) {
        for (const s of r.gramsByServing) {
            ops.push(
                prisma.fatSecretServing.update({
                    where: { id: s.id },
                    data: { grams: s.grams },
                })
            );
        }
        ops.push(
            prisma.fatSecretFood.update({
                where: { fsId: r.fsId },
                data: { nutrientsPer100g: r.per100 as unknown as Prisma.InputJsonObject },
            })
        );
    }
    await prisma.$transaction(ops);
}

function printSample(repairs: Repair[]): void {
    console.log('\nsample (before -> after):');
    console.log(
        '  ' +
        'food'.padEnd(42) +
        'ml'.padStart(8) +
        'dens'.padStart(7) +
        '  ' + 'category'.padEnd(11) +
        'grams'.padStart(9) +
        'kcal/100g'.padStart(11)
    );
    for (const r of repairs.slice(0, SAMPLE_ROWS)) {
        const name = r.name.length > 40 ? r.name.slice(0, 39) + '…' : r.name;
        console.log(
            '  ' +
            name.padEnd(42) +
            String(r.anchorMl).padStart(8) +
            r.densityGml.toFixed(2).padStart(7) +
            '  ' + r.category.padEnd(11) +
            r.anchorGrams.toFixed(1).padStart(9) +
            r.per100.calories.toFixed(1).padStart(11)
        );
    }
    if (repairs.length > SAMPLE_ROWS) {
        console.log(`  ... and ${repairs.length - SAMPLE_ROWS} more`);
    }
}

async function main() {
    console.log(
        `backfill-fatsecret-grams — mode: ${APPLY ? 'APPLY (writing)' : 'dry-run (report only)'}` +
        (LIMIT ? `, limit ${LIMIT}` : '')
    );

    let scanned = 0;
    let candidates = 0;
    let repaired = 0;
    let skippedSanity = 0;
    let skippedNoUsable = 0;
    const repairs: Repair[] = [];
    const rejections: Rejection[] = [];
    let batch: Repair[] = [];
    let cursor: string | undefined;
    let done = false;

    while (!done) {
        // Relation filter narrows the read to the ml class; the empty-panel
        // test runs in JS so it never depends on Json-equality semantics.
        const page: FoodRow[] = await prisma.fatSecretFood.findMany({
            where: { servings: { some: { volumeMl: { gt: 0 } } } },
            select: {
                fsId: true,
                name: true,
                nutrientsPer100g: true,
                servings: {
                    select: {
                        id: true,
                        description: true,
                        grams: true,
                        volumeMl: true,
                        nutrients: true,
                    },
                },
            },
            orderBy: { fsId: 'asc' },
            take: READ_PAGE,
            ...(cursor ? { skip: 1, cursor: { fsId: cursor } } : {}),
        });
        if (page.length === 0) break;
        cursor = page[page.length - 1].fsId;
        if (page.length < READ_PAGE) done = true;

        for (const food of page) {
            scanned++;
            if (!isEmptyPer100g(food.nutrientsPer100g)) continue;

            candidates++;
            const { repair, rejection } = planRepair(food);
            if (rejection) {
                rejections.push(rejection);
                if (rejection.reason.startsWith('implausible')) skippedSanity++;
                else skippedNoUsable++;
            } else if (repair) {
                repaired++;
                repairs.push(repair);
                batch.push(repair);
                if (batch.length >= WRITE_BATCH) {
                    if (APPLY) await flush(batch);
                    console.log(`  ...${repaired} repaired`);
                    batch = [];
                }
            }

            if (LIMIT && candidates >= LIMIT) {
                done = true;
                break;
            }
        }
    }

    if (APPLY) await flush(batch);

    if (rejections.length > 0) {
        console.log(`\nskipped (${rejections.length}):`);
        for (const r of rejections.slice(0, SAMPLE_ROWS)) {
            console.log(`  fs_${r.fsId}  "${r.name}"  — ${r.reason}`);
        }
        if (rejections.length > SAMPLE_ROWS) {
            console.log(`  ... and ${rejections.length - SAMPLE_ROWS} more`);
        }
    }

    if (VERBOSE && repairs.length > 0) printSample(repairs);

    const servingWrites = repairs.reduce((n, r) => n + r.gramsByServing.length, 0);
    console.log(
        `\nsummary: scanned ${scanned} (${candidates} with an empty per-100g panel), ` +
        `${APPLY ? 'repaired' : 'would repair'} ${repaired} foods (${servingWrites} serving grams), ` +
        `skipped-by-sanity ${skippedSanity}, skipped-no-usable-serving ${skippedNoUsable}`
    );

    if (!APPLY) {
        console.log('dry-run: nothing written. Re-run with --apply to persist.');
    } else {
        console.log('done. The 2,528 "1 serving" foods remain empty by design — their per-100g is underivable.');
    }
}

main()
    .catch(err => {
        console.error('❌ Crashed:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
