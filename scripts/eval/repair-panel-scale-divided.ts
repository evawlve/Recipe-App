/**
 * repair-panel-scale-divided.ts — the gated corpus repair for the divided-panel
 * class (handoff_cache_audit_2026-07-27.md §4 / §5a-2a; playbook §3's
 * "detectors" subsection). DRY RUN BY DEFAULT; --execute is Phase 3 and refuses
 * to run without a verified OffFood snapshot manifest and an approved plan file.
 *
 * ===========================================================================
 * THE DEFECT AND THE REPAIR
 * ===========================================================================
 * The OFF chain import divides the WHOLE per-100 g panel — macros included —
 * by servingGrams/100 (see detect-panel-scale-divided.ts for the mechanism and
 * the live Jersey Mike's proof: a Giant and a Regular both bill 173 kcal today
 * against true ~1,831 / ~937). The repair is closed-form, per row:
 *
 *     true_field = stored_field * servingGrams / 100     (every numeric field)
 *
 * DETECTION IS NOT RE-IMPLEMENTED HERE. Family construction, the log-log slope
 * test, the structural barcode restriction and the post-repair plausibility
 * guard are all IMPORTED from scripts/eval/detect-panel-scale-divided.ts
 * (PR #179, 28 tests) — a re-implementation that drifts from the shipped
 * detector is playbook §11 class A, the known failure. No constant is re-tuned.
 *
 * UNSETTLED: 3,173 rows is a FLOOR, not the class size — singleton defective
 * rows are invisible to the family test (a one-size product never forms a
 * multi-size family; "0 flagged" for such a brand means NOT LOOKED AT). Closing
 * the gap needs the FatSecret/FDC cross-source join, which is a separate queued
 * task, not this script.
 *
 * ===========================================================================
 * RISK TIERS
 * ===========================================================================
 * Tier 1 — families with >= 3 distinct serving sizes (~2,093 rows): the -1
 *   slope is over-determined; strong evidence.
 * Tier 2 — 2-size families: a log-log fit through two points is perfect BY
 *   CONSTRUCTION (r2 = 1 always), so the flag rests on the slope band alone;
 *   weak evidence. The dry-run plan separates the tiers and --execute takes
 *   --tier 1|2|all so tier 1 can be approved and applied alone.
 *
 * ===========================================================================
 * GATING DESIGN (why this is not the gated mark/purge/replay method)
 * ===========================================================================
 * decideMark() has NO rule for this class — it re-verifies every class it
 * knows, so routing this repair through mark/purge/replay would bypass nothing
 * and verify nothing (handoff §⚠️ corrections). The gate is therefore built
 * into THIS script:
 *
 *  1. DRY RUN IS THE DEFAULT and the only mode that scans the corpus. It emits
 *     a full plan (JSON + human summary): per-family stats, per-row
 *     before->after for every numeric field, guard refusals with reasons, risk
 *     tiers, per-brand totals, and a deterministic hand-auditable sample
 *     (fixed ordering: first N entries by (familyKey, barcode)). Diego
 *     approves FROM THE PLAN FILE; --execute applies that exact artifact.
 *  2. --execute REFUSES TO EVEN PARSE without --plan <approved plan.json> and
 *     --snapshot-manifest <path to a VERIFIED .meta.json produced by
 *     scripts/eval/snapshot-off-food.ts>. The manifest is validated (shape,
 *     table, row count, sha256, required columns, final — not .partial —
 *     filename) and must be NEWER than the plan: the operational order is
 *     plan -> approve -> snapshot -> execute, so the rollback anchor holds the
 *     rows as they stood immediately before the write.
 *  3. Writes go ROW BY ROW. Immediately before each write the row's CURRENT
 *     stored values are re-read and compared to the plan's recorded
 *     before-values (name, brand, servingGrams, the whole raw panel,
 *     corruptReason, duplicateOfBarcode). A row that moved is REFUSED —
 *     per-row, counted, listed — never skipped silently (§11 population-guard
 *     lesson, applied per row; the count-only guard was proven fail-open on
 *     2026-07-27 when 305 rows moved in place under an unchanged count).
 *  4. The post-repair plausibility guard (imported guardRepair) gates EVERY
 *     SINGLE WRITE, recomputed from the LIVE row. Refusals are counted and
 *     listed, never dropped. Precedent: on the detector's first live run this
 *     guard caught `Taco Bell, Crunchwrap Supreme` — its 260 g row is already
 *     a correct density, and "repairing" it would invent a 108.1 g/100 g macro
 *     sum. Guarding the OUTPUT with an absolute number is legitimate; guarding
 *     the DETECTION with one is not (playbook §3).
 *  5. The written value is RECOMPUTED from the live row, never copied out of
 *     the plan; if the recomputation disagrees with the plan's rawAfter the
 *     row is refused as plan-drift (a hand-edited rawAfter cannot reach the
 *     database).
 *  6. `Asda | Thai sticky rice` (barcode 50571723466684) is excluded by name:
 *     the detector EMITS it as a repair (handoff §⚠️ corrections refuted the
 *     claim that anything upstream excluded it). See EXCLUDED_BARCODES.
 *  7. Plan validation refuses entries with servingGrams below the detector's
 *     member guard (150 g). This is load-bearing, not pedantry: the
 *     plausibility guard is ONE-SIDED (ceilings), and the repair multiplies by
 *     S/100 — so a hand-added small-S entry would SHRINK a panel and sail
 *     under every ceiling. Below-guard rows cannot have come from the
 *     detector, so they refuse the whole plan.
 *  8. --tier is REQUIRED in execute mode: the tier is the WRITE SCOPE, and a
 *     default would silently select the widest one. Each entry's tier label
 *     is also RECOMPUTED from its own familyDistinctServings at validation
 *     time — a hand-relabelled tier-2 entry must not ride into a --tier 1
 *     apply. --sample is refused in execute mode (there is no sampled apply;
 *     scope by --tier or approve a smaller plan).
 *  9. The dry run prints the plan file's sha256; --execute recomputes it and
 *     refuses a mismatch against --plan-sha256 (optional — when omitted, the
 *     computed hash is printed prominently for eyeball comparison against the
 *     approved artifact). And before any write, the snapshot dump the manifest
 *     names is re-verified ON THE DB HOST (still exists, sha256 still matches)
 *     over the SAME bash -c wrapped ssh transport snapshot-off-food.ts uses
 *     (imported, not re-implemented — §11 class A). A rollback path is only
 *     real if it still exists when the writes start.
 *
 * A wrong flag inflates a 1,060 g row by 10.6x. That is why every one of these
 * gates exists and why none of them is optional.
 *
 * ===========================================================================
 * AFTER --execute WRITES: MANDATORY NEXT STEPS (also printed by the run)
 * ===========================================================================
 * - FULL Typesense rebuild on the DB host (scripts/sync-typesense.ts). The
 *   search path serves nutrients straight off the Typesense hit
 *   (src/lib/mapping/gather-candidates.ts:160 maps hit.nutrientsPer100g into
 *   the candidate), so until the index is rebuilt, search KEEPS BILLING THE
 *   CORRUPT NUMBERS. Full, not incremental — see mandatoryNextSteps().
 * - FoodMapping: 203 cache rows point into this import (72 materially
 *   distorted). NO eviction is needed: FoodMapping is identity-only, and
 *   billing hydrates the panel from OffFood at request time, so cache-hit
 *   traffic picks up the repair from Postgres directly. Verify with a live
 *   probe (JM #44 Giant vs Regular must stop billing identically).
 * - Warm batches 07/08/09/10 are gated on THIS repair (handoff §5a Phase 3).
 *
 * ===========================================================================
 * USAGE
 * ===========================================================================
 *   # Phase-2 dry run (READ-ONLY; the artifact Diego approves):
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/eval/repair-panel-scale-divided.ts \
 *     [--out plan.json] [--sample N]
 *
 *   # Phase 3, AFTER approval + a fresh verified OffFood snapshot:
 *   ... repair-panel-scale-divided.ts --execute --plan <approved-plan.json> \
 *     --snapshot-manifest <OffFood-<ts>.meta.json> --tier 1|2|all \
 *     [--plan-sha256 <the hash the dry run printed>]
 *
 * The manifest lands on the DB host (snapshot-off-food.ts writes it next to
 * the dump); scp it to wherever this script runs, or run this script on the
 * host checkout. Exit codes: 0 = ok (plan written / >=1 row applied),
 * 2 = refused, error, or an execute that applied NOTHING (all-refused is a
 * broken run, not a clean one).
 *
 * Offline fail-injection tests: scripts/eval/__tests__/repair-panel-scale-divided.test.ts.
 */
