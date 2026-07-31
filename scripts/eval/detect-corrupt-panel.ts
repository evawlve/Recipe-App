/**
 * detect-corrupt-panel.ts — corpus scan for the "per-serving panel stored as
 * per-100g" OFF corruption family (REPORT-ONLY, writes nothing).
 *
 * The 2026-07-20 warm-cache triage confirmed 17 OFF records whose per-100g
 * nutrition fields actually hold the label's per-SERVING panel (oreo at
 * 143 kcal/100g = the 2-cookie serving, monster at 140 = the can, etc.).
 * The mechanical signature: the stored kcal100 sits far off the same-name
 * sibling median, and rescaling it by 100/servingGrams lands ON the median.
 * The defect has TWO halves and this scan detects both:
 *   - serving < 100 g stores the panel LOW  -> direction "panel-low"
 *   - serving > 100 g stores it INFLATED    -> direction "panel-inflated"
 *
 * ===========================================================================
 * TIER 1 — exact-name siblings (directions "panel-low" / "panel-inflated")
 * ===========================================================================
 * Sibling groups keyed by normalizeNameKey(name), the query-time dedupe key,
 * with >= --min-group members for a robust median:
 *   flag when kcal100 <= 0.6 * siblingMedian   (panel-low)
 *          or kcal100 >= 1.6 * siblingMedian   (panel-inflated)
 *        and |kcal100 * 100/serving - siblingMedian| <= 0.3 * siblingMedian
 *   where serving is the row's own servingGrams in [2, 600] (tier "direct"),
 *   falling back to the group's median servingGrams (tier "sibling-serving")
 *   when the corrupt row carries none — corrupt rows often do. Servings in
 *   (90, 110) are skipped: there the two readings are indistinguishable.
 *
 * ===========================================================================
 * TIER 2 — family siblings (direction "panel-inflated-family")
 * ===========================================================================
 * WHY IT EXISTS. normalizeNameKey() is a token-SET identity: it sorts and
 * dedupes, but does not generalize. One extra brand or flavour token puts a
 * row in a group of its own, where tier 1 cannot reach it however corrupt it
 * is. Measured on the live corpus 2026-07-31 (pass 1 prints these counters on
 * every run, so they re-derive themselves): 661,150 of 1,083,139 kcal-bearing
 * rows — 61.0% — sit in groups below MIN_GROUP=4 and are never signature-
 * tested at all. The share rises monotonically with name length: 25.5% at one
 * token, 55.3% at three, 85.3% at five, 98.3% at eight or more. Brandedness is
 * NOT the axis (61.8% branded vs 58.9% unbranded); name LENGTH is.
 *
 * The two live examples that motivated the tier, both invisible to tier 1:
 *   off_9568310020398 "Fairlife core power elite" -> key `core elite fairlife
 *     power`, group size 1
 *   off_9337369550008 "Core power elite vanilla"  -> key `core elite power
 *     vanilla`, group size 2
 * Both store 230 kcal/100g with servingGrams 414 — the whole 414 mL bottle's
 * panel — against a true density of 55.6, and off_9568310020398 is the record
 * behind golden-eval case n-supp-23's 4.14x over-bill.
 *
 * THE KEY. Drop the row's brand tokens, then drop every token whose corpus
 * document frequency exceeds FAMILY_DF_MAX; keep the rest. What survives is
 * the discriminative core of the name, so `Fairlife core power elite`,
 * `Core power elite vanilla` and `Core Power Elite Chocolate` all land on
 * `core elite power` (n=16, median 55.6) while plain `Core Power High Protein
 * Milk Shake` lands on `core power` (n=55, median 41.1) — a genuinely
 * different product at a genuinely different density.
 *
 * A COARSER GROUP IS A WEAKER REFERENCE, so tier 2 is strictly tighter than
 * tier 1 everywhere else, and every threshold comes from a hand audit rather
 * than from inspection (playbook section 2: a rule can score 100% on a fixture
 * and be the worst rule in the population). The thresholds and the measured
 * evidence for each live in src/lib/mapping/corrupt-mark.ts next to
 * rejectPanelInflatedFamily(), which is the rule; this file only supplies the
 * grouping. In summary: >= 2 key tokens, >= 8 members, group relative MAD
 * <= 0.10, rescale tolerance 0.15 (not 0.30), and barcode length <= 13.
 *
 * Tier 2 emits the INFLATED direction only. The deflated half is deliberately
 * out of scope so a restore of the tier-1 panel-low population cannot become
 * entangled with this one; that is a scope decision, not evidence that the
 * deflated half is clean under family grouping.
 *
 * MEASURED (live corpus 2026-07-31, --min-group 4, 1,085,525 rows):
 *   tier 1   7,354 rows — 5,365 panel-low, 1,989 panel-inflated
 *            (byte-identical to the pre-tier-2 baseline run: this change adds
 *            a population, it does not move the existing one)
 *   tier 2      31 rows — panel-inflated-family, disjoint from tier 1 by
 *            construction, over 3,889 family groups with >= 8 members
 *
 * ALL 31 WERE HAND-AUDITED against each row's own macro panel and servingSize
 * string: 21 true positives, 9 false positives, 1 undecidable — a 29.0% FP
 * rate, pinned as FAMILY_TIER_AUDITED_FP_RATE in corrupt-mark.ts with the
 * failure mode described. THIS IS A REVIEW QUEUE, NOT A MARK LIST. Nothing
 * here may be fed to mark-corrupt-off.ts --apply without a fresh audit.
 *
 * ===========================================================================
 * Groups whose MEDIAN exceeds 950 kcal/100g (physical max ~900 for pure fat)
 * are excluded from BOTH tiers' signature tests and reported separately: those
 * are a different corruption family (mass-INFLATED per-100g values — e.g.
 * whole maraschino-cherry name groups with medians of 3200), where the
 * plausible-looking row is the healthy one, not the corrupt one.
 *
 * The 17 triage-confirmed barcodes are cross-checked at the end; misses are
 * reported with the reason so the marking PR can carry them explicitly.
 *
 * NOTE ON MARKING: duplicateOfBarcode is NOT a safe vehicle for corrupt marks —
 * dedupe-off-mark.ts clears and recomputes all marks on every run. Exclusion
 * needs its own column (planned with PR D pt3); this scan produces the input.
 *
 * Run (from repo root, read-only):
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register \
 *     scripts/eval/detect-corrupt-panel.ts [--min-group 4] [--print 40]
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { normalizeNameKey } from '../../src/lib/search/dedupe-candidates';
import {
    FAMILY_MIN_TOKENS,
    FAMILY_MIN_GROUP,
    rejectPanelInflatedFamily,
    type FamilyRejection,
} from '../../src/lib/mapping/corrupt-mark';

const BATCH = 20000;

/**
 * A token appearing in more than this many product names is a generic modifier
 * (`chocolate` 58,054, `organic` 34,467, `protein` 25,343) rather than part of
 * a product's identity, and keeping it fragments the family. Dropping it is
 * what lets `Core power elite vanilla` join `Core Power Elite Chocolate`.
 *
 * Lives here rather than in corrupt-mark.ts because it is a GROUPING parameter
 * of the scan, not a trust rule: decideMark() cannot re-derive a corpus-wide
 * document frequency offline, so it re-verifies the group's measured median,
 * size and dispersion instead.
 *
 * Measured on the live corpus 2026-07-31 (both targets found at every value):
 *   2000 -> `core elite power` n=16; 245,956 keys, 19,248 qualifying
 *   5000 -> `core elite power` n=11
 *  20000 -> `Core power elite vanilla` keeps `vanilla` (df 13,166) and falls
 *           back to a 2-member group — the split this tier exists to close.
 * 2000 is the loosest value that still strips flavour words corpus-wide.
 */
