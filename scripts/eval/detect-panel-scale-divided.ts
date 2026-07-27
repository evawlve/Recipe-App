/**
 * detect-panel-scale-divided.ts — corpus scan for the "panel divided by
 * serving scale" OFF corruption family (READ-ONLY; there is no --execute path
 * in this file and it writes nothing to the database, by construction).
 *
 * ===========================================================================
 * THE MECHANISM
 * ===========================================================================
 * The OFF chain-restaurant import stores a per-100 g panel in OpenFoodFacts'
 * `*_serving` slot. OFF's own derivation then computes
 *
 *     _100g = _serving / serving_quantity * 100
 *
 * and so divides an already-per-100 g panel AGAIN. Net effect: EVERY numeric
 * field of `nutrientsPer100g` — calories AND all the macros — comes out
 * divided by `servingGrams / 100`.
 *
 * Repair is therefore closed-form and applies to every numeric field:
 *
 *     true_per_100g_field = stored_field * servingGrams / 100
 *
 * ===========================================================================
 * LIVE PROOF (verified against the corpus 2026-07-26)
 * ===========================================================================
 *   Jersey Mike's Subs, #44 Buffalo Chicken Cheese Steak On White Regular
 *     servingGrams 541,  stored 32.00 kcal/100g
 *   Jersey Mike's Subs, #44 Buffalo Chicken Cheese Steak On White Giant
 *     servingGrams 1060, stored 16.30 kcal/100g
 *
 *   recovered `stored * S / 100` = 173.1 and 172.8 kcal/100g.
 *
 * A per-100 g DENSITY cannot depend on serving mass. That the two sizes
 * disagree ~2x on the stored density and agree to 0.2% after multiplying by
 * their own serving mass is the whole diagnosis: the stored number is the
 * density divided by the size, and the divisor is recoverable per row.
 *
 * Today both sizes bill an identical 173 kcal. The true values are ~937 and
 * ~1,831 kcal — 5.4x and 10.6x under.
 *
 * ===========================================================================
 * REFUTED HYPOTHESES — do not retry these
 * ===========================================================================
 * - kJ/kcal unit slip: REFUTED. Stored kcal equals 4P + 4C + 9F to four
 *   significant figures on the corrupt rows. A unit slip in the energy field
 *   leaves the macros alone; here the macros moved by the same factor.
 * - Atwater cross-check as the detector: REFUTED BY MEASUREMENT. The corrupt
 *   rows are Atwater-PERFECT precisely because every macro was divided by the
 *   same factor. detect-corrupt-nutrition.ts's `kj-as-kcal` rule is blind here
 *   for exactly this reason.
 * - Any absolute kcal or energy-density floor: REFUTED. The corrupt Jersey
 *   Mike's sub sits at 0.21 kcal/g; a legitimate White Claw sits at 0.028
 *   kcal/g. Any floor low enough to catch the sub hits the seltzer FIRST.
 *   (This project has already shipped one absolute-threshold fix that
 *   destroyed good data — see sync-docs/mapping_investigation_playbook.md.)
 *
 * WHY THE EXISTING DETECTORS CANNOT SEE THIS CLASS
 * - scripts/eval/detect-corrupt-panel.ts rescales candidates by `x 100 / S`,
 *   which is the OPPOSITE direction to this defect, and needs >= 4 same-name
 *   siblings for a robust median.
 * - scripts/eval/detect-corrupt-nutrition.ts is entirely UPPER bounds; these
 *   rows are corrupt by being too SMALL, and every individual field is well
 *   inside every ceiling.
 *
 * ===========================================================================
 * THE DETECTOR
 * ===========================================================================
 * The signature is not a threshold on any value — it is the DEPENDENCE of the
 * stored density on serving mass, which is physically impossible and can only
 * be seen across a family of same-product different-size rows.
 *
 *   family key   `brandName | <name lowercased, non-alphanumerics -> spaces,
 *                size tokens stripped>` (see SIZE_TOKENS)
 *   base filter  servingGrams in [5, 5000], calories > 0, brandName NOT NULL
 *   qualifies    >= 2 members AND >= 2 distinct servingGrams
 *                AND max(S)/min(S) >= 1.3
 *   FLAGGED      regr_slope(ln kcal100, ln S) in [-1.15, -0.85]
 *                AND regr_r2 >= 0.95
 *   member guard only members with servingGrams >= 150 are flagged
 *
 * A slope of exactly -1 is the algebraic fingerprint of `stored = D * 100 / S`
 * for a size-invariant true density D. The r2 gate keeps families whose sizes
 * genuinely differ in recipe (and therefore in density) out.
 *
 * ARMS. `--arm synthetic` (DEFAULT) restricts to `length(barcode) > 13`, the
 * synthetic-barcode chain import where this defect was introduced.
 * `--arm real-ean` (length <= 13) is reported for completeness but is NOT a
 * repair candidate set: every hand-checked false positive lived there
 * (M&S Greek Yogurt, Wegmans muenster variants standardized to 100 kcal,
 * Great Value, Aldi, Tesco — retail lines whose per-100g panels are
 * portion-standardized by policy, which produces the same slope honestly).
 * Measured false-positive rate on the UNRESTRICTED set was 10.0% (3 of 30
 * hand-checked).
 *
 * MEASURED POPULATIONS (live corpus, 2026-07-26; 629,341 rows past the base
 * filter, 552,184 families, 8,953 multi-size qualifying):
 *
 *   all arms   3,640 rows / 1,089 families
 *   synthetic  3,173 rows /   824 families /  55 brands   (guard refusals: 1)
 *   real-EAN     467 rows /   288 families / 189 brands   (guard refusals: 31)
 *
 * The synthetic arm is 54 chain restaurants (Jersey Mike's 575, White Castle
 * 289, Wawa 278, Firehouse 234, Zaxby's 144, KFC 128, Taco Bell 119, Dunkin'
 * 113, Panda Express 109, ...) plus exactly ONE non-chain row:
 * `Asda | Thai sticky rice`.
 *
 * These are 4 rows / 3 families BELOW the SQL sizing pass that first measured
 * this class (3,644 / 1,092; synthetic 3,174 / 825 / 56). The entire
 * difference is the empty-family-key guard below, and it reconciles exactly:
 * the SQL had no such guard, so 4 rows across 3 pseudo-families (`Нз|`,
 * `Братья Караваевы|`, `Своя линия|`) were counted as detections. They are
 * artifacts of the key, not instances of the defect. The sizing pass also
 * listed `Нз | Пържола` as a second non-chain brand; that row is one of the 4.
 *
 * STRUCTURAL BLIND SPOT, stated so nobody reads a 0 as an all-clear: brands
 * sold in a single size (White Claw, Truly — one can size per SKU) can never
 * form a multi-size family, so their kcal is never examined by this detector
 * at all. "0 flagged" for such a brand means NOT LOOKED AT, not CLEAN.
 *
 * POST-REPAIR PLAUSIBILITY GUARD. Distinct from detection: this is a guard on
 * the OUTPUT, so an absolute bound is legitimate here in a way it is not in
 * the detector. A repair is REFUSED (never silently dropped — refusals are
 * counted and reported with reasons) when the repaired panel would be
 * physically impossible: repaired kcal/100g > MAX_REPAIRED_KCAL_100G, or
 * repaired protein+carbs+fat > MAX_MACRO_SUM_100G.
 *
 * Run (from repo root, read-only):
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/eval/detect-panel-scale-divided.ts \
 *     [--arm synthetic|real-ean|all] [--out plan.json] [--limit N] [--json]
 *
 * THE DATA-OP IS NOT IN THIS FILE. This produces a repair PLAN for review.
 * Applying it needs its own reviewed, approved script.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { MAX_MACRO_SUM_100G } from '../../src/lib/mapping/corrupt-mark';

// ===========================================================================
// Constants
// ===========================================================================

/** Size/portion words stripped from the name before forming the family key, so
 *  "... On White Regular" and "... On White Giant" land in ONE family. Bare
 *  integers go too ("12 Chocolate Chip Cookies", "32 Oz"). */