import 'dotenv/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import {
    guardRepair,
    prismaStream,
    readPanel,
    runScan,
    scanExitCode,
    MIN_FLAGGED_SERVING_G,
    type Panel,
    type RefusalEntry,
    type RepairEntry,
    type ScanReport,
} from './detect-panel-scale-divided';
import {
    REQUIRED_COLUMNS,
    TABLE,
    shellQuote,
    sshTransport,
    type Transport,
} from './snapshot-off-food';

// ===========================================================================
// Constants
// ===========================================================================

export const PLAN_KIND = 'panel-scale-divided-repair' as const;
export const PLAN_VERSION = 1 as const;
/** The repair population is the synthetic-barcode chain import ONLY. The
 *  real-EAN arm is not a repair candidate set (every hand-checked false
 *  positive lived there — portion-standardized retail lines earn the -1 slope
 *  honestly). Not a flag: there is deliberately no way to point --execute at
 *  another arm. */
export const REPAIR_ARM = 'synthetic' as const;

/**
 * Rows the detector emits that must NOT be repaired, by name, with the reason.
 *
 * `Asda | Thai sticky rice` is the ONE non-chain row in the synthetic arm
 * (detect-panel-scale-divided.ts header, measured populations). The 2026-07-27
 * readiness audit refuted this handoff's claim that it was excluded upstream —
 * the detector emits it as a repair — so it is hand-excluded HERE and pinned by
 * a test. It has the profile of the honest retail shape (portion-standardized
 * multi-pack line) that the real-EAN arm exists to keep out; it sits in the
 * synthetic arm only because its barcode is 14 digits.
 *
 * Exclusion is enforced twice: buildPlan() drops these rows into the plan's
 * `exclusions` list (visible, counted), and validatePlanText() refuses ANY plan
 * whose entries contain one — so a hand-edited or stale plan cannot carry an
 * excluded row into --execute even in principle.
 */
export const EXCLUDED_BARCODES: ReadonlyMap<string, string> = new Map([
    ['50571723466684', 'Asda | Thai sticky rice — the one non-chain row the synthetic arm emits; hand-excluded per handoff_cache_audit_2026-07-27.md corrections table'],
]);

/** Tier 1 = families with >= 3 distinct serving sizes. A 2-point log-log fit
 *  is perfect by construction, so 2-size families are the weaker tier. */
export const TIER1_MIN_DISTINCT_SERVINGS = 3;
export const DEFAULT_SAMPLE_SIZE = 30;

export const UNSETTLED_FLOOR =
    'UNSETTLED: 3,173 rows is a FLOOR, not the class size — singleton defective rows are invisible '
    + 'to the family test (a one-size product never forms a multi-size family, so its panel is never '
    + 'examined). Closing the gap needs the FatSecret/FDC cross-source join — a separate queued task, '
    + 'not this script.';

// ===========================================================================
// Types
// ===========================================================================

export type Tier = 1 | 2;
export type TierFilter = '1' | '2' | 'all';

export interface PlanEntry extends RepairEntry {
    tier: Tier;
    /** The raw stored nutrientsPer100g JSON, verbatim — the moved-check anchor. */
    rawBefore: Record<string, unknown>;
    /** scaleStoredPanel(rawBefore, servingGrams) — what --execute must recompute. */
    rawAfter: Record<string, unknown>;
    corruptReason: string | null;
    duplicateOfBarcode: string | null;
}

export interface PlanExclusion {
    barcode: string;
    name: string;
    brandName: string;
    familyKey: string;
    reason: string;
}

export interface PlanMovedRow {
    barcode: string;
    name: string;
    diffs: string[];
}

export interface FamilySummary {
    familyKey: string;
    brandName: string;
    tier: Tier;
    slope: number;
    r2: number;
    /** Family size / distinct servings are the DETECTOR's stats (they include
     *  sub-150 g members the plan does not repair). */
    familySize: number;
    familyDistinctServings: number;
    /** Serving sizes of the PLANNED members only, ascending. */
    plannedServings: number[];
    plannedRows: number;
}

export interface BrandSummary {
    brandName: string;
    rows: number;
    tier1Rows: number;
    tier2Rows: number;
    families: number;
    refusals: number;
}

export interface RepairPlan {
    planKind: typeof PLAN_KIND;
    planVersion: typeof PLAN_VERSION;
    at: string;
    arm: typeof REPAIR_ARM;
    unsettled: string;
    scan: {
        scanned: number;
        baseFilterPassed: number;
        skippedEmptyNameKey: number;
        families: number;
        qualifyingFamilies: number;
        flaggedFamilies: number;
        flaggedRows: number;
        flaggedRowsAllArms: number;
        flaggedFamiliesAllArms: number;
    };
    tierTotals: {
        tier1: { rows: number; families: number };
        tier2: { rows: number; families: number };
    };
    exclusions: PlanExclusion[];
    /** Guard refusals from the scan — counted and listed, never dropped. */
    refusals: RefusalEntry[];
    refusalCount: number;
    /** Rows that moved between the scan and the raw-panel fetch. */
    movedDuringPlan: PlanMovedRow[];
    familySummaries: FamilySummary[];
    byBrand: BrandSummary[];
    entries: PlanEntry[];
}

/** What --execute reads live, immediately before each write. */
export interface LiveRow {
    barcode: string;
    name: string;
    brandName: string | null;
    servingGrams: number | null;
    nutrientsPer100g: unknown;
    corruptReason: string | null;
    duplicateOfBarcode: string | null;
}

/** The one boundary the offline tests mock. */
export interface RepairDb {
    fetchRow(barcode: string): Promise<LiveRow | null>;
    writePanel(barcode: string, panel: Record<string, unknown>): Promise<void>;
}

export interface ApplyRefusal {
    barcode: string;
    name: string;
    familyKey: string;
    reason: 'row-missing-live' | 'row-moved' | 'repaired-panel-unreadable' | 'guard-refused' | 'plan-drift';
    detail: string[];
}

export interface ApplyResult {
    applied: Array<{ barcode: string; name: string; servingGrams: number }>;
    refusals: ApplyRefusal[];
}

// ===========================================================================
// Pure core
// ===========================================================================

/**
 * THE repair, applied to the raw stored JSON: every finite numeric field is
 * multiplied by servingGrams/100; everything else (nulls, strings, a missing
 * field) passes through untouched — a missing field must never be invented.
 * Same math as the detector's repairPanel(); buildPlan() asserts the two agree
 * on every canonical field so this cannot silently fork (§11 class A).
 */
export function scaleStoredPanel(raw: unknown, servingGrams: number): Record<string, unknown> | null {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const f = servingGrams / 100;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        out[k] = typeof v === 'number' && isFinite(v) ? v * f : v;
    }
    return out;
}

export function tierOf(entry: Pick<RepairEntry, 'familyDistinctServings'>): Tier {
    return entry.familyDistinctServings >= TIER1_MIN_DISTINCT_SERVINGS ? 1 : 2;
}

export function filterByTier(entries: PlanEntry[], tier: TierFilter): PlanEntry[] {
    if (tier === 'all') return entries;
    const want: Tier = tier === '1' ? 1 : 2;
    return entries.filter(e => e.tier === want);
}

/** Structural JSON equality (object key order does not matter; numbers exact). */
export function jsonEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (typeof a !== typeof b) return false;
    if (a == null || b == null) return a === b;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        return a.every((v, i) => jsonEqual(v, b[i]));
    }
    if (typeof a === 'object') {
        const ka = Object.keys(a as object).sort();
        const kb = Object.keys(b as object).sort();
        if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
        return ka.every(k => jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
    }
    return false;
}

/** Key-by-key diff of two raw panels, for legible moved-row refusals. */
export function panelFieldDiffs(before: Record<string, unknown>, live: Record<string, unknown>): string[] {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(live)])].sort();
    const diffs: string[] = [];
    for (const k of keys) {
        if (!jsonEqual(before[k], live[k])) {
            diffs.push(`${k}: plan ${JSON.stringify(before[k])} -> live ${JSON.stringify(live[k])}`);
        }
    }
    return diffs;
}

const PANEL_FIELDS: ReadonlyArray<keyof Panel> = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugars', 'sodium'];

function panelsExactlyEqual(a: Panel | null, b: Panel | null): boolean {
    if (a == null || b == null) return a === b;
    return PANEL_FIELDS.every(k => (a[k] ?? null) === (b[k] ?? null));
}

/** Relative-epsilon compare for the plan-drift check: rawAfter crossed one
 *  JSON round-trip, which is exact in principle, but a refusal here halts a
 *  row, so tolerate engine-level noise without tolerating tampering. */