export const FAMILY_DF_MAX = 2000;

/**
 * The slice of PrismaClient this scan consumes — injectable so the
 * fail-injection tests can prove the zero-scan refusal offline
 * (__tests__/fail-open-sweep.test.ts).
 */
export interface ScanDb {
    offFood: {
        findMany(args: unknown): Promise<Row[]>;
        findUnique(args: unknown): Promise<Pick<Row, 'name' | 'servingGrams' | 'nutrientsPer100g'> | null>;
    };
}

export interface PanelScanOptions {
    minGroup?: number;
    print?: number;
    /** report directory; defaults to scripts/eval/results (tests inject a tmp dir) */
    outDir?: string;
    /**
     * Tier-2 generic-token cutoff; defaults to FAMILY_DF_MAX (2000).
     *
     * Overridable ONLY so a fixture can reproduce the corpus's token-frequency
     * RATIO at fixture scale: in a 60-row corpus every token is rare, so the
     * shipped 2000 would strip nothing and a test would exercise a grouping the
     * production run never performs. The production entrypoint below never
     * passes it. Playbook §2: a fixture number is a claim about the fixture —
     * this keeps the fixture's claim about the right function.
     */
    familyDfMax?: number;
}

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

/** Tokens of a name under the query-time dedupe key (sorted, deduped,
 *  singularized). Empty for names that normalize away entirely. */
