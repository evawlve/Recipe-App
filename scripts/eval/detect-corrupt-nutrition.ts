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
    MAX_SODIUM_100G,
    SODIUM_IMPLAUSIBLE_100G,
    KJ_ATWATER_MIN_RATIO,
    KJ_MIN_KCAL,
    MIN_SODIUM_OUTLIER_GROUP,
    MIN_SODIUM_OUTLIER_RATIO,
    MIN_SODIUM_OUTLIER_G,
} from '../../src/lib/mapping/corrupt-mark';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
}
const MIN_GROUP = Number(argValue('--min-group') ?? MIN_SODIUM_OUTLIER_GROUP);
const PRINT = Number(argValue('--print') ?? 40);
const BATCH = 20000;

/** Foods that legitimately live above SODIUM_IMPLAUSIBLE_100G: pure salts,
 *  bouillon/stock concentrates, seasoning/gravy powders, electrolyte mixes.
 *  Word-bounded so "salted caramel" is guarded (conservative skip) but
 *  "sardines" is not. Guarded rows are reported for later triage, not flagged. */
const SODIUM_GUARD_PATTERN =
    /\b(salts?|salted|seasonings?|bouill?[oi]ll?on|broth|stock|base|cubes?|rub|mix|blend|gravy|marinade|sazon|adobo|msg|dashi|miso|electrolytes?|hydration|brine[ds]?|cure[ds]?|curing)\b/i;

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

interface Row { barcode: string; name: string; brandName: string | null; servingGrams: number | null; nutrientsPer100g: unknown }

async function* streamRows(): AsyncGenerator<Row[]> {
    let cursor: string | undefined;
    for (;;) {
        const batch: Row[] = await prisma.offFood.findMany({
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

async function main() {
    // Pass 1: sibling sodium distributions per name key (for the outlier rule).
    console.log('Pass 1: building sibling sodium medians...');
    const groups = new Map<string, number[]>();
    let scanned = 0;
    for await (const batch of streamRows()) {
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

    // Pass 2: per-row rules, first match wins.
    console.log('Pass 2: testing per-field rules...');
    const flagged: CorruptScanFlag[] = [];
    const guarded: Array<{ barcode: string; name: string; brandName: string | null; sodium: number }> = [];
    let sauceBand = 0;
    for await (const batch of streamRows()) {
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
                const atwater = 4 * protein + 9 * fat + 4 * carbs;
                if (atwater > 0 && kcal > KJ_ATWATER_MIN_RATIO * atwater && !ALCOHOL_PATTERN.test(names)) {
                    flagged.push({
                        ...base, direction: 'kj-as-kcal', value: kcal,
                        ratio: kcal / atwater, check: { field: 'calories', value: kcal },
                    });
                    continue;
                }
            }
            if (na != null && na > 4) sauceBand++;
            if (na != null && na >= MIN_SODIUM_OUTLIER_G) {
                const m = sodiumMedians.get(normalizeNameKey(r.name));
                if (m && m.med > 0 && m.med <= MAX_OUTLIER_SANE_MEDIAN && na >= MIN_SODIUM_OUTLIER_RATIO * m.med) {
                    flagged.push({
                        ...base, direction: 'sodium-sibling-outlier', value: na,
                        ratio: na / m.med, siblingMedian: m.med, groupSize: m.n,
                        check: { field: 'sodium', value: na },
                    });
                }
            }
        }
    }

    const byDirection: Record<string, number> = {};
    for (const f of flagged) byDirection[f.direction] = (byDirection[f.direction] ?? 0) + 1;

    const outDir = path.join(__dirname, 'results');
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
    console.log(`\nReport written to ${path.relative(process.cwd(), outPath)}`);
    console.log('Next: scripts/mark-corrupt-off.ts --file <report> (dry-run first, then --apply after approval).');
}

main()
    .catch(err => { console.error(err); process.exit(2); })
    .finally(() => prisma.$disconnect());