function numbersClose(a: number, b: number): boolean {
    if (a === b) return true;
    const scale = Math.max(Math.abs(a), Math.abs(b), 1);
    return Math.abs(a - b) / scale < 1e-9;
}

export function scaledPanelsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return keys.every(k => {
        const va = a[k];
        const vb = b[k];
        if (typeof va === 'number' && typeof vb === 'number') return numbersClose(va, vb);
        return jsonEqual(va, vb);
    });
}

// ===========================================================================
// Plan construction (dry run)
// ===========================================================================

export function buildPlan(
    report: ScanReport,
    rawByBarcode: Map<string, LiveRow>,
    at: string,
): RepairPlan {
    if (report.arm !== REPAIR_ARM) {
        throw new Error(`buildPlan requires the ${REPAIR_ARM} arm scan; got "${report.arm}"`);
    }
    if (report.truncated) {
        throw new Error('buildPlan refuses a --limit-truncated scan: a partial plan executed later is a partial repair that reads as a complete one');
    }

    const entries: PlanEntry[] = [];
    const exclusions: PlanExclusion[] = [];
    const movedDuringPlan: PlanMovedRow[] = [];

    for (const rep of report.repairs) {
        const excludedReason = EXCLUDED_BARCODES.get(rep.barcode);
        if (excludedReason !== undefined) {
            exclusions.push({
                barcode: rep.barcode, name: rep.name, brandName: rep.brandName,
                familyKey: rep.familyKey, reason: excludedReason,
            });
            continue;
        }

        const raw = rawByBarcode.get(rep.barcode);
        if (!raw) {
            movedDuringPlan.push({
                barcode: rep.barcode, name: rep.name,
                diffs: ['row vanished between the scan and the raw-panel fetch'],
            });
            continue;
        }
        const rawPanel = raw.nutrientsPer100g;
        const diffs: string[] = [];
        if (raw.name !== rep.name) diffs.push(`name: scan ${JSON.stringify(rep.name)} -> fetch ${JSON.stringify(raw.name)}`);
        if (raw.brandName !== rep.brandName) diffs.push(`brandName: scan ${JSON.stringify(rep.brandName)} -> fetch ${JSON.stringify(raw.brandName)}`);
        if (raw.servingGrams !== rep.servingGrams) diffs.push(`servingGrams: scan ${rep.servingGrams} -> fetch ${raw.servingGrams}`);
        if (!panelsExactlyEqual(readPanel(rawPanel), rep.current)) diffs.push('nutrientsPer100g: panel changed between the scan and the raw-panel fetch');
        if (diffs.length > 0) {
            movedDuringPlan.push({ barcode: rep.barcode, name: rep.name, diffs });
            continue;
        }

        const rawBefore = rawPanel as Record<string, unknown>;
        const rawAfter = scaleStoredPanel(rawBefore, rep.servingGrams);
        if (rawAfter == null) {
            // Cannot happen for a row that passed the base filter; refuse loudly
            // rather than emit a plan entry with no after-image.
            throw new Error(`instrument drift: ${rep.barcode} passed the base filter but its raw panel is not an object`);
        }
        // §11 class A tripwire: scaleStoredPanel and the detector's repairPanel
        // are the same multiplication. If they ever disagree on a canonical
        // field, one of them drifted — refuse the whole plan, do not pick one.
        const canonicalAfter = readPanel(rawAfter);
        if (!panelsExactlyEqual(canonicalAfter, rep.repaired)) {
            throw new Error(
                `instrument drift on ${rep.barcode}: scaleStoredPanel and detect-panel-scale-divided.repairPanel disagree `
                + `(${JSON.stringify(canonicalAfter)} vs ${JSON.stringify(rep.repaired)})`,
            );
        }

        entries.push({
            ...rep,
            tier: tierOf(rep),
            rawBefore,
            rawAfter,
            corruptReason: raw.corruptReason,
            duplicateOfBarcode: raw.duplicateOfBarcode,
        });
    }

    // Deterministic plan order — also the sample order.
    entries.sort((a, b) => a.familyKey.localeCompare(b.familyKey) || a.barcode.localeCompare(b.barcode));

    // Per-family summaries (from planned entries; detector stats carried through).
    const famMap = new Map<string, FamilySummary>();
    for (const e of entries) {
        let f = famMap.get(e.familyKey);
        if (!f) {
            f = {
                familyKey: e.familyKey, brandName: e.brandName, tier: e.tier,
                slope: e.familySlope, r2: e.familyR2,
                familySize: e.familySize, familyDistinctServings: e.familyDistinctServings,
                plannedServings: [], plannedRows: 0,
            };
            famMap.set(e.familyKey, f);
        }
        f.plannedRows += 1;
        if (!f.plannedServings.includes(e.servingGrams)) f.plannedServings.push(e.servingGrams);
    }
    const familySummaries = [...famMap.values()];
    for (const f of familySummaries) f.plannedServings.sort((a, b) => a - b);
    familySummaries.sort((a, b) => a.familyKey.localeCompare(b.familyKey));

    // Tier totals.
    const tierRows = (t: Tier) => entries.filter(e => e.tier === t);
    const tierFamilies = (t: Tier) => new Set(tierRows(t).map(e => e.familyKey)).size;
    const tierTotals = {
        tier1: { rows: tierRows(1).length, families: tierFamilies(1) },
        tier2: { rows: tierRows(2).length, families: tierFamilies(2) },
    };

    // Per-brand totals, recomputed over the FINAL entry set (exclusions out),
    // refusals folded in from the scan so nothing exits the ledger.
    const brandMap = new Map<string, BrandSummary>();
    const brand = (name: string): BrandSummary => {
        let b = brandMap.get(name);
        if (!b) {
            b = { brandName: name, rows: 0, tier1Rows: 0, tier2Rows: 0, families: 0, refusals: 0 };
            brandMap.set(name, b);
        }
        return b;
    };
    const famPerBrand = new Map<string, Set<string>>();
    for (const e of entries) {
        const b = brand(e.brandName);
        b.rows += 1;
        if (e.tier === 1) b.tier1Rows += 1; else b.tier2Rows += 1;
        let s = famPerBrand.get(e.brandName);
        if (!s) { s = new Set(); famPerBrand.set(e.brandName, s); }
        s.add(e.familyKey);
    }
    for (const [name, s] of famPerBrand) brand(name).families = s.size;
    for (const r of report.refusals) brand(r.brandName).refusals += 1;
    const byBrand = [...brandMap.values()].sort((a, b) => b.rows - a.rows || a.brandName.localeCompare(b.brandName));

    return {
        planKind: PLAN_KIND,
        planVersion: PLAN_VERSION,
        at,
        arm: REPAIR_ARM,
        unsettled: UNSETTLED_FLOOR,
        scan: {
            scanned: report.scanned,
            baseFilterPassed: report.baseFilterPassed,
            skippedEmptyNameKey: report.skippedEmptyNameKey,
            families: report.families,
            qualifyingFamilies: report.qualifyingFamilies,
            flaggedFamilies: report.flaggedFamilies,
            flaggedRows: report.flaggedRows,
            flaggedRowsAllArms: report.flaggedRowsAllArms,
            flaggedFamiliesAllArms: report.flaggedFamiliesAllArms,
        },
        tierTotals,
        exclusions,
        refusals: report.refusals,
        refusalCount: report.refusalCount,
        movedDuringPlan,
        familySummaries,
        byBrand,
        entries,
    };
}

// ===========================================================================
// Plan + manifest validation (fail-closed; every reason is explicit)
// ===========================================================================

export type PlanParse = { ok: true; plan: RepairPlan; sha256: string } | { ok: false; reason: string };

/** sha256 hex digest — the plan-artifact pin (item: the hash the dry run
 *  prints is the hash --execute re-derives from the exact bytes it read). */
export function sha256Hex(data: string | Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return v != null && typeof v === 'object' && !Array.isArray(v);
}