export const SIZE_TOKENS: ReadonlySet<string> = new Set([
    'mini', 'small', 'sm', 'regular', 'reg', 'medium', 'med', 'large', 'lg',
    'giant', 'kid', 'kids', 'cub', 'junior', 'jr', 'whatameal', 'whatabox',
    'combo', 'value', 'snack', 'single', 'double', 'triple', 'oz', 'fl', 'in',
    'inch', 'footlong', 'half', 'full', 'meal', 'box',
]);

/** Base filter: serving masses outside this band are parse junk, not portions. */
export const MIN_SERVING_G = 5;
export const MAX_SERVING_G = 5000;

/** Family qualification. */
export const MIN_FAMILY_MEMBERS = 2;
export const MIN_DISTINCT_SERVINGS = 2;
export const MIN_SIZE_SPREAD = 1.3;

/** Flag band. Exact -1 is the algebraic signature; the band absorbs rounding
 *  in the stored panel and small genuine recipe drift between sizes. */
export const MIN_SLOPE = -1.15;
export const MAX_SLOPE = -0.85;
export const MIN_R2 = 0.95;

/** Member guard: only large servings are flagged. Below ~150 g the division
 *  factor is near 1, so the repair moves little and the evidence is weakest. */
export const MIN_FLAGGED_SERVING_G = 150;

