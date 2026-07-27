/**
 * detect-corrupt-nutrition.ts — corpus scan for per-FIELD nutrition
 * impossibilities and scale slips (REPORT-ONLY, writes nothing).
 *
 * Companion to detect-corrupt-panel.ts (which catches whole panels stored at
 * per-serving scale). This scan catches records where individual fields are
 * physically impossible or off by a unit factor — the classes the 2026-07-21
 * nutrition re-verify found the panel detector blind to (mayonnaise
 * off_9348905001434 sodium 5.33 g/100g, a mg-entered-as-g slip):
 *
 *   kcal-impossible        kcal/100g > 905 (pure fat is ~900; the 2026-07-21
 *                          live sizing found ~14k unmarked rows, many holding
 *                          mg-scale or per-package junk like 81,818 kcal)
 *   macro-sum-impossible   protein+fat+carbs > 105 g/100g
 *   fiber-impossible       fiber > 105 g/100g (often paired with kJ-as-kcal
 *                          on the same row — chicken with "fiber 260")
 *   sugars-impossible      sugars > 105 g/100g
 *   sodium-impossible      sodium > 39.4 g/100g (pure salt is 39.3 — nothing
 *                          edible exceeds it; jerky at "1285 g" = mg-as-g)
 *   sodium-implausible     sodium in (10, 39.4] g/100g on foods that are NOT
 *                          salts/bouillon/seasoning concentrates (name guard;
 *                          guarded rows are reported, never flagged)
 *   kj-as-kcal             kcal >= 100 with all three macros present and
 *                          kcal > 3x the Atwater estimate (4P+9F+4C) — the
 *                          kJ-value-in-the-kcal-field family (n-mq-27 lemon:
 *                          383 "kcal"/100g vs ~40 real). Alcohol names are
 *                          exempt (7 kcal/g invisible to Atwater).
 *   panel-inflated-serving a per-SERVING panel stored in the per-100g fields —
 *                          the same corruption detect-corrupt-panel.ts catches
 *                          via same-name sibling medians, but caught SIBLING-FREE
 *                          from the row alone. Needed because the class lives in
 *                          meal-kit / restaurant / deli items, which are name-space
 *                          singletons: 45 of a 65-row sample had no siblings, so the
 *                          median approach is structurally blind there. Two absolute
 *                          measurements replace the median: an internally coherent
 *                          panel (calories within 10% of Atwater) whose macros sum
 *                          into the near-anhydrous [95, 105] g/100g band, and an
 *                          implied per-serving energy above 1,500 kcal from a serving
 *                          mass inside the single-eating-occasion window. See the
 *                          threshold block in corrupt-mark.ts for the calibration.
 *   sodium-sibling-outlier sodium >= max(2 g, 6x the same-name sibling
 *                          median) with >= --min-group siblings whose median
 *                          is itself sane — the mayo class, where the value
 *                          is too low for the absolute rules but ~9x its
 *                          siblings.
 *
 * Each row gets at most ONE flag (first matching rule in the order above).
 * The 4-10 g/100g sodium band (soy/fish-sauce territory) is counted in the
 * summary but never flagged — that band needs identity-aware triage.
 *
 * Output feeds scripts/mark-corrupt-off.ts unchanged: every flag carries a
 * `check` payload naming the live field the marker must re-verify before
 * writing, and the shared trust rules (src/lib/mapping/corrupt-mark.ts)
 * re-verify each threshold from the flag's own value.
 *
 * Run (from repo root, read-only):
 *   npx ts-node -r tsconfig-paths/register --transpile-only --compilerOptions \
 *     '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/eval/detect-corrupt-nutrition.ts [--min-group 4] [--print 40]
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { normalizeNameKey } from '../../src/lib/search/dedupe-candidates';
import { ALCOHOL_PATTERN } from '../../src/lib/mapping/macro-plausibility';
import {
    CorruptScanFlag,
    MAX_KCAL_100G,
    MAX_MACRO_SUM_100G,
    MAX_COMPONENT_100G,
    MAX_SODIUM_100G,
    SODIUM_IMPLAUSIBLE_100G,
    KJ_ATWATER_MIN_RATIO,
    KJ_MIN_KCAL,
    MIN_SODIUM_OUTLIER_GROUP,
    MIN_SODIUM_OUTLIER_RATIO,
    MIN_SODIUM_OUTLIER_G,
    MIN_IMPLIED_SERVING_KCAL,
    impliedServingKcal,
    rejectPanelInflatedServing,
    ServingScalePanel,
} from '../../src/lib/mapping/corrupt-mark';

const BATCH = 20000;

/**
 * The one slice of PrismaClient this scan consumes — injectable so the
 * fail-injection tests can prove the zero-scan refusal offline
 * (__tests__/fail-open-sweep.test.ts), same pattern as
 * detect-panel-scale-divided.ts's RowStream.
 */