export function validatePlanText(text: string): PlanParse {
    if (!text.trim()) return { ok: false, reason: 'plan file is EMPTY' };
    let raw: unknown;
    try { raw = JSON.parse(text); } catch (e) {
        return { ok: false, reason: `plan is not parseable JSON (truncated?): ${(e as Error).message}` };
    }
    if (!isPlainObject(raw)) return { ok: false, reason: 'plan is not a JSON object' };
    const p = raw as Partial<RepairPlan> & Record<string, unknown>;
    if (p.planKind !== PLAN_KIND) {
        return {
            ok: false,
            reason: `planKind is ${JSON.stringify(p.planKind)}, expected "${PLAN_KIND}" — this is not a plan produced by `
                + 'repair-panel-scale-divided.ts (a detect-panel-scale-divided.ts ScanReport is NOT executable: it lacks '
                + 'the raw before-values the per-row moved check anchors to)',
        };
    }
    if (p.planVersion !== PLAN_VERSION) {
        return { ok: false, reason: `planVersion ${JSON.stringify(p.planVersion)} != ${PLAN_VERSION} — regenerate the plan with this script version` };
    }
    if (p.arm !== REPAIR_ARM) {
        return { ok: false, reason: `plan arm is ${JSON.stringify(p.arm)}, only "${REPAIR_ARM}" is a repair candidate set` };
    }
    if (typeof p.at !== 'string' || Number.isNaN(new Date(p.at).getTime())) {
        return { ok: false, reason: `plan "at" timestamp is missing or unparseable (${JSON.stringify(p.at)})` };
    }
    if (!Array.isArray(p.entries) || p.entries.length === 0) {
        return { ok: false, reason: 'plan has no entries — an empty plan is not executable (nothing to approve is not approval)' };
    }
    const seen = new Set<string>();
    for (let i = 0; i < p.entries.length; i++) {
        const e = p.entries[i] as Partial<PlanEntry>;
        const at = `entries[${i}]`;
        if (typeof e.barcode !== 'string' || e.barcode.trim() === '') return { ok: false, reason: `${at}: missing barcode` };
        if (seen.has(e.barcode)) return { ok: false, reason: `${at}: duplicate barcode ${e.barcode} — a row repaired twice is multiplied twice` };
        seen.add(e.barcode);
        const excluded = EXCLUDED_BARCODES.get(e.barcode);
        if (excluded !== undefined) {
            return {
                ok: false,
                reason: `${at}: barcode ${e.barcode} is on EXCLUDED_BARCODES (${excluded}) — this plan was not produced by the `
                    + 'current script (hand-edited, or cut before the exclusion landed). Regenerate the plan.',
            };
        }
        if (typeof e.name !== 'string' || typeof e.brandName !== 'string') return { ok: false, reason: `${at} (${e.barcode}): missing name/brandName` };
        if (typeof e.familyKey !== 'string' || e.familyKey.trim() === '') return { ok: false, reason: `${at} (${e.barcode}): missing familyKey` };
        if (e.tier !== 1 && e.tier !== 2) return { ok: false, reason: `${at} (${e.barcode}): tier must be 1 or 2 (got ${JSON.stringify(e.tier)})` };
        if (typeof e.familyDistinctServings !== 'number' || !Number.isInteger(e.familyDistinctServings) || e.familyDistinctServings < 2) {
            return {
                ok: false,
                reason: `${at} (${e.barcode}): familyDistinctServings ${JSON.stringify(e.familyDistinctServings)} is missing or invalid `
                    + '(a qualifying family has >= 2 distinct sizes) — without it the tier label cannot be recomputed, so it cannot be trusted',
            };
        }
        // The tier label is RECOMPUTED from the entry's own family data, never
        // trusted: --tier selects the write scope by this label, so a
        // hand-relabelled tier-2 entry would otherwise ride into a --tier 1
        // apply that Diego approved on tier-1 evidence alone.
        const recomputedTier = tierOf({ familyDistinctServings: e.familyDistinctServings });
        if (e.tier !== recomputedTier) {
            return {
                ok: false,
                reason: `${at} (${e.barcode}): tier is labelled ${e.tier} but the entry's own familyDistinctServings=${e.familyDistinctServings} `
                    + `recomputes to tier ${recomputedTier} — a relabelled tier changes the WRITE SCOPE --tier selects (hand-edited plan, or `
                    + 'a stale plan from a different tier rule). Regenerate the plan.',
            };
        }
        if (typeof e.servingGrams !== 'number' || !isFinite(e.servingGrams) || e.servingGrams < MIN_FLAGGED_SERVING_G) {
            return {
                ok: false,
                reason: `${at} (${e.barcode}): servingGrams ${JSON.stringify(e.servingGrams)} is below the detector's ${MIN_FLAGGED_SERVING_G} g member guard. `
                    + 'No detector-produced entry can be here — and the plausibility guard is ONE-SIDED (ceilings only), so a small-S '
                    + 'entry would SHRINK a panel and pass every ceiling. Refusing the plan.',
            };
        }
        if (!isPlainObject(e.rawBefore) || readPanel(e.rawBefore) == null) {
            return { ok: false, reason: `${at} (${e.barcode}): rawBefore is missing or not a readable panel` };
        }
        if (!isPlainObject(e.rawAfter) || readPanel(e.rawAfter) == null) {
            return { ok: false, reason: `${at} (${e.barcode}): rawAfter is missing or not a readable panel` };
        }
    }
    return { ok: true, plan: raw as RepairPlan, sha256: sha256Hex(text) };
}

export function loadPlan(planPath: string): PlanParse {
    let text: string;
    try { text = fs.readFileSync(planPath, 'utf8'); } catch (e) {
        return { ok: false, reason: `cannot read plan file ${planPath}: ${(e as Error).message}` };
    }
    return validatePlanText(text);
}

/**
 * The plan-artifact hash gate. `computed` is the sha256 of the exact bytes
 * --plan pointed at; `provided` is --plan-sha256 (null when omitted). The flag
 * is OPTIONAL by design: when omitted the computed hash is printed prominently
 * so the operator can eyeball it against the one the dry run printed on the
 * approved artifact — omission weakens the gate to a human check, it does not
 * skip it silently.
 */
export function checkPlanSha256(
    computed: string,
    provided: string | null,
): { ok: true; lines: string[] } | { ok: false; reason: string } {
    if (provided === null) {
        return {
            ok: true,
            lines: [
                `plan sha256 (computed): ${computed}`,
                'no --plan-sha256 was provided — EYEBALL the hash above against the one the dry run printed on the',
                'approved artifact before trusting this run; pass --plan-sha256 to make the check refuse mechanically.',
            ],
        };
    }
    if (provided.toLowerCase() !== computed.toLowerCase()) {
        return {
            ok: false,
            reason: `--plan-sha256 mismatch: provided ${provided}, but the --plan file's bytes hash to ${computed} — `
                + 'this is NOT the approved plan artifact (edited, regenerated, or the wrong file). Point --plan at the '
                + 'exact file the dry run wrote, or re-approve the new one.',
        };
    }
    return { ok: true, lines: [`plan sha256 verified: ${computed} (matches --plan-sha256)`] };
}

/** The subset of snapshot-off-food.ts's manifest this gate depends on. */
export interface SnapshotManifest {
    table: string;
    createdAt: string;
    sshHost: string;
    file: string;
    rowCount: number;
    columnCount: number;
    columns: string[];
    sha256: string;
    gzipBytes: number;
    format: string;
    restore: string[];
}

export type ManifestParse = { ok: true; manifest: SnapshotManifest } | { ok: false; reason: string };

/**
 * Validate a snapshot manifest's text. snapshot-off-food.ts only writes a
 * .meta.json AFTER every verification passes (count-before == dump lines ==
 * count-after, gzip -t, column pinning) and only next to a data file that has
 * been renamed from .partial to its FINAL name — so a manifest that parses,
 * names the right table, and carries the verification fields IS the proof of a
 * verified snapshot. Everything below refuses rather than assumes.
 */