/** Synthetic-barcode arm boundary. Real EANs/UPCs are <= 13 digits; the chain
 *  import minted longer synthetic ids. */
export const MAX_REAL_EAN_LENGTH = 13;

/** Post-repair guard ceiling for energy density. Deliberately 5 kcal STRICTER
 *  than corrupt-mark's MAX_KCAL_100G (905): that 905 grants label-rounding
 *  slack to a number a manufacturer actually printed, and a value this script
 *  SYNTHESIZES has not earned that slack. Pure fat is ~900. */
export const MAX_REPAIRED_KCAL_100G = 900;

// MAX_MACRO_SUM_100G (= 105) is imported, not redefined. It is DELIBERATE
// label-rounding slack over the physical 100 g/100g — see its comment in
// src/lib/mapping/corrupt-mark.ts. Inventing a second number here would fork it.

// ===========================================================================
// Pure core (unit-tested offline in __tests__/panel-scale-divided.test.ts)
// ===========================================================================

/** Every numeric field of the stored panel. All of them were divided. */
export interface Panel {
    calories: number;
    protein?: number | null;
    carbs?: number | null;
    fat?: number | null;
    fiber?: number | null;
    sugars?: number | null;
    sodium?: number | null;
}

export interface PanelRow {
    barcode: string;
    name: string;
    brandName: string | null;
    servingGrams: number | null;
    nutrientsPer100g: unknown;
}

export type Arm = 'synthetic' | 'real-ean' | 'all';

/** Lowercase, non-alphanumerics -> spaces, collapse whitespace, drop size
 *  tokens and bare integers. */
export function stripSizeTokens(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(t => t !== '' && !SIZE_TOKENS.has(t) && !/^[0-9]+$/.test(t))
        .join(' ');
}

/**
 * `brandName | <size-stripped name>`, or null when no honest key exists.
 *
 * EMPTY-NAME GUARD. `stripSizeTokens` is ASCII-alphanumeric (as is the
 * Postgres `[^a-z0-9]` used to size this class), so a name written entirely in
 * a non-Latin script normalizes to the EMPTY STRING. Without this guard those
 * rows all collapse into a single pseudo-family `Brand|` — and a pseudo-family
 * is not a family: the live corpus has `Нз|` merging "Паста" (459 kcal/100g,
 * S=50) with "Пържола" (107 kcal/100g, S=186), two unrelated foods whose
 * accidental pairing fits a -1.11 slope at r2 1.00 and flags. Four such rows
 * across three pseudo-families (`Нз|`, `Братья Караваевы|`, `Своя линия|`)
 * were flagged by the SQL sizing pass that did NOT have this guard; they are
 * artifacts of the key, not instances of the defect.
 *
 * Skipped rows are COUNTED (`skippedEmptyNameKey`) and reported, never
 * silently dropped.
 */
export function familyKey(name: string, brandName: string | null): string | null {
    if (brandName == null || brandName.trim() === '') return null;
    const stripped = stripSizeTokens(name);
    if (!stripped) return null;
    return `${brandName}|${stripped}`;
}

export function readPanel(nutrients: unknown): Panel | null {
    if (nutrients == null || typeof nutrients !== 'object') return null;
    const n = nutrients as Record<string, unknown>;
    const num = (k: string): number | null => {
        const v = n[k];
        return typeof v === 'number' && isFinite(v) ? v : null;
    };
    const calories = num('calories') ?? num('kcal');
    if (calories == null || !(calories > 0)) return null;
    return {
        calories,
        protein: num('protein'), carbs: num('carbs'), fat: num('fat'),
        fiber: num('fiber'), sugars: num('sugars'), sodium: num('sodium'),
    };
}

/** THE repair: every numeric field x S/100. Nulls stay null (a missing field
 *  must not be invented as 0 — that would look like a measured zero). */