export function nameTokens(s: string | null | undefined): string[] {
    if (!s) return [];
    const k = normalizeNameKey(s);
    return k ? k.split(' ').filter(Boolean) : [];
}

/**
 * The tier-2 family grouping key: the row's discriminative tokens, i.e. its
 * name tokens minus its brand tokens minus every corpus-generic token.
 *
 * Returns null when fewer than FAMILY_MIN_TOKENS survive. Playbook section 3:
 * "any time you build a grouping key by stripping tokens, ask what happens when
 * the strip removes everything" — here it does so 313,369 times on the live
 * corpus, and a single-token key is exactly the fusion that produced the worst
 * measured false positives (`filet`, `ale`, `ricotta`), so the floor is 2 and
 * an under-length key is EXCLUDED rather than backed off to.
 */
export function familyKey(
    name: string,
    brandName: string | null,
    df: ReadonlyMap<string, number>,
    dfMax: number = FAMILY_DF_MAX
): string | null {
    const brand = new Set(nameTokens(brandName));
    const keep = nameTokens(name).filter(
        t => !brand.has(t) && (df.get(t) ?? 0) <= dfMax
    );
    return keep.length >= FAMILY_MIN_TOKENS ? keep.join(' ') : null;
}

/**
 * median(|x - med|) / med over a group's kcal100 values — how tight the family
 * is, measured robustly so the corrupt members do not inflate it themselves.
 * A mean/stddev here would be moved by the very rows being detected.
 */
export function relativeMad(values: number[], med: number): number {
    if (!(med > 0) || !values.length) return Infinity;
    const devs = values.map(v => Math.abs(v - med)).sort((a, b) => a - b);
    return median(devs) / med;
}

export interface FamilyStats { med: number; n: number; relMad: number }

export interface Row { barcode: string; name: string; brandName: string | null; servingGrams: number | null; nutrientsPer100g: unknown }