export function validateManifestText(text: string): ManifestParse {
    if (!text.trim()) return { ok: false, reason: 'snapshot manifest is EMPTY' };
    let raw: unknown;
    try { raw = JSON.parse(text); } catch (e) {
        return { ok: false, reason: `snapshot manifest is not parseable JSON: ${(e as Error).message}` };
    }
    if (!isPlainObject(raw)) return { ok: false, reason: 'snapshot manifest is not a JSON object' };
    const m = raw as Partial<SnapshotManifest>;
    if (m.table !== TABLE) {
        return { ok: false, reason: `manifest table is ${JSON.stringify(m.table)}, expected "${TABLE}" — this snapshot cannot roll back an ${TABLE} repair` };
    }
    if (typeof m.createdAt !== 'string' || Number.isNaN(new Date(m.createdAt).getTime())) {
        return { ok: false, reason: `manifest createdAt is missing or unparseable (${JSON.stringify(m.createdAt)})` };
    }
    if (typeof m.sshHost !== 'string' || m.sshHost.trim() === '') {
        return {
            ok: false,
            reason: 'manifest carries no sshHost — --execute must verify the dump file still exists on the DB host '
                + 'before writing, and it cannot without the host the snapshot was taken on',
        };
    }
    if (typeof m.rowCount !== 'number' || !Number.isInteger(m.rowCount) || m.rowCount <= 0) {
        return { ok: false, reason: `manifest rowCount ${JSON.stringify(m.rowCount)} is not a positive integer — an empty snapshot is not a rollback path` };
    }
    if (!Array.isArray(m.columns) || m.columns.length === 0 || !m.columns.every(c => typeof c === 'string')) {
        return { ok: false, reason: 'manifest columns list is missing or malformed' };
    }
    if (m.columnCount !== m.columns.length) {
        return { ok: false, reason: `manifest columnCount ${JSON.stringify(m.columnCount)} != columns.length ${m.columns.length} — internally inconsistent (partial write?)` };
    }
    const missing = REQUIRED_COLUMNS.filter(c => !(m.columns as string[]).includes(c));
    if (missing.length > 0) {
        return { ok: false, reason: `manifest is missing repair-writable column(s): ${missing.join(', ')} — this snapshot cannot restore what the repair writes` };
    }
    if (typeof m.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(m.sha256)) {
        return { ok: false, reason: `manifest sha256 is missing or malformed (${JSON.stringify(m.sha256)}) — the verification fields are the point of the manifest` };
    }
    if (typeof m.gzipBytes !== 'number' || !Number.isInteger(m.gzipBytes) || m.gzipBytes <= 0) {
        return { ok: false, reason: `manifest gzipBytes ${JSON.stringify(m.gzipBytes)} is not a positive integer` };
    }
    if (typeof m.file !== 'string' || !m.file.endsWith('.tsv.gz') || m.file.includes('.partial')) {
        return {
            ok: false,
            reason: `manifest data file ${JSON.stringify(m.file)} is not a FINAL .tsv.gz name — only the final name means `
                + '"verified" (a .partial is an unverified dump by contract)',
        };
    }
    if (typeof m.format !== 'string' || !m.format.includes('COPY')) {
        return { ok: false, reason: `manifest format ${JSON.stringify(m.format)} is not the COPY-text format snapshot-off-food.ts produces` };
    }
    if (!Array.isArray(m.restore) || m.restore.length === 0 || !m.restore.every(l => typeof l === 'string')) {
        return { ok: false, reason: 'manifest carries no restore recipe — refusing to treat it as a rollback path' };
    }
    return { ok: true, manifest: m as SnapshotManifest };
}

export function loadManifest(manifestPath: string): ManifestParse {
    if (!manifestPath.endsWith('.meta.json')) {
        return {
            ok: false,
            reason: `--snapshot-manifest must point at the .meta.json snapshot-off-food.ts writes (got ${JSON.stringify(manifestPath)}). `
                + 'The data file or any other JSON is not the verification record.',
        };
    }
    let text: string;
    try { text = fs.readFileSync(manifestPath, 'utf8'); } catch (e) {
        return { ok: false, reason: `cannot read snapshot manifest ${manifestPath}: ${(e as Error).message}` };
    }
    return validateManifestText(text);
}

/**
 * The operational order is plan -> approve -> snapshot -> execute. A manifest
 * OLDER than the plan means the rollback anchor does not hold the rows as they
 * stood at approval time; refuse and re-snapshot (one command) rather than
 * argue about what moved in between.
 */
export function checkSnapshotCoversPlan(manifestCreatedAt: string, planAt: string): { ok: true } | { ok: false; reason: string } {
    const m = new Date(manifestCreatedAt).getTime();
    const p = new Date(planAt).getTime();
    if (Number.isNaN(m) || Number.isNaN(p)) {
        return { ok: false, reason: `unparseable timestamp (manifest ${JSON.stringify(manifestCreatedAt)}, plan ${JSON.stringify(planAt)})` };
    }
    if (m < p) {
        return {
            ok: false,
            reason: `snapshot manifest (${manifestCreatedAt}) is OLDER than the plan (${planAt}). The order is `
                + 'plan -> approve -> snapshot -> execute, so the rollback anchor holds the rows as approved. '
                + 'Take a fresh snapshot (snapshot-off-food.ts) and re-run.',
        };
    }
    return { ok: true };
}

/**
 * Execute-time check that the rollback path is still REAL: the dump file the
 * manifest names must still exist on the DB host and hash to the manifest's
 * sha256. A manifest is a claim about the host at snapshot time; the writes
 * happen NOW, and a deleted or replaced dump means the "verified snapshot"
 * gate is holding a receipt for a rollback that no longer exists.
 *
 * The transport is snapshot-off-food.ts's own (bash -c wrapped ssh) — imported,
 * not re-implemented, because a re-implementation that drifts from the real
 * remote path is playbook §11 class A. Runs ONLY in execute mode (already an
 * authorized-prod-access context); offline tests mock the Transport boundary.
 *
 * The remote script exits 0 on both verdicts (like snapshot-off-food.ts's
 * refuse-overwrite probe) so a transport failure is never mistaken for a
 * verdict; the verdict itself is parsed, and anything unrecognized refuses
 * (§11 class B — a sha256sum failure inside the substitution yields
 * "PRESENT " with no hash, which must refuse, not pass).
 */
export async function verifySnapshotOnHost(
    manifest: Pick<SnapshotManifest, 'file' | 'sha256' | 'sshHost'>,
    t: Transport,
): Promise<{ ok: true; sha256: string } | { ok: false; reason: string }> {
    const script = `if [ -f ${shellQuote(manifest.file)} ]; then printf 'PRESENT %s\\n' "$(sha256sum ${shellQuote(manifest.file)} | awk '{print $1}')"; else echo MISSING; fi`;
    let res;
    try {
        res = await t.exec('verify-snapshot-on-host', script);
    } catch (e) {
        return {
            ok: false,
            reason: `cannot verify the snapshot dump on ${manifest.sshHost}: transport threw (${(e as Error).message}) — `
                + 'an unverifiable rollback path is not a rollback path; refusing to write',
        };
    }
    if (res.code !== 0) {
        return {
            ok: false,
            reason: `cannot verify the snapshot dump on ${manifest.sshHost}: remote check exited ${res.code} `
                + `(stderr: ${res.stderr.trim().slice(0, 300) || '(empty)'}) — an unverifiable rollback path is not a rollback path; refusing to write`,
        };
    }
    const verdict = res.stdout.trim();
    if (verdict === 'MISSING') {
        return {
            ok: false,
            reason: `the snapshot dump ${manifest.file} NO LONGER EXISTS on ${manifest.sshHost} — the manifest is a receipt for a `
                + 'rollback path that is gone (deleted, moved, or the host was re-provisioned). Take a fresh snapshot '
                + '(snapshot-off-food.ts), re-check it covers the plan, and re-run.',
        };
    }
    const m = /^PRESENT ([0-9a-f]{64})$/i.exec(verdict);
    if (!m) {
        return {
            ok: false,
            reason: `unrecognized verdict from the dump-file check on ${manifest.sshHost}: ${JSON.stringify(verdict.slice(0, 200))} — `
                + 'refusing rather than guessing (an empty hash means sha256sum itself failed on the host)',
        };
    }
    if (m[1].toLowerCase() !== manifest.sha256.toLowerCase()) {
        return {
            ok: false,
            reason: `snapshot dump sha256 MISMATCH on ${manifest.sshHost}: the manifest says ${manifest.sha256} but ${manifest.file} `
                + `now hashes to ${m[1]} — the dump was modified or replaced AFTER verification, so it can no longer restore what `
                + 'the manifest promises. Take a fresh snapshot and re-run.',
        };
    }
    return { ok: true, sha256: m[1].toLowerCase() };
}

// ===========================================================================
// Apply (execute)
// ===========================================================================

/**
 * Row-by-row application. For EACH entry, in order:
 *   1. re-read the live row (immediately before its own write, not in bulk);
 *   2. refuse if missing, or if ANY recorded before-value moved;
 *   3. RECOMPUTE the repair from the live panel;
 *   4. run the plausibility guard on the recomputed panel — every write gated;
 *   5. refuse if the recomputation disagrees with the plan's rawAfter;
 *   6. write the RECOMPUTED panel.
 * Refusals are per-row, counted, and listed; other rows proceed. The plan's
 * rawAfter is never written directly — it is only the cross-check.
 */
