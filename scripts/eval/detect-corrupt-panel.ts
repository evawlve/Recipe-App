/**
 * detect-corrupt-panel.ts — corpus scan for the "per-serving panel stored as
 * per-100g" OFF corruption family (REPORT-ONLY, writes nothing).
 *
 * The 2026-07-20 warm-cache triage confirmed 17 OFF records whose per-100g
 * nutrition fields actually hold the label's per-SERVING panel (oreo at
 * 143 kcal/100g = the 2-cookie serving, monster at 140 = the can, etc.).
 * The mechanical signature: the stored kcal100 is far BELOW the same-name
 * sibling median, and rescaling it by 100/servingGrams lands ON the median.
 *
 * Detection (sibling groups keyed by normalizeNameKey(name), the query-time
 * dedupe key, with >= --min-group members for a robust median):
 *   flag when kcal100 < 0.6 * siblingMedian
 *        and |kcal100 * 100/serving - siblingMedian| <= 0.3 * siblingMedian
 *   where serving is the row's own servingGrams in [2, 95] (tier "direct"),
 *   falling back to the group's median servingGrams (tier "sibling-serving")
 *   when the corrupt row carries none — corrupt rows often do.
 *
 * Groups whose MEDIAN exceeds 950 kcal/100g (physical max ~900 for pure fat)
 * are excluded from the signature test and reported separately: those are a
 * different corruption family (mass-INFLATED per-100g values — e.g. whole
 * maraschino-cherry name groups with medians of 3200), where the plausible-
 * looking row is the healthy one, not the corrupt one.
 *
 * The 17 triage-confirmed barcodes are cross-checked at the end; misses are
 * reported with the reason so the marking PR can carry them explicitly.
 *
 * NOTE ON MARKING: duplicateOfBarcode is NOT a safe vehicle for corrupt marks —
 * dedupe-off-mark.ts clears and recomputes all marks on every run. Exclusion
 * needs its own column (planned with PR D pt3); this scan produces the input.
 *
 * Run (from repo root, read-only):
 *   npx ts-node -r tsconfig-paths/register --transpile-only --compilerOptions \
 *     '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/eval/detect-corrupt-panel.ts [--min-group 4] [--print 40]
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { normalizeNameKey } from '../../src/lib/search/dedupe-candidates';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
}
const MIN_GROUP = Number(argValue('--min-group') ?? 4);
const PRINT = Number(argValue('--print') ?? 40);
const BATCH = 20000;

/** Confirmed corrupt in the 2026-07-20 warm-cache triage (adversarial verify vs live corpus). */
const TRIAGE_CONFIRMED = [
    'off_0001424435577', 'off_0033864074825', 'off_0062020001849', 'off_0070847030607',
    'off_0074734129207', 'off_0080000515568', 'off_0234794000001', 'off_0643843714903',
    'off_0876063004619', 'off_5099839070778', 'off_6915917000460', 'off_7622201779160',
    'off_8683036407634', 'off_9201070382107', 'off_9300675012089', 'off_9300675031226',
    'off_9339687445134',
].map(b => b.slice(4));