export function repairPanel(panel: Panel, servingGrams: number): Panel {
    const f = servingGrams / 100;
    const scale = (v: number | null | undefined) => (v == null ? v ?? null : v * f);
    return {
        calories: panel.calories * f,
        protein: scale(panel.protein), carbs: scale(panel.carbs), fat: scale(panel.fat),
        fiber: scale(panel.fiber), sugars: scale(panel.sugars), sodium: scale(panel.sodium),
    };
}

export function macroSum(panel: Panel): number {
    return (panel.protein ?? 0) + (panel.carbs ?? 0) + (panel.fat ?? 0);
}

/** Post-repair plausibility guard. Returns the reasons a repair is refused;
 *  empty array = emit it. */
export function guardRepair(repaired: Panel): string[] {
    const reasons: string[] = [];
    if (repaired.calories > MAX_REPAIRED_KCAL_100G) {
        reasons.push(`repaired-kcal-impossible: ${repaired.calories.toFixed(1)} > ${MAX_REPAIRED_KCAL_100G} kcal/100g`);
    }
    const sum = macroSum(repaired);
    if (sum > MAX_MACRO_SUM_100G) {
        reasons.push(`repaired-macro-sum-impossible: ${sum.toFixed(1)} > ${MAX_MACRO_SUM_100G} g/100g`);
    }
    return reasons;
}

/** Streaming accumulator for one family's OLS fit of ln(kcal100) on ln(S). */
export interface FamilyAccumulator {
    n: number;
    sx: number; sy: number; sxx: number; syy: number; sxy: number;
    minServing: number; maxServing: number;
    servings: Set<number>;
}

export function newFamily(): FamilyAccumulator {
    return {
        n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0,
        minServing: Infinity, maxServing: -Infinity, servings: new Set(),
    };
}

export function addMember(acc: FamilyAccumulator, servingGrams: number, kcal100: number): void {
    const x = Math.log(servingGrams);
    const y = Math.log(kcal100);
    acc.n += 1;
    acc.sx += x; acc.sy += y;
    acc.sxx += x * x; acc.syy += y * y; acc.sxy += x * y;
    acc.minServing = Math.min(acc.minServing, servingGrams);
    acc.maxServing = Math.max(acc.maxServing, servingGrams);
    acc.servings.add(servingGrams);
}

export interface FamilyStats {
    n: number;
    distinctServings: number;
    sizeSpread: number;
    slope: number | null;
    r2: number | null;
}

/** Mirrors Postgres regr_slope/regr_r2 (including their null/degenerate
 *  behaviour) so the SQL used to size this class and the script agree. */
export function familyStats(acc: FamilyAccumulator): FamilyStats {
    const { n, sx, sy, sxx, syy, sxy } = acc;
    const sizeSpread = acc.minServing > 0 ? acc.maxServing / acc.minServing : 0;
    const base = { n, distinctServings: acc.servings.size, sizeSpread };
    if (n < 2) return { ...base, slope: null, r2: null };
    const dxx = n * sxx - sx * sx;
    const dyy = n * syy - sy * sy;
    const dxy = n * sxy - sx * sy;
    if (dxx <= 0) return { ...base, slope: null, r2: null };   // no x variance
    const slope = dxy / dxx;
    const r2 = dyy <= 0 ? 1 : (dxy * dxy) / (dxx * dyy);        // PG: Syy=0 -> 1
    return { ...base, slope, r2 };
}

export function familyQualifies(stats: FamilyStats): boolean {
    return stats.n >= MIN_FAMILY_MEMBERS
        && stats.distinctServings >= MIN_DISTINCT_SERVINGS
        && stats.sizeSpread >= MIN_SIZE_SPREAD;
}

export function familyFlagged(stats: FamilyStats): boolean {
    if (!familyQualifies(stats)) return false;
    if (stats.slope == null || stats.r2 == null) return false;
    return stats.slope >= MIN_SLOPE && stats.slope <= MAX_SLOPE && stats.r2 >= MIN_R2;
}

export function inArm(barcode: string, arm: Arm): boolean {
    if (arm === 'all') return true;
    const synthetic = barcode.length > MAX_REAL_EAN_LENGTH;
    return arm === 'synthetic' ? synthetic : !synthetic;
}