export async function applyPlan(entries: PlanEntry[], db: RepairDb): Promise<ApplyResult> {
    const applied: ApplyResult['applied'] = [];
    const refusals: ApplyRefusal[] = [];
    for (const e of entries) {
        const live = await db.fetchRow(e.barcode);
        if (!live) {
            refusals.push({
                barcode: e.barcode, name: e.name, familyKey: e.familyKey,
                reason: 'row-missing-live',
                detail: ['row no longer exists (deleted since the plan was cut)'],
            });
            continue;
        }

        const moved: string[] = [];
        if (live.name !== e.name) moved.push(`name: plan ${JSON.stringify(e.name)} -> live ${JSON.stringify(live.name)}`);
        if (live.brandName !== e.brandName) moved.push(`brandName: plan ${JSON.stringify(e.brandName)} -> live ${JSON.stringify(live.brandName)}`);
        if (live.servingGrams !== e.servingGrams) moved.push(`servingGrams: plan ${e.servingGrams} -> live ${JSON.stringify(live.servingGrams)}`);
        if ((live.corruptReason ?? null) !== (e.corruptReason ?? null)) {
            moved.push(`corruptReason: plan ${JSON.stringify(e.corruptReason ?? null)} -> live ${JSON.stringify(live.corruptReason)} (another instrument judged this row since the plan)`);
        }
        if ((live.duplicateOfBarcode ?? null) !== (e.duplicateOfBarcode ?? null)) {
            moved.push(`duplicateOfBarcode: plan ${JSON.stringify(e.duplicateOfBarcode ?? null)} -> live ${JSON.stringify(live.duplicateOfBarcode)}`);
        }
        if (!isPlainObject(live.nutrientsPer100g) || !jsonEqual(live.nutrientsPer100g, e.rawBefore)) {
            const livePanel = isPlainObject(live.nutrientsPer100g) ? live.nutrientsPer100g : {};
            const fieldDiffs = panelFieldDiffs(e.rawBefore, livePanel);
            moved.push(`nutrientsPer100g moved since the plan: ${fieldDiffs.length ? fieldDiffs.join('; ') : 'panel is no longer an object'}`);
        }
        if (moved.length > 0) {
            refusals.push({ barcode: e.barcode, name: e.name, familyKey: e.familyKey, reason: 'row-moved', detail: moved });
            continue;
        }

        // Recompute from the LIVE row — the plan is an approval record, not a
        // source of values.
        const repaired = scaleStoredPanel(live.nutrientsPer100g, live.servingGrams as number);
        if (repaired == null) {
            refusals.push({
                barcode: e.barcode, name: e.name, familyKey: e.familyKey,
                reason: 'repaired-panel-unreadable',
                detail: ['live panel is not an object (cannot happen after the moved check; refusing anyway)'],
            });
            continue;
        }
        const repairedCanonical = readPanel(repaired);
        if (repairedCanonical == null) {
            refusals.push({
                barcode: e.barcode, name: e.name, familyKey: e.familyKey,
                reason: 'repaired-panel-unreadable',
                detail: ['recomputed panel has no positive calories field'],
            });
            continue;
        }

        // THE PLAUSIBILITY GUARD — gates every single write, recomputed live.
        const guardReasons = guardRepair(repairedCanonical);
        if (guardReasons.length > 0) {
            refusals.push({ barcode: e.barcode, name: e.name, familyKey: e.familyKey, reason: 'guard-refused', detail: guardReasons });
            continue;
        }

        if (!scaledPanelsEqual(repaired, e.rawAfter)) {
            refusals.push({
                barcode: e.barcode, name: e.name, familyKey: e.familyKey,
                reason: 'plan-drift',
                detail: [
                    'recomputed repair disagrees with the plan\'s rawAfter (hand-edited plan, or the repair code changed '
                    + `since the plan was cut): recomputed ${JSON.stringify(repaired)} vs plan ${JSON.stringify(e.rawAfter)}`,
                ],
            });
            continue;
        }

        await db.writePanel(e.barcode, repaired);
        applied.push({ barcode: e.barcode, name: e.name, servingGrams: e.servingGrams });
    }
    return { applied, refusals };
}

/** 0 only when at least one row was actually applied. An execute where EVERY
 *  row refused is a broken run (stale plan, moved population), not a success —
 *  "0 changed records" with exit 0 is the exact fail-open shape of
 *  cache-parity-sweep.ts (§11 class B). */
export function executeExitCode(result: Pick<ApplyResult, 'applied'>): number {
    return result.applied.length > 0 ? 0 : 2;
}

// ===========================================================================
// Output formatting
// ===========================================================================

const fmt = (v: number | null | undefined, digits = 2): string => (v == null ? '-' : v.toFixed(digits));

export function formatEntryFields(e: PlanEntry): string[] {
    const keys = [...new Set([...Object.keys(e.rawBefore), ...Object.keys(e.rawAfter)])].sort();
    const out: string[] = [];
    for (const k of keys) {
        const b = e.rawBefore[k];
        const a = e.rawAfter[k];
        if (typeof b === 'number' && typeof a === 'number') {
            out.push(`      ${k.padEnd(10)} ${b.toFixed(3).padStart(10)} -> ${a.toFixed(3)}`);
        } else {
            out.push(`      ${k.padEnd(10)} ${JSON.stringify(b)} -> ${JSON.stringify(a)} (non-numeric: passed through unchanged)`);
        }
    }
    return out;
}

export function formatPlanSummary(plan: RepairPlan, sampleSize: number): string[] {
    const out: string[] = [];
    out.push('');
    out.push('================ DIVIDED-PANEL REPAIR PLAN (DRY RUN — nothing written) ================');
    out.push(plan.unsettled);
    out.push('');
    out.push(`Scan: ${plan.scan.scanned} rows scanned, ${plan.scan.baseFilterPassed} past the base filter, `
        + `${plan.scan.skippedEmptyNameKey} skipped for an empty family key.`);
    out.push(`Families: ${plan.scan.families} total, ${plan.scan.qualifyingFamilies} multi-size qualifying; `
        + `flagged (all arms): ${plan.scan.flaggedRowsAllArms} rows / ${plan.scan.flaggedFamiliesAllArms} families.`);
    out.push(`Arm "${plan.arm}" (structural: length(barcode) > 13): ${plan.scan.flaggedRows} rows / ${plan.scan.flaggedFamilies} families.`);
    out.push('');
    out.push(`PLAN: ${plan.entries.length} repairs across ${plan.familySummaries.length} families / ${plan.byBrand.length} brands.`);
    out.push(`  tier 1 (families with >= ${TIER1_MIN_DISTINCT_SERVINGS} distinct sizes — strong evidence): `
        + `${plan.tierTotals.tier1.rows} rows / ${plan.tierTotals.tier1.families} families`);
    out.push(`  tier 2 (2-size families — a 2-point log-log fit is perfect BY CONSTRUCTION; weak evidence): `
        + `${plan.tierTotals.tier2.rows} rows / ${plan.tierTotals.tier2.families} families`);
    out.push('  --execute REQUIRES an explicit --tier 1|2|all (the write scope is never defaulted), so tier 1 can be approved and applied alone.');
    out.push('');
    out.push(`EXCLUDED by name (${plan.exclusions.length}):`);
    for (const x of plan.exclusions) {
        out.push(`  ${x.barcode} "${x.name}" [${x.brandName}] — ${x.reason}`);
    }
    if (plan.exclusions.length === 0) {
        out.push('  (none matched — verify EXCLUDED_BARCODES against the corrections table before approving)');
    }
    out.push('');
    out.push(`Repairs REFUSED by the post-repair plausibility guard: ${plan.refusalCount} (refused, counted, listed — never dropped)`);
    for (const r of plan.refusals) {
        out.push(`  REFUSED ${r.barcode} "${r.name}" [${r.brandName}] S=${r.servingGrams}g: ${r.reasons.join('; ')}`);
    }
    if (plan.movedDuringPlan.length > 0) {
        out.push('');
        out.push(`Rows that MOVED between scan and raw fetch (not in the plan; re-run the dry run): ${plan.movedDuringPlan.length}`);
        for (const m of plan.movedDuringPlan) out.push(`  MOVED ${m.barcode} "${m.name}": ${m.diffs.join('; ')}`);
    }
    out.push('');
    out.push('Per brand (rows / tier1 / tier2 / families / guard-refused):');
    for (const b of plan.byBrand) {
        out.push(`  ${b.brandName.padEnd(28)} ${String(b.rows).padStart(5)} / ${String(b.tier1Rows).padStart(5)} / ${String(b.tier2Rows).padStart(5)} / ${String(b.families).padStart(4)} / ${b.refusals}`);
    }
    out.push('');
    const n = Math.min(sampleSize, plan.entries.length);
    out.push(`HAND-AUDIT SAMPLE — deterministic: the first ${n} plan entries ordered by (familyKey, barcode).`);
    out.push('Every numeric field, before -> after. Full per-row detail for ALL entries is in the plan JSON.');
    let lastFamily = '';
    for (const e of plan.entries.slice(0, n)) {
        if (e.familyKey !== lastFamily) {
            lastFamily = e.familyKey;
            out.push('');
            out.push(`  [tier ${e.tier}] ${e.familyKey}  (slope ${fmt(e.familySlope, 3)}, r2 ${fmt(e.familyR2, 3)}, family n=${e.familySize}, distinct sizes=${e.familyDistinctServings})`);
        }
        out.push(`    ${e.barcode} "${e.name}" S=${e.servingGrams}g  bills ${Math.round(e.currentServingKcal)} kcal today -> ${Math.round(e.repairedServingKcal)} after (${fmt(e.understatementFactor, 1)}x under)`
            + (e.corruptReason ? `  [corruptReason=${e.corruptReason}]` : ''));
        out.push(...formatEntryFields(e));
    }
    out.push('');
    out.push('NEXT (Phase 3, needs Diego): approve this plan (tier 1 alone is approvable), take a fresh verified');
    out.push('OffFood snapshot (scripts/eval/snapshot-off-food.ts — the manifest must be NEWER than this plan),');
    out.push('then: repair-panel-scale-divided.ts --execute --plan <this file> --snapshot-manifest <.meta.json> \\');
    out.push('        --tier 1 --plan-sha256 <the hash printed under "Plan sha256:" below>');
    out.push('READ-ONLY: nothing was written to the database by this dry run.');
    return out;
}