function readKcal(nutrients: unknown): number | null {
    const n = nutrients as { calories?: number; kcal?: number } | null;
    const v = n?.calories ?? n?.kcal;
    return typeof v === 'number' && isFinite(v) && v > 0 ? v : null;
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
            where: { nutrientsPer100g: { not: undefined } },
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
    // Pass 1: sibling kcal + serving distributions per name key
    console.log('Pass 1: building sibling kcal/serving medians...');
    const groups = new Map<string, { kcals: number[]; servings: number[] }>();
    let scanned = 0;
    for await (const batch of streamRows()) {
        for (const r of batch) {
            const kcal = readKcal(r.nutrientsPer100g);
            if (kcal == null) continue;
            const key = normalizeNameKey(r.name);
            if (!key) continue;
            let g = groups.get(key);
            if (!g) { g = { kcals: [], servings: [] }; groups.set(key, g); }
            g.kcals.push(kcal);
            if (r.servingGrams != null && r.servingGrams >= 2 && r.servingGrams <= 600) {
                g.servings.push(r.servingGrams);
            }
        }
        scanned += batch.length;
        if (scanned % 200000 === 0) console.log(`  ${scanned} rows...`);
    }
    const MAX_SANE_MEDIAN = 950; // physical ceiling ~900 kcal/100g (pure fat)
    const medians = new Map<string, { med: number; n: number; medServing: number | null }>();
    const inflatedGroups: Array<{ key: string; med: number; n: number }> = [];
    for (const [key, g] of groups) {
        if (g.kcals.length < MIN_GROUP) continue;
        g.kcals.sort((a, b) => a - b);
        const med = median(g.kcals);
        if (med > MAX_SANE_MEDIAN) {
            inflatedGroups.push({ key, med: Math.round(med), n: g.kcals.length });
            continue; // mass-inflated family — the low rows here are the healthy ones
        }
        g.servings.sort((a, b) => a - b);
        medians.set(key, {
            med, n: g.kcals.length,
            medServing: g.servings.length >= 2 ? median(g.servings) : null,
        });
    }
    groups.clear();
    console.log(`  ${scanned} rows, ${medians.size} sane name groups with >=${MIN_GROUP} members, ${inflatedGroups.length} mass-inflated groups (median > ${MAX_SANE_MEDIAN}) excluded`);

    // Pass 2: test the panel-as-100g signature
    console.log('Pass 2: testing serving-rescale signature...');
    const flagged: Array<{
        barcode: string; name: string; brandName: string | null;
        kcal100: number; servingGrams: number; tier: 'direct' | 'sibling-serving';
        direction: 'panel-low' | 'panel-inflated';
        rescaled: number; siblingMedian: number; groupSize: number; triageConfirmed: boolean;
    }> = [];
    for await (const batch of streamRows()) {
        for (const r of batch) {
            const kcal = readKcal(r.nutrientsPer100g);
            if (kcal == null) continue;
            const m = medians.get(normalizeNameKey(r.name));
            if (!m || m.med <= 0) continue;
            const own = r.servingGrams != null && r.servingGrams >= 2 && r.servingGrams <= 600;
            const s = own ? r.servingGrams! : m.medServing;
            // Servings near 100g can't distinguish panel-as-100g from correct data
            if (s == null || (s > 90 && s < 110)) continue;
            const rescaled = kcal * (100 / s);
            // Serving < 100g stores the panel LOW (oil at 120), > 100g stores it
            // INFLATED (a 473ml Monster can panel at 140 vs ~47 real density).
            const direction = kcal <= 0.6 * m.med ? 'panel-low'
                : kcal >= 1.6 * m.med ? 'panel-inflated' : null;
            if (direction && Math.abs(rescaled - m.med) <= 0.3 * m.med) {
                flagged.push({
                    barcode: r.barcode, name: r.name, brandName: r.brandName,
                    kcal100: kcal, servingGrams: s, tier: own ? 'direct' : 'sibling-serving',
                    direction,
                    rescaled: Math.round(rescaled), siblingMedian: Math.round(m.med), groupSize: m.n,
                    triageConfirmed: TRIAGE_CONFIRMED.includes(r.barcode),
                });
            }
        }
    }

    flagged.sort((a, b) => b.siblingMedian - a.siblingMedian);
    const outDir = path.join(__dirname, 'results');
    fs.mkdirSync(outDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(outDir, `corrupt-panel-scan-${ts}.json`);
    fs.writeFileSync(outPath, JSON.stringify({
        at: new Date().toISOString(),
        params: { minGroup: MIN_GROUP },
        summary: { scanned, flagged: flagged.length },
        flagged,
    }, null, 1));

    const low = flagged.filter(f => f.direction === 'panel-low').length;
    const inflated = flagged.filter(f => f.direction === 'panel-inflated').length;
    console.log(`\nFlagged ${flagged.length} rows (of ${scanned} scanned): ${low} panel-low, ${inflated} panel-inflated`);
    for (const f of flagged.slice(0, PRINT)) {
        const tag = f.triageConfirmed ? ' [TRIAGE-CONFIRMED]' : '';
        console.log(`  ${f.barcode} "${f.name}"${f.brandName ? ` [${f.brandName}]` : ''} (${f.direction}/${f.tier}): ${f.kcal100} kcal/100g, serving ${f.servingGrams}g -> rescaled ${f.rescaled} vs sibling median ${f.siblingMedian} (n=${f.groupSize})${tag}`);
    }
    if (flagged.length > PRINT) console.log(`  ... ${flagged.length - PRINT} more in the report file`);

    // Cross-check: which triage-confirmed records did the scan catch?
    console.log('\nTriage-confirmed cross-check:');
    const flaggedSet = new Set(flagged.map(f => f.barcode));
    for (const b of TRIAGE_CONFIRMED) {
        if (flaggedSet.has(b)) { console.log(`  CAUGHT  off_${b}`); continue; }
        const row = await prisma.offFood.findUnique({
            where: { barcode: b },
            select: { name: true, servingGrams: true, nutrientsPer100g: true },
        });
        if (!row) { console.log(`  MISSING off_${b}: not in DB`); continue; }
        const kcal = readKcal(row.nutrientsPer100g);
        const m = medians.get(normalizeNameKey(row.name));
        console.log(`  MISSED  off_${b} "${row.name}": kcal=${kcal}, servingGrams=${row.servingGrams}, siblingGroup=${m ? `${m.n} med ${Math.round(m.med)}` : 'none/too-small'}`);
    }

    console.log(`\nReport written to ${path.relative(process.cwd(), outPath)}`);
}

main()
    .catch(err => { console.error(err); process.exit(2); })
    .finally(() => prisma.$disconnect());