export interface ScanDb {
    offFood: { findMany(args: unknown): Promise<Row[]> };
}

export interface NutritionScanOptions {
    minGroup?: number;
    print?: number;
    /** report directory; defaults to scripts/eval/results (tests inject a tmp dir) */
    outDir?: string;
}

/** Foods that legitimately live above SODIUM_IMPLAUSIBLE_100G: pure salts,
 *  bouillon/stock concentrates, seasoning/gravy powders, electrolyte mixes.
 *  Word-bounded so "salted caramel" is guarded (conservative skip) but
 *  "sardines" is not. Guarded rows are reported for later triage, not flagged. */
const SODIUM_GUARD_PATTERN =
    /\b(salts?|salted|seasonings?|bouillon|bouillion|boullion|bullion|bouilion|broth|stock|base|cubes?|rub|mix|blend|gravy|marinade|sazon|adobo|msg|dashi|miso|electrolytes?|hydration|hydrate|brine[ds]?|cure[ds]?|curing)\b/i;

/** Sibling sodium medians above this are sauce/seasoning groups where a high
 *  row is plausible; the outlier rule only trusts clearly-food-like medians. */
const MAX_OUTLIER_SANE_MEDIAN = 5;

function readNum(nutrients: Record<string, unknown> | null, key: string): number | null {
    const v = nutrients?.[key];
    return typeof v === 'number' && isFinite(v) && v >= 0 ? v : null;
}

function readKcal(nutrients: Record<string, unknown> | null): number | null {
    return readNum(nutrients, 'calories') ?? readNum(nutrients, 'kcal');
}