export function mandatoryNextSteps(manifestPath: string, appliedCount: number): string[] {
    return [
        '',
        '=================== MANDATORY NEXT STEPS — THE REPAIR IS NOT DONE YET ===================',
        `${appliedCount} row(s) were repaired in Postgres. Until BOTH steps below run, parts of the system`,
        'still bill the corrupt numbers:',
        '',
        '1. FULL Typesense rebuild ON THE DB HOST. The search path serves nutrients straight off the',
        '   Typesense hit (src/lib/mapping/gather-candidates.ts:160 maps hit.nutrientsPer100g into the',
        '   candidate), so search keeps billing the OLD panels until the index is rebuilt:',
        '     cd /home/owner/Recipe-App && npx ts-node --project tsconfig.scripts.json --transpile-only \\',
        '       -r tsconfig-paths/register scripts/sync-typesense.ts',
        '   FULL rebuild, not incremental: updateTypesenseDocumentsByFilter PATCHes ONE identical partial',
        '   doc into every filter match (right for a uniform flag, wrong for per-row panel values), and',
        '   live off_foods doc ids can predate id=barcode keying, so a hand-rolled per-row upsert can',
        '   DUPLICATE docs instead of replacing them.',
        '',
        '2. FoodMapping cache: 203 cache rows point into this import (72 materially distorted).',
        '   NO eviction is needed — FoodMapping is identity-only (offBarcode pointer; billing hydrates the',
        '   panel from OffFood per request), so cache-hit traffic picks up the repair from Postgres',
        '   directly and search traffic picks it up after step 1. VERIFY with a live probe: a Jersey',
        "   Mike's #44 Giant vs Regular pair must now bill ~1,831 vs ~937 kcal instead of an identical 173.",
        '',
        'Unblocked by this repair: warm batches 07, 08, 09, 10 (handoff §5a Phase 3 gated them on the',
        'corpus repair, not the eviction).',
        '',
        `Rollback path: the snapshot manifest at ${manifestPath} carries the per-row restore recipe`,
        '(side table + UPDATE ... FROM, then the SAME full Typesense rebuild — a Postgres-only rollback',
        'leaves search billing un-rolled-back numbers indefinitely).',
        '==========================================================================================',
    ];
}

// ===========================================================================
// CLI parsing (pure; the refusals ARE the gate, so they are testable)
// ===========================================================================

export const USAGE = [
    'usage:',
    '  repair-panel-scale-divided.ts                       # DRY RUN (default): scan + emit the plan',
    '      [--out <plan.json>] [--sample <N>]',
    '  repair-panel-scale-divided.ts --execute             # Phase 3 only, after approval',
    '      --plan <approved-plan.json> --snapshot-manifest <OffFood-*.meta.json> --tier 1|2|all',
    '      [--plan-sha256 <the 64-hex hash the dry run printed>]',
].join('\n');

export type CliParse =
    | { ok: true; mode: 'dry-run'; out: string | null; sample: number }
    | { ok: true; mode: 'execute'; planPath: string; manifestPath: string; tier: TierFilter; planSha256: string | null }
    | { ok: false; reason: string };

export function parseRepairArgs(argv: string[]): CliParse {
    let execute = false;
    let planPath: string | undefined;
    let manifestPath: string | undefined;
    let tier: TierFilter | undefined;
    let planSha256: string | null = null;
    let out: string | null = null;
    let sample = DEFAULT_SAMPLE_SIZE;
    let sampleSet = false;

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const value = (): string | { err: string } => {
            const v = argv[i + 1];
            if (v === undefined || v.startsWith('--')) return { err: `${a} requires a value` };
            i++;
            return v;
        };
        if (a === '--execute') { execute = true; continue; }
        if (a === '--plan') {
            const v = value();
            if (typeof v !== 'string') return { ok: false, reason: `${v.err}. ${USAGE}` };
            planPath = v;
            continue;
        }
        if (a === '--snapshot-manifest') {
            const v = value();
            if (typeof v !== 'string') return { ok: false, reason: `${v.err}. ${USAGE}` };
            manifestPath = v;
            continue;
        }
        if (a === '--tier') {
            const v = value();
            if (typeof v !== 'string') return { ok: false, reason: `${v.err}. ${USAGE}` };
            if (v !== '1' && v !== '2' && v !== 'all') return { ok: false, reason: `--tier must be 1, 2 or all (got ${JSON.stringify(v)}). ${USAGE}` };
            tier = v;
            continue;
        }
        if (a === '--plan-sha256') {
            const v = value();
            if (typeof v !== 'string') return { ok: false, reason: `${v.err}. ${USAGE}` };
            if (!/^[0-9a-f]{64}$/i.test(v)) {
                return { ok: false, reason: `--plan-sha256 must be a 64-hex sha256 (got ${JSON.stringify(v)}) — copy the hash the dry run printed, whole. ${USAGE}` };
            }
            planSha256 = v;
            continue;
        }
        if (a === '--out') {
            const v = value();
            if (typeof v !== 'string') return { ok: false, reason: `${v.err}. ${USAGE}` };
            out = v;
            continue;
        }
        if (a === '--sample') {
            const v = value();
            if (typeof v !== 'string') return { ok: false, reason: `${v.err}. ${USAGE}` };
            const n = Number(v);
            if (!Number.isInteger(n) || n <= 0) return { ok: false, reason: `--sample must be a positive integer (got ${JSON.stringify(v)}). ${USAGE}` };
            sample = n;
            sampleSet = true;
            continue;
        }
        // Unknown flags and stray positionals REFUSE (a typo silently ignored
        // is a class-B hole — "--execute --plna x" must not become a dry run
        // that reads as "executed fine").
        return { ok: false, reason: `unknown argument ${JSON.stringify(a)}. ${USAGE}` };
    }

    if (execute) {
        if (!planPath) {
            return { ok: false, reason: `--execute refuses without --plan <approved-plan.json>: the plan is the approval record and the per-row moved-check anchor. ${USAGE}` };
        }
        if (!manifestPath) {
            return {
                ok: false,
                reason: '--execute refuses without --snapshot-manifest <path>: a verified OffFood snapshot '
                    + `(scripts/eval/snapshot-off-food.ts .meta.json) is the ONLY rollback path for a repair that multiplies panels by up to 50x. ${USAGE}`,
            };
        }
        if (tier === undefined) {
            // No default: the tier is the WRITE SCOPE, and the old implicit
            // 'all' silently selected the widest one — the exact shape of an
            // operator typing --execute and getting more writes than approved.
            return {
                ok: false,
                reason: '--execute refuses without an explicit --tier: the tier is the WRITE SCOPE and it is never defaulted. '
                    + `--tier 1 = families with >= ${TIER1_MIN_DISTINCT_SERVINGS} distinct sizes (strong evidence; ~2,093 rows in the live corpus), `
                    + '--tier 2 = 2-size families (weak evidence; ~1,080 rows), --tier all = both (~3,173 rows). '
                    + `The exact counts for YOUR plan are in its tierTotals block (also printed by the dry-run summary). ${USAGE}`,
            };
        }
        if (out !== null) return { ok: false, reason: `--out is a dry-run flag (the plan is INPUT to --execute, via --plan). ${USAGE}` };
        if (sampleSet) {
            return {
                ok: false,
                reason: '--sample is a dry-run flag: --execute applies EVERY selected row or refuses — a "sampled apply" does not exist, '
                    + `so an operator expecting a scoped write would silently get the whole tier. Scope by --tier, or approve a smaller plan. ${USAGE}`,
            };
        }
        return { ok: true, mode: 'execute', planPath, manifestPath, tier, planSha256 };
    }

    if (planPath) return { ok: false, reason: `--plan is only meaningful with --execute (the dry run PRODUCES the plan). ${USAGE}` };
    if (manifestPath) return { ok: false, reason: `--snapshot-manifest is only meaningful with --execute. ${USAGE}` };
    if (tier !== undefined) {
        return { ok: false, reason: `--tier is only meaningful with --execute — the dry-run plan always carries BOTH tiers, separated, so Diego can approve tier 1 alone. ${USAGE}` };
    }
    if (planSha256 !== null) {
        return { ok: false, reason: `--plan-sha256 is only meaningful with --execute — the dry run PRINTS the hash; it does not check one. ${USAGE}` };
    }
    return { ok: true, mode: 'dry-run', out, sample };
}