/** Rows the base filter admits at all. */
export function passesBaseFilter(row: PanelRow): boolean {
    if (row.brandName == null || row.brandName.trim() === '') return false;
    const s = row.servingGrams;
    if (s == null || !isFinite(s) || s < MIN_SERVING_G || s > MAX_SERVING_G) return false;
    return readPanel(row.nutrientsPer100g) != null;
}

// ===========================================================================
// Scan
// ===========================================================================

export interface RepairEntry {
    barcode: string;
    name: string;
    brandName: string;
    servingGrams: number;
    current: Panel;
    repaired: Panel;
    /** Serving-level energy today vs after repair — the user-visible delta. */
    currentServingKcal: number;
    repairedServingKcal: number;
    understatementFactor: number;
    familyKey: string;
    familySlope: number;
    familyR2: number;
    familySize: number;
    familyDistinctServings: number;
}

export interface RefusalEntry {
    barcode: string;
    name: string;
    brandName: string;
    servingGrams: number;
    current: Panel;
    repaired: Panel;
    familyKey: string;
    reasons: string[];
}

export interface ScanReport {
    at: string;
    arm: Arm;
    scanned: number;
    baseFilterPassed: number;
    /** Base-filter rows with no honest family key (name normalizes to empty).
     *  Reported so the exclusion is auditable — see familyKey's comment. */
    skippedEmptyNameKey: number;
    families: number;
    qualifyingFamilies: number;
    flaggedFamilies: number;
    /** Flagged members in the selected arm, BEFORE the plausibility guard. */
    flaggedRows: number;
    /** Flagged members in the selected arm across ALL arms, for context. */
    flaggedRowsAllArms: number;
    flaggedFamiliesAllArms: number;
    repairs: RepairEntry[];
    refusals: RefusalEntry[];
    refusalCount: number;
    /** True when --limit truncated `repairs`; summary counts stay full. */
    truncated: boolean;
    byBrand: Array<{ brandName: string; rows: number; families: number; refusals: number }>;
}

export type RowStream = () => AsyncIterable<PanelRow[]>;

export interface ScanOptions {
    arm?: Arm;
    limit?: number;
}

/**
 * Two passes over the stream: pass 1 accumulates per-family regression sums
 * (bounded memory), pass 2 re-reads and emits the flagged members.
 *
 * This function deliberately does NOT catch stream errors. A query failure has
 * to propagate so the caller exits non-zero; swallowing it would turn a total
 * outage into a confident "0 rows flagged" — the exact failure shape PR #177
 * was written to stop (cache-parity-sweep.ts printing "0 changed records" on
 * total HTTP failure).
 */