async function* streamRows(db: ScanDb): AsyncGenerator<Row[]> {
    let cursor: string | undefined;
    for (;;) {
        const batch: Row[] = await db.offFood.findMany({
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

/** The scan, injectable + exit-code returning. 0 = report written; 2 = the scan saw nothing. */
export async function runScan(db: ScanDb, opts: PanelScanOptions = {}): Promise<number> {
    const MIN_GROUP = opts.minGroup ?? 4;
    const PRINT = opts.print ?? 40;
    const DF_MAX = opts.familyDfMax ?? FAMILY_DF_MAX;

    // Pass 1: sibling kcal + serving distributions per name key, plus the token
    // document frequencies tier 2's family key is derived from.
    console.log('Pass 1: building sibling kcal/serving medians + token frequencies...');
    const groups = new Map<string, { kcals: number[]; servings: number[] }>();
    const df = new Map<string, number>();
    let scanned = 0;
    let kcalBearing = 0;
    for await (const batch of streamRows(db)) {
        for (const r of batch) {
            const kcal = readKcal(r.nutrientsPer100g);
            if (kcal == null) continue;
            const key = normalizeNameKey(r.name);
            if (!key) continue;
            kcalBearing++;
            for (const t of key.split(' ')) df.set(t, (df.get(t) ?? 0) + 1);
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
    // The reachability measurement tier 2 exists to close. Printed every run so
    // it re-derives itself rather than living as a number in prose.
    let belowMinGroup = 0;
    for (const g of groups.values()) if (g.kcals.length < MIN_GROUP) belowMinGroup += g.kcals.length;
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
    const nameGroupCount = groups.size;
    groups.clear();
    console.log(`  ${scanned} rows, ${medians.size} sane name groups with >=${MIN_GROUP} members, ${inflatedGroups.length} mass-inflated groups (median > ${MAX_SANE_MEDIAN}) excluded`);
    console.log(`  REACHABILITY: ${kcalBearing} kcal-bearing rows in ${nameGroupCount} exact name groups; ${belowMinGroup} rows (${kcalBearing ? (100 * belowMinGroup / kcalBearing).toFixed(1) : '0'}%) sit in groups below MIN_GROUP=${MIN_GROUP} and are UNREACHABLE by tier 1`);

    // Fail closed (playbook §11 class B): a scan that saw ZERO rows is a broken
    // instrument, not a clean corpus. No report is written, so a failed run can
    // never fake an empty population downstream.
    if (scanned === 0) {
        console.error('FAIL: the scan saw ZERO rows. "Flagged 0 (of 0 scanned)" is a void run, not a clean corpus — no report written, exit 2.');
        return 2;
    }

    // Pass 2: family (discriminative-token) groups for tier 2.
    console.log('Pass 2: building family groups...');
    const familyKcals = new Map<string, number[]>();
    for await (const batch of streamRows(db)) {
        for (const r of batch) {
            const kcal = readKcal(r.nutrientsPer100g);
            if (kcal == null) continue;
            const fk = familyKey(r.name, r.brandName, df, DF_MAX);
            if (!fk) continue;
            let a = familyKcals.get(fk);
            if (!a) { a = []; familyKcals.set(fk, a); }
            a.push(kcal);
        }
    }
    const families = new Map<string, FamilyStats>();
    for (const [k, a] of familyKcals) {
        if (a.length < FAMILY_MIN_GROUP) continue;
        a.sort((x, y) => x - y);
        const med = median(a);
        if (!(med > 0)) continue;
        families.set(k, { med, n: a.length, relMad: relativeMad(a, med) });
    }
    familyKcals.clear();
    console.log(`  ${families.size} family groups with >=${FAMILY_MIN_GROUP} members`);

    // Pass 3: test both signatures
    console.log('Pass 3: testing serving-rescale signatures...');
    const familySkips = new Map<FamilyRejection, number>();
    const flagged: Array<{
        barcode: string; name: string; brandName: string | null;
        kcal100: number; servingGrams: number; tier: 'direct' | 'sibling-serving';
        direction: 'panel-low' | 'panel-inflated' | 'panel-inflated-family';
        rescaled: number; siblingMedian: number; groupSize: number; triageConfirmed: boolean;
        family?: { key: string; relMad: number; median: number };
    }> = [];
    for await (const batch of streamRows(db)) {
        for (const r of batch) {
            const kcal = readKcal(r.nutrientsPer100g);
            if (kcal == null) continue;
            const m = medians.get(normalizeNameKey(r.name));
            let tier1Flagged = false;
            if (m && m.med > 0) {
                const own = r.servingGrams != null && r.servingGrams >= 2 && r.servingGrams <= 600;
                const s = own ? r.servingGrams! : m.medServing;
                // Servings near 100g can't distinguish panel-as-100g from correct data
                if (s != null && !(s > 90 && s < 110)) {
                    const rescaled = kcal * (100 / s);
                    // Serving < 100g stores the panel LOW (oil at 120), > 100g stores it
                    // INFLATED (a 473ml Monster can panel at 140 vs ~47 real density).
                    const direction = kcal <= 0.6 * m.med ? 'panel-low'
                        : kcal >= 1.6 * m.med ? 'panel-inflated' : null;
                    if (direction && Math.abs(rescaled - m.med) <= 0.3 * m.med) {
                        tier1Flagged = true;
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

            // Tier 2. Only rows tier 1 did not already decide about, so the two
            // populations never overlap and a restore of one cannot touch the
            // other. Family tier uses the row's OWN serving only: a borrowed
            // sibling serving on top of a borrowed sibling median is two
            // inferences deep, which is more than this reference can carry.
            if (tier1Flagged) continue;
            const fk = familyKey(r.name, r.brandName, df, DF_MAX);
            if (!fk) continue;
            const fam = families.get(fk);
            if (!fam) continue;
            const rejection = rejectPanelInflatedFamily({
                barcode: r.barcode,
                kcal100: kcal,
                servingGrams: r.servingGrams ?? NaN,
                familyMedian: fam.med,
                groupSize: fam.n,
                relMad: fam.relMad,
            });
            if (rejection) {
                familySkips.set(rejection, (familySkips.get(rejection) ?? 0) + 1);
                continue;
            }
            flagged.push({
                barcode: r.barcode, name: r.name, brandName: r.brandName,
                kcal100: kcal, servingGrams: r.servingGrams!, tier: 'direct',
                direction: 'panel-inflated-family',
                rescaled: Math.round(kcal * (100 / r.servingGrams!)),
                siblingMedian: Math.round(fam.med), groupSize: fam.n,
                triageConfirmed: TRIAGE_CONFIRMED.includes(r.barcode),
                family: { key: fk, relMad: fam.relMad, median: fam.med },
            });
        }
    }

    flagged.sort((a, b) => b.siblingMedian - a.siblingMedian);
    const outDir = opts.outDir ?? path.join(__dirname, 'results');
    fs.mkdirSync(outDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(outDir, `corrupt-panel-scan-${ts}.json`);
    fs.writeFileSync(outPath, JSON.stringify({
        at: new Date().toISOString(),
        params: { minGroup: MIN_GROUP, familyDfMax: DF_MAX, familyMinGroup: FAMILY_MIN_GROUP },
        summary: {
            scanned,
            kcalBearing,
            rowsBelowMinGroup: belowMinGroup,
            nameGroups: nameGroupCount,
            familyGroups: families.size,
            flagged: flagged.length,
        },
        flagged,
    }, null, 1));

    const low = flagged.filter(f => f.direction === 'panel-low').length;
    const inflated = flagged.filter(f => f.direction === 'panel-inflated').length;
    const family = flagged.filter(f => f.direction === 'panel-inflated-family').length;
    console.log(`\nFlagged ${flagged.length} rows (of ${scanned} scanned): ${low} panel-low, ${inflated} panel-inflated, ${family} panel-inflated-family`);
    for (const f of flagged.slice(0, PRINT)) {
        const tag = f.triageConfirmed ? ' [TRIAGE-CONFIRMED]' : '';
        const fam = f.family ? ` family="${f.family.key}" relMad=${f.family.relMad.toFixed(3)}` : '';
        console.log(`  ${f.barcode} "${f.name}"${f.brandName ? ` [${f.brandName}]` : ''} (${f.direction}/${f.tier}): ${f.kcal100} kcal/100g, serving ${f.servingGrams}g -> rescaled ${f.rescaled} vs sibling median ${f.siblingMedian} (n=${f.groupSize})${fam}${tag}`);
    }
    if (flagged.length > PRINT) console.log(`  ... ${flagged.length - PRINT} more in the report file`);

    // Every tier-2 refusal, by named condition. A detector that prints only its
    // hits cannot be told apart from one that is not running (playbook §2).
    console.log('\npanel-inflated-family refusals by condition:');
    for (const [reason, n] of [...familySkips.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${reason}: ${n}`);
    }
    console.log(`\nFAMILY TIER FLAGS (all ${family}):`);
    for (const f of flagged.filter(x => x.direction === 'panel-inflated-family')) {
        console.log(`  ${f.barcode} "${f.name}" [${f.brandName ?? ''}] ${f.kcal100} kcal/100g @${f.servingGrams}g -> ${f.rescaled} vs family "${f.family!.key}" median ${f.siblingMedian} (n=${f.groupSize}, relMad ${f.family!.relMad.toFixed(3)})`);
    }

    // Cross-check: which triage-confirmed records did the scan catch?
    console.log('\nTriage-confirmed cross-check:');
    const flaggedSet = new Set(flagged.map(f => f.barcode));
    for (const b of TRIAGE_CONFIRMED) {
        if (flaggedSet.has(b)) { console.log(`  CAUGHT  off_${b}`); continue; }
        const row = await db.offFood.findUnique({
            where: { barcode: b },
            select: { name: true, servingGrams: true, nutrientsPer100g: true },
        });
        if (!row) { console.log(`  MISSING off_${b}: not in DB`); continue; }
        const kcal = readKcal(row.nutrientsPer100g);
        const m = medians.get(normalizeNameKey(row.name));
        console.log(`  MISSED  off_${b} "${row.name}": kcal=${kcal}, servingGrams=${row.servingGrams}, siblingGroup=${m ? `${m.n} med ${Math.round(m.med)}` : 'none/too-small'}`);
    }

    console.log(`\nReport written to ${path.relative(process.cwd(), outPath)}`);
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
        minGroup: Number(argValue('--min-group') ?? 4),
        print: Number(argValue('--print') ?? 40),
    })
        .then(code => { if (code !== 0) process.exitCode = code; })
        .catch(err => { console.error(err); process.exitCode = 2; })
        .finally(() => prisma.$disconnect().catch(() => {}));
}