// ===========================================================================
// DB plumbing
// ===========================================================================

const LIVE_SELECT = {
    barcode: true, name: true, brandName: true, servingGrams: true,
    nutrientsPer100g: true, corruptReason: true, duplicateOfBarcode: true,
} as const;

function prismaDb(prisma: PrismaClient): RepairDb {
    return {
        async fetchRow(barcode: string): Promise<LiveRow | null> {
            const row = await prisma.offFood.findUnique({ where: { barcode }, select: LIVE_SELECT });
            return row as LiveRow | null;
        },
        async writePanel(barcode: string, panel: Record<string, unknown>): Promise<void> {
            await prisma.offFood.update({
                where: { barcode },
                data: { nutrientsPer100g: panel as Prisma.InputJsonValue },
            });
        },
    };
}

const RAW_FETCH_CHUNK = 500;

async function fetchRawRows(prisma: PrismaClient, barcodes: string[]): Promise<Map<string, LiveRow>> {
    const map = new Map<string, LiveRow>();
    for (let i = 0; i < barcodes.length; i += RAW_FETCH_CHUNK) {
        const chunk = barcodes.slice(i, i + RAW_FETCH_CHUNK);
        const rows = await prisma.offFood.findMany({ where: { barcode: { in: chunk } }, select: LIVE_SELECT });
        for (const r of rows) map.set(r.barcode, r as LiveRow);
    }
    return map;
}

// ===========================================================================
// main
// ===========================================================================

async function runDryRun(out: string | null, sample: number): Promise<number> {
    const prisma = new PrismaClient();
    try {
        // No try/catch around the scan: a query failure must reach the
        // top-level handler and exit 2, never fall through to a plan.
        const report = await runScan(prismaStream(prisma), { arm: REPAIR_ARM });
        if (scanExitCode(report) !== 0) {
            console.error(`FAIL: the scan saw ${report.scanned} rows / ${report.baseFilterPassed} past the base filter — broken instrument, not a clean corpus. No plan written.`);
            return 2;
        }
        const rawByBarcode = await fetchRawRows(prisma, report.repairs.map(r => r.barcode));
        const plan = buildPlan(report, rawByBarcode, new Date().toISOString());

        const outDir = path.join(__dirname, 'results');
        fs.mkdirSync(outDir, { recursive: true });
        const ts = plan.at.replace(/[:.]/g, '-');
        const outPath = out ?? path.join(outDir, `panel-scale-repair-plan-${ts}.json`);
        const planJson = JSON.stringify(plan, null, 1);
        fs.writeFileSync(outPath, planJson);

        for (const line of formatPlanSummary(plan, sample)) console.log(line);
        console.log(`\nPlan written to ${path.relative(process.cwd(), outPath)}`);
        // The artifact pin: --execute recomputes this from the exact bytes of
        // the --plan file and refuses a mismatch against --plan-sha256.
        console.log(`Plan sha256: ${sha256Hex(planJson)}`);
        console.log('Record this hash with the approval and pass it to --execute as --plan-sha256 <hash>;');
        console.log('a plan file whose bytes no longer match it is not the approved artifact.');
        return 0;
    } finally {
        await prisma.$disconnect();
    }
}

async function runExecute(planPath: string, manifestPath: string, tier: TierFilter, planSha256: string | null): Promise<number> {
    const parsedPlan = loadPlan(planPath);
    if (!parsedPlan.ok) {
        console.error(`REFUSING: ${parsedPlan.reason}`);
        return 2;
    }
    const plan = parsedPlan.plan;

    // The artifact pin: the hash of the exact bytes --plan pointed at, checked
    // against --plan-sha256 (or printed prominently when the flag was omitted).
    const shaCheck = checkPlanSha256(parsedPlan.sha256, planSha256);
    if (!shaCheck.ok) {
        console.error(`REFUSING: ${shaCheck.reason}`);
        return 2;
    }

    const parsedManifest = loadManifest(manifestPath);
    if (!parsedManifest.ok) {
        console.error(`REFUSING: ${parsedManifest.reason}`);
        return 2;
    }
    const manifest = parsedManifest.manifest;

    const covers = checkSnapshotCoversPlan(manifest.createdAt, plan.at);
    if (!covers.ok) {
        console.error(`REFUSING: ${covers.reason}`);
        return 2;
    }

    const entries = filterByTier(plan.entries, tier);
    if (entries.length === 0) {
        console.error(`REFUSING: --tier ${tier} selects 0 of the plan's ${plan.entries.length} entries — almost certainly the wrong plan file or the wrong tier.`);
        return 2;
    }

    // Last gate before any write, and the only remote one: the rollback dump
    // must still exist on the DB host and hash-match the manifest. Execute
    // mode is already an authorized-prod-access context; the transport is
    // snapshot-off-food.ts's own bash -c wrapped ssh.
    console.log(`[verify-snapshot-on-host] checking ${manifest.file} on ${manifest.sshHost} ...`);
    const hostCheck = await verifySnapshotOnHost(manifest, sshTransport(manifest.sshHost));
    if (!hostCheck.ok) {
        console.error(`REFUSING: ${hostCheck.reason}`);
        return 2;
    }

    console.log('==========================================================================');
    console.log('EXECUTE — divided-panel corpus repair');
    console.log(`  plan     : ${planPath} (cut ${plan.at})`);
    for (const line of shaCheck.lines) console.log(`  ${line}`);
    console.log(`  snapshot : ${manifest.file} (${manifest.rowCount} rows, sha256 ${manifest.sha256.slice(0, 12)}..., taken ${manifest.createdAt})`);
    console.log(`  dump     : verified live on ${manifest.sshHost} — exists, sha256 matches the manifest`);
    console.log(`  tier     : ${tier} -> ${entries.length} of ${plan.entries.length} plan entries`);
    console.log(`  ${plan.unsettled}`);
    console.log('==========================================================================');

    const prisma = new PrismaClient();
    let result: ApplyResult;
    try {
        result = await applyPlan(entries, prismaDb(prisma));
    } finally {
        await prisma.$disconnect();
    }

    console.log('');
    console.log(`APPLIED : ${result.applied.length} row(s)`);
    console.log(`REFUSED : ${result.refusals.length} row(s) — every refusal listed below; none dropped`);
    for (const r of result.refusals) {
        console.log(`  REFUSED [${r.reason}] ${r.barcode} "${r.name}"`);
        for (const d of r.detail) console.log(`     ${d}`);
    }

    const outDir = path.join(__dirname, 'results');
    fs.mkdirSync(outDir, { recursive: true });
    const outcomePath = path.join(outDir, `panel-scale-repair-outcome-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(outcomePath, JSON.stringify({
        at: new Date().toISOString(),
        planPath,
        planAt: plan.at,
        manifestPath,
        manifestSha256: manifest.sha256,
        tier,
        selectedEntries: entries.length,
        appliedCount: result.applied.length,
        refusalCount: result.refusals.length,
        applied: result.applied,
        refusals: result.refusals,
    }, null, 1));
    console.log(`\nOutcome written to ${path.relative(process.cwd(), outcomePath)}`);

    if (result.applied.length > 0) {
        for (const line of mandatoryNextSteps(manifestPath, result.applied.length)) console.log(line);
    }

    const code = executeExitCode(result);
    if (code !== 0) {
        console.error('FAIL: 0 rows applied — every entry refused. A run that changes nothing is a broken run (stale plan or moved population), not a success. Re-cut the plan.');
    }
    return code;
}

async function main(): Promise<number> {
    const cli = parseRepairArgs(process.argv.slice(2));
    if (!cli.ok) {
        console.error(`REFUSING: ${cli.reason}`);
        return 2;
    }
    if (cli.mode === 'dry-run') return runDryRun(cli.out, cli.sample);
    return runExecute(cli.planPath, cli.manifestPath, cli.tier, cli.planSha256);
}

if (require.main === module) {
    main()
        .then(c => process.exit(c))
        .catch(err => { console.error(err); process.exit(2); });
}