export async function runScan(stream: RowStream, opts: ScanOptions = {}): Promise<ScanReport> {
    const arm: Arm = opts.arm ?? 'synthetic';
    const limit = opts.limit != null && opts.limit > 0 ? opts.limit : Infinity;

    // ---- Pass 1: family regression sums ----
    const families = new Map<string, FamilyAccumulator>();
    let scanned = 0;
    let baseFilterPassed = 0;
    let skippedEmptyNameKey = 0;
    for await (const batch of stream()) {
        for (const row of batch) {
            scanned += 1;
            if (!passesBaseFilter(row)) continue;
            baseFilterPassed += 1;
            const panel = readPanel(row.nutrientsPer100g)!;
            const key = familyKey(row.name, row.brandName);
            if (!key) { skippedEmptyNameKey += 1; continue; }
            let acc = families.get(key);
            if (!acc) { acc = newFamily(); families.set(key, acc); }
            addMember(acc, row.servingGrams!, panel.calories);
        }
    }

    const flaggedKeys = new Map<string, FamilyStats>();
    let qualifyingFamilies = 0;
    for (const [key, acc] of families) {
        const stats = familyStats(acc);
        if (familyQualifies(stats)) qualifyingFamilies += 1;
        if (familyFlagged(stats)) flaggedKeys.set(key, stats);
    }
    const familyCount = families.size;
    families.clear();

    // ---- Pass 2: emit flagged members ----
    const repairs: RepairEntry[] = [];
    const refusals: RefusalEntry[] = [];
    let refusalCount = 0;
    let flaggedRows = 0;
    let flaggedRowsAllArms = 0;
    const armFamilies = new Set<string>();
    const allArmFamilies = new Set<string>();
    const brands = new Map<string, { rows: number; families: Set<string>; refusals: number }>();
    let truncated = false;

    for await (const batch of stream()) {
        for (const row of batch) {
            if (!passesBaseFilter(row)) continue;
            const servingGrams = row.servingGrams!;
            if (servingGrams < MIN_FLAGGED_SERVING_G) continue;
            const key = familyKey(row.name, row.brandName);
            if (!key) continue;
            const stats = flaggedKeys.get(key);
            if (!stats) continue;

            flaggedRowsAllArms += 1;
            allArmFamilies.add(key);
            if (!inArm(row.barcode, arm)) continue;

            flaggedRows += 1;
            armFamilies.add(key);
            const brandName = row.brandName!;
            let b = brands.get(brandName);
            if (!b) { b = { rows: 0, families: new Set(), refusals: 0 }; brands.set(brandName, b); }
            b.rows += 1;
            b.families.add(key);

            const current = readPanel(row.nutrientsPer100g)!;
            const repaired = repairPanel(current, servingGrams);
            const reasons = guardRepair(repaired);
            if (reasons.length > 0) {
                refusalCount += 1;
                b.refusals += 1;
                // Refusals are always retained in full: a dropped row that
                // nobody counts is indistinguishable from a clean run.
                refusals.push({
                    barcode: row.barcode, name: row.name, brandName,
                    servingGrams, current, repaired, familyKey: key, reasons,
                });
                continue;
            }
            if (repairs.length >= limit) { truncated = true; continue; }
            const currentServingKcal = (current.calories * servingGrams) / 100;
            const repairedServingKcal = (repaired.calories * servingGrams) / 100;
            repairs.push({
                barcode: row.barcode, name: row.name, brandName, servingGrams,
                current, repaired,
                currentServingKcal, repairedServingKcal,
                understatementFactor: currentServingKcal > 0 ? repairedServingKcal / currentServingKcal : 0,
                familyKey: key,
                familySlope: stats.slope!, familyR2: stats.r2!,
                familySize: stats.n, familyDistinctServings: stats.distinctServings,
            });
        }
    }

    const byBrand = [...brands.entries()]
        .map(([brandName, b]) => ({ brandName, rows: b.rows, families: b.families.size, refusals: b.refusals }))
        .sort((a, b) => b.rows - a.rows || a.brandName.localeCompare(b.brandName));

    return {
        at: new Date().toISOString(),
        arm, scanned, baseFilterPassed, skippedEmptyNameKey,
        families: familyCount,
        qualifyingFamilies,
        flaggedFamilies: armFamilies.size,
        flaggedRows,
        flaggedRowsAllArms,
        flaggedFamiliesAllArms: allArmFamilies.size,
        repairs, refusals, refusalCount, truncated, byBrand,
    };
}

/**
 * 0 = the scan ran and produced a report; 2 = the scan saw NOTHING.
 *
 * A scan of zero rows is not a clean corpus, it is a broken instrument (an
 * empty result set, a filter typo, a database pointed at the wrong host). It
 * must never render as green.
 */
export function scanExitCode(report: Pick<ScanReport, 'scanned' | 'baseFilterPassed'>): number {
    if (report.scanned === 0) return 2;
    if (report.baseFilterPassed === 0) return 2;
    return 0;
}

export function formatSummary(report: ScanReport): string[] {
    const out: string[] = [];
    out.push('');
    out.push(`Scanned ${report.scanned} rows; ${report.baseFilterPassed} passed the base filter.`);
    out.push(`Excluded for an empty family key (name normalizes to nothing): ${report.skippedEmptyNameKey}`);
    out.push(`Families: ${report.families} total, ${report.qualifyingFamilies} multi-size qualifying.`);
    out.push(`Flagged across ALL arms: ${report.flaggedRowsAllArms} rows / ${report.flaggedFamiliesAllArms} families.`);
    out.push(`Arm "${report.arm}": ${report.flaggedRows} rows / ${report.flaggedFamilies} families / ${report.byBrand.length} brands.`);
    out.push(`Repairs emitted: ${report.repairs.length}${report.truncated ? ' (TRUNCATED by --limit; counts above are full-population)' : ''}`);
    out.push(`Repairs REFUSED by the post-repair plausibility guard: ${report.refusalCount}`);
    if (report.refusals.length > 0) {
        for (const r of report.refusals.slice(0, 20)) {
            out.push(`  REFUSED ${r.barcode} "${r.name}" [${r.brandName}] S=${r.servingGrams}g: ${r.reasons.join('; ')}`);
        }
        if (report.refusals.length > 20) out.push(`  ... ${report.refusals.length - 20} more refusals in the report file`);
    }
    out.push('');
    out.push('Per brand (rows / families / refused):');
    for (const b of report.byBrand) {
        out.push(`  ${b.brandName.padEnd(28)} ${String(b.rows).padStart(5)} / ${String(b.families).padStart(4)} / ${b.refusals}`);
    }
    const worst = [...report.repairs].sort((a, b) => b.understatementFactor - a.understatementFactor).slice(0, 15);
    if (worst.length > 0) {
        out.push('');
        out.push('Worst understatements (bills today -> bills after repair):');
        for (const r of worst) {
            out.push(`  ${r.barcode} "${r.name}" [${r.brandName}] S=${r.servingGrams}g: `
                + `${r.current.calories.toFixed(1)} -> ${r.repaired.calories.toFixed(1)} kcal/100g, `
                + `${Math.round(r.currentServingKcal)} -> ${Math.round(r.repairedServingKcal)} kcal/serving `
                + `(${r.understatementFactor.toFixed(1)}x under; family slope ${r.familySlope.toFixed(3)}, r2 ${r.familyR2.toFixed(3)}, n=${r.familySize})`);
        }
    }
    out.push('');
    out.push('READ-ONLY: nothing was written to the database. The data-op is a separate, unapproved PR.');
    return out;
}