function median(sorted: number[]): number {
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface Row { barcode: string; name: string; brandName: string | null; servingGrams: number | null; nutrientsPer100g: unknown }

async function* streamRows(db: ScanDb): AsyncGenerator<Row[]> {
    let cursor: string | undefined;
    for (;;) {
        const batch: Row[] = await db.offFood.findMany({
            select: { barcode: true, name: true, brandName: true, servingGrams: true, nutrientsPer100g: true },
            // Marked and deduped rows are already out of retrieval; skipping
            // them also keeps the sibling sodium medians clean.
            where: { nutrientsPer100g: { not: undefined }, corruptReason: null, duplicateOfBarcode: null },
            orderBy: { barcode: 'asc' },
            take: BATCH,
            ...(cursor ? { cursor: { barcode: cursor }, skip: 1 } : {}),
        });
        if (!batch.length) return;
        yield batch;
        cursor = batch[batch.length - 1].barcode;
    }
}

/** The scan, injectable + exit-code returning. 0 = report written; 2 = the scan saw nothing. */
export async function runScan(db: ScanDb, opts: NutritionScanOptions = {}): Promise<number> {
    const MIN_GROUP = opts.minGroup ?? MIN_SODIUM_OUTLIER_GROUP;
    const PRINT = opts.print ?? 40;

    // Pass 1: sibling sodium distributions per name key (for the outlier rule).
    console.log('Pass 1: building sibling sodium medians...');
    const groups = new Map<string, number[]>();
    let scanned = 0;
    for await (const batch of streamRows(db)) {
        for (const r of batch) {
            const nutrients = r.nutrientsPer100g as Record<string, unknown> | null;
            const na = readNum(nutrients, 'sodium');
            if (na == null) continue;
            const key = normalizeNameKey(r.name);
            if (!key) continue;
            let g = groups.get(key);
            if (!g) { g = []; groups.set(key, g); }
            g.push(na);
        }
        scanned += batch.length;
        if (scanned % 200000 === 0) console.log(`  ${scanned} rows...`);
    }
    const sodiumMedians = new Map<string, { med: number; n: number }>();
    for (const [key, values] of groups) {
        if (values.length < MIN_GROUP) continue;
        values.sort((a, b) => a - b);
        sodiumMedians.set(key, { med: median(values), n: values.length });
    }
    groups.clear();
    console.log(`  ${scanned} rows, ${sodiumMedians.size} name groups with >=${MIN_GROUP} sodium values`);

    // Fail closed (playbook §11 class B): a scan that saw ZERO rows is a broken
    // instrument — wrong database, a filter typo, an exhausted table — not a
    // clean corpus. No report is written, so a failed run can never fake an
    // empty population downstream (mark-corrupt-off.ts consumes these files).
    if (scanned === 0) {
        console.error('FAIL: the scan saw ZERO rows. "Flagged 0 (of 0 scanned)" is a void run, not a clean corpus — no report written, exit 2.');
        return 2;
    }

    // Pass 2: per-row rules, first match wins.
    console.log('Pass 2: testing per-field rules...');
    const flagged: CorruptScanFlag[] = [];
    const guarded: Array<{ barcode: string; name: string; brandName: string | null; sodium: number }> = [];
    let sauceBand = 0;
    for await (const batch of streamRows(db)) {
        for (const r of batch) {
            const nutrients = r.nutrientsPer100g as Record<string, unknown> | null;
            const kcal = readKcal(nutrients);
            const protein = readNum(nutrients, 'protein');
            const fat = readNum(nutrients, 'fat');
            const carbs = readNum(nutrients, 'carbs');
            const na = readNum(nutrients, 'sodium');
            const macroSum = (protein ?? 0) + (fat ?? 0) + (carbs ?? 0);
            const names = `${r.name} ${r.brandName ?? ''}`;

            const base = {
                barcode: r.barcode, name: r.name, brandName: r.brandName,
                kcal100: kcal ?? 0, servingGrams: r.servingGrams,
                tier: 'direct' as const, rescaled: 0, siblingMedian: 0, groupSize: 0,
                triageConfirmed: false,
            };

            if (kcal != null && kcal > MAX_KCAL_100G) {
                flagged.push({ ...base, direction: 'kcal-impossible', value: kcal, check: { field: 'calories', value: kcal } });
                continue;
            }
            if (macroSum > MAX_MACRO_SUM_100G) {
                flagged.push({ ...base, direction: 'macro-sum-impossible', value: macroSum, check: { field: 'macroSum', value: macroSum } });
                continue;
            }
            const fiber = readNum(nutrients, 'fiber');
            if (fiber != null && fiber > MAX_COMPONENT_100G) {
                flagged.push({ ...base, direction: 'fiber-impossible', value: fiber, check: { field: 'fiber', value: fiber } });
                continue;
            }
            const sugars = readNum(nutrients, 'sugars');
            if (sugars != null && sugars > MAX_COMPONENT_100G) {
                flagged.push({ ...base, direction: 'sugars-impossible', value: sugars, check: { field: 'sugars', value: sugars } });
                continue;
            }
            if (na != null && na > MAX_SODIUM_100G) {
                flagged.push({ ...base, direction: 'sodium-impossible', value: na, check: { field: 'sodium', value: na } });
                continue;
            }
            if (na != null && na > SODIUM_IMPLAUSIBLE_100G) {
                if (SODIUM_GUARD_PATTERN.test(names)) {
                    guarded.push({ barcode: r.barcode, name: r.name, brandName: r.brandName, sodium: na });
                } else {
                    flagged.push({ ...base, direction: 'sodium-implausible', value: na, check: { field: 'sodium', value: na } });
                }
                continue;
            }
            if (kcal != null && kcal >= KJ_MIN_KCAL && protein != null && fat != null && carbs != null) {
                // EU-style labels exclude fiber from carbs, and fiber still
                // carries ~2 kcal/g — without the fiber term, psyllium husk /
                // xanthan / inulin records (kcal ~200, carbs ~0) dominate the
                // class as false positives. Real kJ slips (4.184x) survive it.
                // Only trust fiber that fits in 100g alongside the macros:
                // multi-field-corrupt rows (chicken with fiber 260) otherwise
                // launder their kJ kcal through the fiber credit.
                const fiberCredit = fiber != null && macroSum + fiber <= MAX_MACRO_SUM_100G ? fiber : 0;
                const atwater = 4 * protein + 9 * fat + 4 * carbs + 2 * fiberCredit;
                if (atwater > 0 && kcal > KJ_ATWATER_MIN_RATIO * atwater && !ALCOHOL_PATTERN.test(names)) {
                    flagged.push({
                        ...base, direction: 'kj-as-kcal', value: kcal,
                        ratio: kcal / atwater, check: { field: 'calories', value: kcal },
                    });
                    continue;
                }
            }
            if (na != null && na > 4) sauceBand++;
            // Sibling-free per-serving-panel rule. Sits AFTER every absolute
            // per-field rule (a row that is individually impossible is better
            // described by that class) and after the sauceBand tally so the
            // existing diagnostic counters are unaffected. The macro-sum upper
            // bound is enforced inside the rule too, so it stays correct if the
            // precedence chain is ever reordered.
            if (protein != null && fat != null && carbs != null && kcal != null && r.servingGrams != null) {
                const panel: ServingScalePanel = {
                    kcal100: kcal, servingGrams: r.servingGrams, protein, fat, carbs,
                };
                if (rejectPanelInflatedServing(panel) == null) {
                    const implied = impliedServingKcal(panel);
                    flagged.push({
                        ...base, direction: 'panel-inflated-serving', value: implied,
                        rescaled: Math.round((kcal * 100) / r.servingGrams),
                        panel, check: { field: 'calories', value: kcal },
                    });
                    continue;
                }
            }
            if (na != null && na >= MIN_SODIUM_OUTLIER_G) {
                const m = sodiumMedians.get(normalizeNameKey(r.name));
                if (m && m.med > 0 && m.med <= MAX_OUTLIER_SANE_MEDIAN && na >= MIN_SODIUM_OUTLIER_RATIO * m.med) {
                    // Dry gravy/soup mixes legitimately sit 10-20x above their
                    // prepared same-name siblings — same guard as the band rule.
                    if (SODIUM_GUARD_PATTERN.test(names)) {
                        guarded.push({ barcode: r.barcode, name: r.name, brandName: r.brandName, sodium: na });
                    } else {
                        flagged.push({
                            ...base, direction: 'sodium-sibling-outlier', value: na,
                            ratio: na / m.med, siblingMedian: m.med, groupSize: m.n,
                            check: { field: 'sodium', value: na },
                        });
                    }
                }
            }
        }
    }

    const byDirection: Record<string, number> = {};
    for (const f of flagged) byDirection[f.direction] = (byDirection[f.direction] ?? 0) + 1;

    const outDir = opts.outDir ?? path.join(__dirname, 'results');
    fs.mkdirSync(outDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(outDir, `corrupt-nutrition-scan-${ts}.json`);
    fs.writeFileSync(outPath, JSON.stringify({
        at: new Date().toISOString(),
        params: { minGroup: MIN_GROUP },
        summary: {
            scanned,
            flagged: flagged.length,
            byDirection,
            guardedSkipped: guarded.length,
            sodiumSauceBandUnflagged: sauceBand,
        },
        flagged,
        guarded: guarded.slice(0, 1000),
    }, null, 1));

    console.log(`\nFlagged ${flagged.length} rows (of ${scanned} scanned): ${JSON.stringify(byDirection)}`);
    console.log(`Guarded (seasoning-class names, sodium > ${SODIUM_IMPLAUSIBLE_100G}g, NOT flagged): ${guarded.length}`);
    console.log(`Sauce band (sodium 4-${SODIUM_IMPLAUSIBLE_100G}g, NOT flagged — needs identity-aware triage): ${sauceBand}`);
    const bySeverity = [...flagged].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    for (const f of bySeverity.slice(0, PRINT)) {
        const extra = f.direction === 'sodium-sibling-outlier'
            ? ` (${(f.ratio ?? 0).toFixed(1)}x sibling median ${f.siblingMedian.toFixed(2)}g, n=${f.groupSize})`
            : f.direction === 'kj-as-kcal' ? ` (${(f.ratio ?? 0).toFixed(1)}x Atwater)` : '';
        console.log(`  ${f.barcode} "${f.name}"${f.brandName ? ` [${f.brandName}]` : ''} (${f.direction}): ${f.value}${extra}`);
    }
    if (flagged.length > PRINT) console.log(`  ... ${flagged.length - PRINT} more in the report file`);

    // panel-inflated-serving reads differently from the per-field classes (the
    // value is an implied SERVING energy, not a per-100g field), so it gets its
    // own block instead of competing in the shared severity list.
    const servingScale = flagged.filter(f => f.direction === 'panel-inflated-serving');
    if (servingScale.length) {
        console.log(`\npanel-inflated-serving (${servingScale.length} rows, implied serving kcal > ${MIN_IMPLIED_SERVING_KCAL}):`);
        for (const f of servingScale.sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, PRINT)) {
            const p = f.panel!;
            console.log(`  ${f.barcode} "${f.name}"${f.brandName ? ` [${f.brandName}]` : ''}: ` +
                `${p.kcal100} kcal/100g x ${p.servingGrams}g = ${Math.round(f.value ?? 0)} kcal/serving ` +
                `(macro sum ${(p.protein + p.fat + p.carbs).toFixed(1)} g/100g, ` +
                `panel-as-serving reads ${f.rescaled} kcal/100g)`);
        }
        if (servingScale.length > PRINT) console.log(`  ... ${servingScale.length - PRINT} more in the report file`);
    }
    console.log(`\nReport written to ${path.relative(process.cwd(), outPath)}`);
    console.log('Next: scripts/mark-corrupt-off.ts --file <report> (dry-run first, then --apply after approval).');
    return 0;
}

// Guarded so runScan is importable by the offline test suite (this file used
// to construct a PrismaClient and start the scan at import time).
if (require.main === module) {
    const args = process.argv.slice(2);
    const argValue = (flag: string): string | undefined => {
        const i = args.indexOf(flag);
        return i >= 0 ? args[i + 1] : undefined;
    };
    const prisma = new PrismaClient();
    runScan(prisma as unknown as ScanDb, {
        minGroup: Number(argValue('--min-group') ?? MIN_SODIUM_OUTLIER_GROUP),
        print: Number(argValue('--print') ?? 40),
    })
        .then(code => { if (code !== 0) process.exitCode = code; })
        .catch(err => { console.error(err); process.exitCode = 2; })
        .finally(() => prisma.$disconnect().catch(() => {}));
}