// ===========================================================================
// CLI
// ===========================================================================

const BATCH = 20000;

function parseArgs(argv: string[]) {
    const value = (flag: string): string | undefined => {
        const i = argv.indexOf(flag);
        return i >= 0 ? argv[i + 1] : undefined;
    };
    const armRaw = value('--arm') ?? 'synthetic';
    if (armRaw !== 'synthetic' && armRaw !== 'real-ean' && armRaw !== 'all') {
        throw new Error(`--arm must be one of synthetic|real-ean|all (got "${armRaw}")`);
    }
    const limitRaw = value('--limit');
    const limit = limitRaw != null ? Number(limitRaw) : undefined;
    if (limit != null && (!isFinite(limit) || limit <= 0)) {
        throw new Error(`--limit must be a positive number (got "${limitRaw}")`);
    }
    return {
        arm: armRaw as Arm,
        limit,
        out: value('--out'),
        json: argv.includes('--json'),
    };
}

/** Exported so repair-panel-scale-divided.ts scans through the EXACT same
 *  query (playbook §11 class A: a re-implemented stream is a fork that can
 *  drift from the detector's population). */
export function prismaStream(prisma: PrismaClient): RowStream {
    return async function* () {
        let cursor: string | undefined;
        for (;;) {
            const batch: PanelRow[] = await prisma.offFood.findMany({
                select: { barcode: true, name: true, brandName: true, servingGrams: true, nutrientsPer100g: true },
                where: {
                    brandName: { not: null },
                    servingGrams: { gte: MIN_SERVING_G, lte: MAX_SERVING_G },
                },
                orderBy: { barcode: 'asc' },
                take: BATCH,
                ...(cursor ? { cursor: { barcode: cursor }, skip: 1 } : {}),
            });
            if (!batch.length) return;
            yield batch;
            cursor = batch[batch.length - 1].barcode;
        }
    };
}

async function main(): Promise<void> {
    const opts = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();
    try {
        // No try/catch around runScan: a failure must reach the top-level
        // handler and exit 2, never fall through to a summary.
        const report = await runScan(prismaStream(prisma), { arm: opts.arm, limit: opts.limit });

        const outDir = path.join(__dirname, 'results');
        fs.mkdirSync(outDir, { recursive: true });
        const ts = report.at.replace(/[:.]/g, '-');
        const outPath = opts.out ?? path.join(outDir, `panel-scale-divided-${opts.arm}-${ts}.json`);
        fs.writeFileSync(outPath, JSON.stringify(report, null, 1));

        if (opts.json) {
            console.log(JSON.stringify(report, null, 1));
        } else {
            for (const line of formatSummary(report)) console.log(line);
            console.log(`Repair plan written to ${path.relative(process.cwd(), outPath)}`);
        }

        const code = scanExitCode(report);
        if (code !== 0) {
            console.error(`FAIL: the scan saw ${report.scanned} rows / ${report.baseFilterPassed} after the base filter — that is a broken instrument, not a clean corpus.`);
            process.exitCode = code;
        }
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main().catch(err => { console.error(err); process.exit(2); });
}
