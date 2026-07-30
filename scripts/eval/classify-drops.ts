/**
 * classify-drops.ts — tag a batch of funnel rows with F2 failure classes and report.
 *
 * READ-ONLY. It issues SELECTs against MappingEventLog and FoodMapping and nothing
 * else; there is no write path in this file. It never calls the API, so it cannot
 * warm, evict or repoint anything.
 *
 * The report deliberately does NOT rank by raw event count. The largest single
 * dropReason on the live box (save_rejected:cross_source_margin, 404 of 571
 * save_rejected events) is incumbent protection — correct behaviour — so a
 * count-ranked list sends the first fix-agent at working code. Instead:
 *   - 'healthy' classes are reported in a SEPARATE table from real defects;
 *   - every class shows DISTINCT KEYS alongside events, and is ranked by distinct
 *     keys (one noisy key repeated 400 times is one problem, not four hundred);
 *   - every class shows the hadIncumbent split as CORROBORATION for the claim that a
 *     gate needs an incumbent — not as proof of it. The split is measured at report
 *     time and cannot reproduce a brand-prefixed write key, so it is wrong in both
 *     directions on individual rows; the proof is reading the gate. A large cold
 *     count on an incumbent-only gate is a prompt to go and re-read it;
 *   - residual buckets and truly unclassified rows are reported as FRONTIER with
 *     their raw dropReasons, so new shapes surface instead of hiding in a catch-all;
 *   - `inputFidelity` states what the input SHAPE cannot show — panel-less rows leave
 *     Atwater-based detector arms dark, so those zeros are not findings.
 *
 * Incumbent lookup goes through the derived cache key (see failure-classes.ts,
 * finding 2 and deriveFunnelCacheKey): MappingEventLog.normalizedForm is
 * PRE-canonicalization, so joining it straight to FoodMapping.normalizedForm reports
 * "chicken breast", "eggs" and "pretzels" as uncached and inverts the conclusion —
 * and canonicalizeCacheKey alone still missed the identity discriminators ("3 egg
 * whites" -> "egg white", not "egg"). Lookups are batched.
 *
 * Run (from repo root):
 *   # from a warm-cache results file (no DB needed if you pass --no-incumbent)
 *   npx ts-node -r tsconfig-paths/register --transpile-only --compilerOptions \
 *     '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/eval/classify-drops.ts --in scripts/eval/results/warm-<ts>.json
 *
 *   # from the live event log (read-only)
 *   ... scripts/eval/classify-drops.ts --from-db --since 2026-07-18 --limit 20000
 *
 *   # regenerate the committed doc (no input, no DB)
 *   ... scripts/eval/classify-drops.ts --emit-doc ../../KindaHealthyMobile/sync-docs/failure-classes.md
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FunnelStage } from '../../src/lib/mapping/funnel';
// NOTE: the cache key is derived inside makeFunnelRow (failure-classes.ts), which is
// the ONLY place row.cacheKey is produced — so attachIncumbents below is guaranteed
// to join on the derived key rather than on the raw logged form. That key is
// deriveMappingCacheKey minus its brand-prefix step; keyFidelityOf measures how
// exposed each row is to the difference, and the report prints the total.
import {
    FAILURE_CLASSES,
    FUNNEL_CAVEATS,
    LIVE_DROP_REASONS,
    LIVE_STAGE_COUNTS,
    UNCLASSIFIED,
    classifyRow,
    classStages,
    fromDbBlindSpots,
    keyFidelityOf,
    makeFunnelRow,
    probeLineFor,
    type FailureClass,
    type FunnelRow,
    type FunnelRowInput,
} from './failure-classes';

// ---------------------------------------------------------------------------
// Input adapters
// ---------------------------------------------------------------------------

/** warm-cache.ts WarmResult (or a JSONL line of the same shape). */
interface WarmResultLike {
    seed?: string;
    rawLine?: string;
    normalizedForm?: string | null;
    ok?: boolean;
    foodId?: string;
    foodName?: string;
    brandName?: string;
    source?: string;
    grams?: number;
    totalKcal?: number;
    matchConfidence?: number;
    confidence?: number;
    servingTier?: string;
    per100g?: { kcal?: number; protein?: number; carbs?: number; fat?: number };
    funnelStage?: string;
    dropReason?: string;
    error?: string;
}

function warmToInput(r: WarmResultLike): FunnelRowInput | null {
    const rawLine = r.seed ?? r.rawLine;
    if (!rawLine) return null;
    const p = r.per100g ?? {};
    return {
        rawLine,
        normalizedForm: r.normalizedForm ?? null,
        funnelStage: (r.funnelStage ?? null) as FunnelStage | null,
        dropReason: r.dropReason ?? null,
        confidence: r.matchConfidence ?? r.confidence ?? null,
        grams: r.grams ?? null,
        totalKcal: r.totalKcal ?? null,
        kcalPer100g: p.kcal ?? null,
        proteinPer100g: p.protein ?? null,
        carbsPer100g: p.carbs ?? null,
        fatPer100g: p.fat ?? null,
        source: r.source ?? null,
        foodId: r.foodId ?? null,
        foodName: r.foodName ?? null,
        brandName: r.brandName ?? null,
        servingTier: r.servingTier ?? null,
    };
}

/** Accepts warm-cache JSON ({results:[...]}) , a bare JSON array, or JSONL. */
export function readInputFile(file: string): FunnelRowInput[] {
    const text = fs.readFileSync(file, 'utf8');
    const trimmed = text.trim();
    let records: WarmResultLike[] = [];
    if (trimmed.startsWith('{') && !trimmed.includes('\n{')) {
        const parsed = JSON.parse(trimmed) as { results?: WarmResultLike[] };
        records = parsed.results ?? [];
    } else if (trimmed.startsWith('[')) {
        records = JSON.parse(trimmed) as WarmResultLike[];
    } else if (trimmed.startsWith('{')) {
        // Could still be pretty-printed JSON with newlines; try whole-file parse first.
        try {
            const parsed = JSON.parse(trimmed) as { results?: WarmResultLike[] };
            records = parsed.results ?? [];
        } catch {
            records = trimmed.split('\n').filter(Boolean).map(l => JSON.parse(l) as WarmResultLike);
        }
    } else {
        records = trimmed.split('\n').filter(Boolean).map(l => JSON.parse(l) as WarmResultLike);
    }
    const out: FunnelRowInput[] = [];
    for (const r of records) {
        const input = warmToInput(r);
        if (input) out.push(input);
    }
    return out;
}

interface EventLogRow {
    rawLine: string;
    normalizedForm: string | null;
    funnelStage: string | null;
    dropReason: string | null;
    confidence: number | null;
    grams: number | null;
    totalKcal: number | null;
    source: string | null;
    foodId: string | null;
    foodName: string | null;
    brandName: string | null;
    servingTier: string | null;
}

/** Minimal read-only surface we need from prisma; kept structural so tests never touch a DB. */
export interface PrismaLike {
    mappingEventLog: { findMany: (args: unknown) => Promise<EventLogRow[]> };
    foodMapping: { findMany: (args: unknown) => Promise<{ normalizedForm: string }[]> };
    $disconnect: () => Promise<void>;
}

export function openPrisma(): PrismaLike {
    // Required lazily so --emit-doc and the unit tests never construct a client.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv/config');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaClient } = require('@prisma/client');
    return new PrismaClient() as PrismaLike;
}

export async function readFromDb(
    prisma: PrismaLike,
    opts: { since?: Date; limit: number },
): Promise<FunnelRowInput[]> {
    const rows = await prisma.mappingEventLog.findMany({
        where: {
            funnelStage: { not: null },
            ...(opts.since ? { createdAt: { gte: opts.since } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: opts.limit,
        select: {
            rawLine: true, normalizedForm: true, funnelStage: true, dropReason: true,
            confidence: true, grams: true, totalKcal: true, source: true, foodId: true,
            foodName: true, brandName: true, servingTier: true,
        },
    });
    return rows.map(r => ({
        rawLine: r.rawLine,
        normalizedForm: r.normalizedForm,
        funnelStage: (r.funnelStage ?? null) as FunnelStage | null,
        dropReason: r.dropReason,
        confidence: r.confidence,
        grams: r.grams,
        totalKcal: r.totalKcal,
        // MappingEventLog stores no per-100g panel: degenerate-macro detection falls
        // back to totalKcal === 0 with grams > 0 (see makeFunnelRow).
        source: r.source,
        foodId: r.foodId,
        foodName: r.foodName,
        brandName: r.brandName,
        servingTier: r.servingTier,
    }));
}

/**
 * Populate hadIncumbent for every row, batched. THE KEY DERIVATION IS LOAD-BEARING:
 * without it "chicken breast" (event log) never finds "breast chicken" (cache), and
 * with canonicalizeCacheKey alone "3 egg whites" never finds "egg white". Read the
 * result as evidence about a CLASS, never as per-row history — see the caveats
 * incumbent-is-measured-now-not-at-event-time and
 * cachekey-is-the-read-key-not-always-the-write-key.
 */
export async function attachIncumbents(prisma: PrismaLike, rows: FunnelRow[], chunkSize = 500): Promise<number> {
    const keys = Array.from(new Set(rows.map(r => r.cacheKey).filter(k => k.length > 0)));
    const present = new Set<string>();
    for (let i = 0; i < keys.length; i += chunkSize) {
        const chunk = keys.slice(i, i + chunkSize);
        const found = await prisma.foodMapping.findMany({
            where: { normalizedForm: { in: chunk } },
            select: { normalizedForm: true },
        });
        for (const f of found) present.add(f.normalizedForm);
    }
    for (const r of rows) r.hadIncumbent = r.cacheKey.length > 0 ? present.has(r.cacheKey) : null;
    return keys.length;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface ClassReport {
    classId: string;
    title: string;
    stage: string;
    fixKind: string;
    status: string;
    residual: boolean;
    events: number;
    distinctKeys: number;
    withIncumbent: number;
    withoutIncumbent: number;
    incumbentUnknown: number;
    /** Raw dropReasons seen under this class — the promotion signal for residuals. */
    dropReasons: { dropReason: string; events: number }[];
    examples: { rawLine: string; cacheKey: string; foodName: string | null; brandName: string | null; grams: number | null; totalKcal: number | null; confidence: number | null; dropReason: string | null }[];
}

/**
 * What THIS input shape cannot see. Reported so a zero is never read as a clean
 * bill of health: a detector arm that cannot fire produces the same 0 as a defect
 * class that genuinely has no members.
 */
export interface InputFidelityReport {
    /** Rows carrying a per-100g macro panel. 0 means --from-db (or a panel-less warm file). */
    rowsWithPanel: number;
    /** Detector arms that cannot fire without a panel, straight from the registry. */
    inertDetectors: { classId: string; exemplar: string; why: string }[];
    /** Rows whose derived key needed an identity discriminator or a dup-collapse. */
    discriminatorAdjustedRows: number;
    /** Rows naming white/yolk/cooked/whole — where the key hinges on reproducing the parse. */
    discriminatorTokenRows: number;
    /** A few of those rows, key included, so the reader can spot-check the join. */
    discriminatorExamples: { rawLine: string; cacheKey: string; canonicalOnly: string }[];
    /** Printed verbatim; every entry is a limit of the run, not a finding. */
    warnings: string[];
}

export interface ClassifyReport {
    at: string;
    inputLabel: string;
    rowCount: number;
    stageCounts: Record<string, number>;
    /** Limits of this input shape — panel-less rows, inert detectors, key-fidelity exposure. */
    inputFidelity: InputFidelityReport;
    /** Rows matching a class whose fixKind is not 'healthy' and which is not residual. */
    defectEvents: number;
    healthyEvents: number;
    residualEvents: number;
    unclassifiedEvents: number;
    unclassifiedRate: number;
    defects: ClassReport[];
    healthy: ClassReport[];
    frontier: ClassReport[];
    unclassified: ClassReport | null;
    /** Live-dropReason coverage audit: any of the 19 measured classes with no owner. */
    uncoveredLiveDropReasons: string[];
}

function emptyClassReport(cls: FailureClass | null, classId: string): ClassReport {
    return {
        classId,
        title: cls?.title ?? 'UNCLASSIFIED — a shape the registry has never seen',
        stage: cls ? classStages(cls).join('|') : '-',
        fixKind: cls?.fixKind ?? 'unknown',
        status: cls?.status ?? 'open',
        residual: cls?.residual ?? false,
        events: 0,
        distinctKeys: 0,
        withIncumbent: 0,
        withoutIncumbent: 0,
        incumbentUnknown: 0,
        dropReasons: [],
        examples: [],
    };
}

/**
 * Measure what this batch of rows cannot show, before any class is counted.
 *
 * Two independent blind spots, both silent before 2026-07-25:
 *   1. NO MACRO PANEL. MappingEventLog stores grams + totalKcal and no per-100g
 *      macros, so Atwater-based arms are dark. corrupt-panel-served's n-mq-27 lemon
 *      (383 kcal/100g, physically possible, only Atwater catches it) then classifies
 *      as cache-hit-healthy — a corrupt panel a user was billed from, counted as
 *      clean. The impossible-kcal arm still works (effectiveKcalPer100g inverts
 *      grams+totalKcal exactly), so this is a partial loss, and it is enumerated
 *      from the registry rather than described in prose.
 *   2. KEY FIDELITY. row.cacheKey is deriveMappingCacheKey minus the brand-prefix
 *      step. Rows naming white/yolk/cooked/whole are the ones whose key depends on
 *      reproducing the pipeline's parse, so they are the likeliest false cold reads.
 */
export function measureInputFidelity(rows: FunnelRow[]): InputFidelityReport {
    const rowsWithPanel = rows.filter(r => r.kcalPer100g != null).length;
    const fid = rows.map(r => ({ row: r, f: keyFidelityOf(r) }));
    const adjusted = fid.filter(x => x.f.discriminatorApplied);
    const tokenRows = fid.filter(x => x.f.carriesDiscriminatorToken);
    const inertDetectors = fromDbBlindSpots().map(s => ({ classId: s.classId, exemplar: s.exemplar, why: s.why }));

    const warnings: string[] = [];
    if (rows.length > 0 && rowsWithPanel === 0) {
        warnings.push(`NO PER-100g MACRO PANEL on any of ${rows.length} row(s) — this is the --from-db shape `
            + '(MappingEventLog stores grams + totalKcal only). kcal/100g is inverted exactly from grams and '
            + 'totalKcal, so the impossible-kcal arm still fires, but every ATWATER-based arm is DARK here. '
            + `${inertDetectors.length} declared blind spot(s) below: a 0 in those classes is NOT evidence of `
            + 'absence. Re-run against a warm JSONL (which carries per100g) to close them.');
        for (const s of inertDetectors) {
            warnings.push(`  inert here: ${s.classId} on "${s.exemplar}" — ${s.why}`);
        }
    } else if (rows.length > 0 && rowsWithPanel < rows.length) {
        warnings.push(`${rows.length - rowsWithPanel} of ${rows.length} row(s) carry no per-100g panel; `
            + 'Atwater-based detector arms cannot fire on those. See inputFidelity.inertDetectors.');
    }
    if (tokenRows.length > 0 || adjusted.length > 0) {
        warnings.push(`KEY FIDELITY: ${adjusted.length} row(s) needed an identity discriminator or a dup-collapse `
            + `to reach the real FoodMapping key, and ${tokenRows.length} row(s) name white/yolk/cooked/whole. `
            + 'Those keys are reproduced from parseIngredientLine(rawLine); where the pipeline saw a different '
            + 'parse (a DB-backed synonym substitution) or prefixed a decisively-named brand, hadIncumbent for '
            + 'these rows can read false wrongly. Check them before concluding a key was cold.');
    }

    return {
        rowsWithPanel,
        inertDetectors,
        discriminatorAdjustedRows: adjusted.length,
        discriminatorTokenRows: tokenRows.length,
        discriminatorExamples: adjusted.slice(0, 5).map(x => ({
            rawLine: x.row.rawLine, cacheKey: x.row.cacheKey, canonicalOnly: x.f.canonicalOnly,
        })),
        warnings,
    };
}

export function aggregate(rows: FunnelRow[], opts: { inputLabel: string; examplesPerClass?: number }): ClassifyReport {
    const perClass = new Map<string, ClassReport>();
    const perClassKeys = new Map<string, Set<string>>();
    const perClassReasons = new Map<string, Map<string, number>>();
    const stageCounts: Record<string, number> = {};
    const maxExamples = opts.examplesPerClass ?? 5;

    for (const row of rows) {
        const stageKey = row.funnelStage ?? 'null';
        stageCounts[stageKey] = (stageCounts[stageKey] ?? 0) + 1;

        const { classId, cls } = classifyRow(row);
        let report = perClass.get(classId);
        if (!report) {
            report = emptyClassReport(cls, classId);
            perClass.set(classId, report);
            perClassKeys.set(classId, new Set());
            perClassReasons.set(classId, new Map());
        }
        report.events++;
        perClassKeys.get(classId)!.add(row.cacheKey || row.rawLine.toLowerCase());
        if (row.hadIncumbent === true) report.withIncumbent++;
        else if (row.hadIncumbent === false) report.withoutIncumbent++;
        else report.incumbentUnknown++;

        const reasonKey = row.dropReason ?? `${stageKey}:<none>`;
        const reasons = perClassReasons.get(classId)!;
        reasons.set(reasonKey, (reasons.get(reasonKey) ?? 0) + 1);

        if (report.examples.length < maxExamples) {
            report.examples.push({
                rawLine: row.rawLine,
                cacheKey: row.cacheKey,
                foodName: row.foodName,
                brandName: row.brandName,
                grams: row.grams,
                totalKcal: row.totalKcal,
                confidence: row.confidence,
                dropReason: row.dropReason,
            });
        }
    }

    for (const [classId, report] of perClass) {
        report.distinctKeys = perClassKeys.get(classId)!.size;
        report.dropReasons = Array.from(perClassReasons.get(classId)!.entries())
            .map(([dropReason, events]) => ({ dropReason, events }))
            .sort((a, b) => b.events - a.events);
    }

    // RANK: distinct keys first, events only as a tiebreak. See the header comment.
    const byRank = (a: ClassReport, b: ClassReport) =>
        b.distinctKeys - a.distinctKeys || b.events - a.events || a.classId.localeCompare(b.classId);

    const all = Array.from(perClass.values());
    const unclassified = all.find(r => r.classId === UNCLASSIFIED) ?? null;
    const defects = all.filter(r => r.classId !== UNCLASSIFIED && r.fixKind !== 'healthy' && !r.residual).sort(byRank);
    const healthy = all.filter(r => r.fixKind === 'healthy').sort(byRank);
    const frontier = all.filter(r => r.classId !== UNCLASSIFIED && r.residual).sort(byRank);

    const sum = (list: ClassReport[]) => list.reduce((n, r) => n + r.events, 0);
    const unclassifiedEvents = unclassified?.events ?? 0;

    // Coverage audit against the 19 measured live dropReasons.
    const uncoveredLiveDropReasons: string[] = [];
    for (const live of LIVE_DROP_REASONS) {
        const probe = makeFunnelRow({
            rawLine: probeLineFor(live),
            funnelStage: live.stage,
            dropReason: live.dropReason,
        });
        if (classifyRow(probe).cls == null) uncoveredLiveDropReasons.push(live.dropReason);
    }

    return {
        at: new Date().toISOString(),
        inputLabel: opts.inputLabel,
        rowCount: rows.length,
        stageCounts,
        inputFidelity: measureInputFidelity(rows),
        defectEvents: sum(defects),
        healthyEvents: sum(healthy),
        residualEvents: sum(frontier),
        unclassifiedEvents,
        unclassifiedRate: rows.length > 0 ? unclassifiedEvents / rows.length : 0,
        defects,
        healthy,
        frontier,
        unclassified,
        uncoveredLiveDropReasons,
    };
}

// ---------------------------------------------------------------------------
// Console rendering
// ---------------------------------------------------------------------------

function pad(s: string, n: number): string {
    return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}
function lpad(s: string | number, n: number): string {
    const t = String(s);
    return t.length >= n ? t : ' '.repeat(n - t.length) + t;
}

function printTable(title: string, list: ClassReport[]): void {
    console.log(`\n${title}`);
    if (list.length === 0) {
        console.log('  (none)');
        return;
    }
    console.log(`  ${pad('class', 38)} ${lpad('keys', 5)} ${lpad('events', 7)} ${lpad('inc', 5)} ${lpad('cold', 5)} ${pad('fix', 9)} status`);
    for (const r of list) {
        console.log(`  ${pad(r.classId, 38)} ${lpad(r.distinctKeys, 5)} ${lpad(r.events, 7)} ${lpad(r.withIncumbent, 5)} ${lpad(r.withoutIncumbent, 5)} ${pad(r.fixKind, 9)} ${r.status}`);
    }
}

function printReport(report: ClassifyReport): void {
    console.log(`\nF2 drop classification — ${report.inputLabel}`);
    console.log(`rows=${report.rowCount}  stages=${JSON.stringify(report.stageCounts)}`);
    console.log(`defect events=${report.defectEvents}  healthy=${report.healthyEvents}  `
        + `frontier(residual)=${report.residualEvents}  unclassified=${report.unclassifiedEvents} `
        + `(${(report.unclassifiedRate * 100).toFixed(2)}%)`);

    if (report.inputFidelity.warnings.length > 0) {
        console.log('\n!! WHAT THIS INPUT CANNOT SHOW (a 0 below is not proof of absence):');
        for (const w of report.inputFidelity.warnings) console.log(`  ${w}`);
        for (const e of report.inputFidelity.discriminatorExamples) {
            console.log(`     key e.g. "${e.rawLine}" -> "${e.cacheKey}" (canonicalize-only would read "${e.canonicalOnly}")`);
        }
    }

    printTable('DEFECTS (ranked by DISTINCT KEYS, not events)', report.defects);
    printTable('HEALTHY / BY DESIGN (counted so they stop looking like defects)', report.healthy);
    printTable('FRONTIER — residual buckets (promote recurring shapes to their own class)', report.frontier);

    for (const r of report.frontier) {
        if (r.dropReasons.length === 0) continue;
        console.log(`\n  ${r.classId} raw dropReasons:`);
        for (const d of r.dropReasons.slice(0, 12)) console.log(`    ${lpad(d.events, 6)}  ${d.dropReason}`);
        for (const e of r.examples.slice(0, 5)) {
            console.log(`      e.g. "${e.rawLine}" -> ${e.foodName ?? '(none)'}`
                + `${e.brandName ? ` [${e.brandName}]` : ''} ${e.grams ?? '?'}g conf=${e.confidence ?? '?'}`);
        }
    }

    if (report.unclassified) {
        console.log(`\nUNCLASSIFIED (${report.unclassified.events} events, ${report.unclassified.distinctKeys} keys) — the true frontier:`);
        for (const d of report.unclassified.dropReasons.slice(0, 20)) console.log(`  ${lpad(d.events, 6)}  ${d.dropReason}`);
        for (const e of report.unclassified.examples) {
            console.log(`    e.g. "${e.rawLine}" (key "${e.cacheKey}") -> ${e.foodName ?? '(none)'} ${e.grams ?? '?'}g`);
        }
    } else {
        console.log('\nUNCLASSIFIED: none.');
    }

    if (report.uncoveredLiveDropReasons.length > 0) {
        console.log('\n!! LIVE DROPREASONS WITH NO OWNING CLASS:');
        for (const d of report.uncoveredLiveDropReasons) console.log(`  ${d}`);
    } else {
        console.log(`\nLive-dropReason coverage: all ${LIVE_DROP_REASONS.length} measured classes owned.`);
    }
}

// ---------------------------------------------------------------------------
// Doc generator (sync-docs/failure-classes.md)
// ---------------------------------------------------------------------------

export function renderDoc(): string {
    const L: string[] = [];
    const byFixKind = new Map<string, FailureClass[]>();
    for (const c of FAILURE_CLASSES) {
        const list = byFixKind.get(c.fixKind) ?? [];
        list.push(c);
        byFixKind.set(c.fixKind, list);
    }

    L.push('# Mapping failure classes (F2)');
    L.push('');
    L.push('> GENERATED FILE — do not hand-edit.');
    L.push('> Source of truth: `scripts/eval/failure-classes.ts` in the **backend** repo (`Recipe-App`).');
    L.push('> Regenerate with `scripts/eval/classify-drops.ts --emit-doc <path-to-this-file>`.');
    L.push('');
    L.push('F1 (PR #139) answered *where* lines die. F2 answers *what is broken and who fixes it*: each class');
    L.push('carries a `fixKind` that routes it (`pipeline` / `data` / `ingest` / `healthy`), a detector that is');
    L.push('unit-tested against its own exemplars, and golden-case pins so a fix cannot silently regress.');
    L.push('');
    L.push('## Why the raw funnel histogram is not a work queue');
    L.push('');
    L.push('`save_rejected:cross_source_margin` is 404 of 571 `save_rejected` events on the live box (71%) and every');
    L.push('one is **incumbent protection** — correct behaviour. The gate is nested inside');
    L.push('`if (newTargetKey && existingTargetKey && newTargetKey !== existingTargetKey)`');
    L.push('(`validated-mapping-helpers.ts:724`), so on a cold key `existing` is null and the block never runs: it');
    L.push('**cannot** fire without an incumbent. Ranking classes by raw count would aim the first and largest');
    L.push('fix-agent at working code. Hence `fixKind: healthy`, hence the report ranks by **distinct keys** and');
    L.push('splits every count by whether an incumbent existed.');
    L.push('');
    L.push('Three more facts the registry is built around:');
    L.push('');
    L.push('- **You cannot join event rows to cache rows on `normalizedForm`.** `MappingEventLog.normalizedForm` is');
    L.push('  pre-canonicalization; `FoodMapping.normalizedForm` is canonicalized, singularized and token-sorted.');
    L.push('  `"chicken breast"` -> `"breast chicken"`, `"eggs"` -> `"egg"`, `"pretzels"` -> `"pretzel"`. Always derive');
    L.push('  the key with `deriveFunnelCacheKey` — `canonicalizeCacheKey` is necessary but NOT sufficient, because');
    L.push('  it alone still misses the identity discriminators ("3 egg whites" never finds "egg white").');
    L.push("- **`under_gate`'s dropReason is not diagnostic.** It carries the confidence gate's `selectionReason` —");
    L.push('  which path *selected* the pick, not why confidence was low — and `simple_rerank` / `close_match` /');
    L.push('  `clear_winner` each split ~50/50 good-vs-bad. Classes under `under_gate` are separated by row');
    L.push('  heuristics instead.');
    L.push('- **The funnel measures conversion, not correctness.** 38 rows with all-zero macros counted as `saved`.');
    L.push('  So every row also carries a quality block (degenerate macros, flat-100g serving, `ai_estimated`');
    L.push('  source, brand disagreement, uncovered query tokens) and the first classes in the registry fire on');
    L.push('  *successful* stages.');
    L.push('');

    L.push('## Class index');
    L.push('');
    L.push('Precedence order — `classifyRow` returns the first match.');
    L.push('');
    L.push('| # | class | stages | fixKind | status | golden pins | fix PRs |');
    L.push('| - | ----- | ------ | ------- | ------ | ----------- | ------- |');
    FAILURE_CLASSES.forEach((c, i) => {
        L.push(`| ${i + 1} | \`${c.id}\`${c.residual ? ' *(residual)*' : ''} | ${classStages(c).join(', ')} `
            + `| **${c.fixKind}** | ${c.status} | ${c.goldenCaseIds.length ? c.goldenCaseIds.join(', ') : '—'} `
            + `| ${c.fixPRs.length ? c.fixPRs.map(n => `#${n}`).join(', ') : '—'} |`);
    });
    L.push('');
    L.push('Counts by fixKind: '
        + (['pipeline', 'data', 'ingest', 'healthy'] as const)
            .map(k => `**${k}** ${byFixKind.get(k)?.length ?? 0}`).join(' · ')
        + ` · total ${FAILURE_CLASSES.length}`);
    L.push('');

    L.push('## Live-dropReason coverage');
    L.push('');
    L.push('The 19 `dropReason` classes actually observed on the live box (2026-07-25, 13,452 `MappingEventLog`');
    L.push('rows carrying `funnelStage`). Every one must resolve to a class, so the unclassified rate on live data');
    L.push('starts near zero and only NEW shapes show up as frontier.');
    L.push('');
    L.push('| dropReason | events | distinct forms | owning class | fixKind |');
    L.push('| ---------- | -----: | -------------: | ------------ | ------- |');
    for (const live of LIVE_DROP_REASONS) {
        const probe = makeFunnelRow({ rawLine: probeLineFor(live), funnelStage: live.stage, dropReason: live.dropReason });
        const { classId, cls } = classifyRow(probe);
        L.push(`| \`${live.dropReason}\` | ${live.events} | ${live.distinctForms} | \`${classId}\` | ${cls?.fixKind ?? '—'} |`);
    }
    L.push('');
    L.push('Stage histogram from the same read: '
        + Object.entries(LIVE_STAGE_COUNTS).map(([k, v]) => `\`${k}\` ${v}`).join(' · ') + '.');
    L.push('');

    L.push('## Classes');
    L.push('');
    for (const c of FAILURE_CLASSES) {
        L.push(`### \`${c.id}\``);
        L.push('');
        L.push(`**${c.title}**`);
        L.push('');
        L.push(`- stages: ${classStages(c).map(s => `\`${s}\``).join(', ')}`);
        L.push(`- fixKind: **${c.fixKind}**${c.fixKind === 'ingest' ? ' — route to the ingest queue, NEVER a fix-agent' : ''}`);
        L.push(`- status: ${c.status}${c.residual ? ' · **residual bucket** (hits are frontier, not a diagnosis)' : ''}`);
        L.push(`- discovered: ${c.discoveredAt}`);
        if (c.dropClasses?.length) L.push(`- owns dropReason classes: ${c.dropClasses.map(d => `\`${d}\``).join(', ')}`);
        for (const spot of c.fromDbBlind ?? []) {
            L.push(`- **\`--from-db\` blind spot** on \`${spot.exemplar}\`: ${spot.why}`);
        }
        if (c.goldenCaseIds.length) L.push(`- golden pins: ${c.goldenCaseIds.join(', ')}`);
        if (c.fixPRs.length) L.push(`- fix PRs: ${c.fixPRs.map(n => `#${n}`).join(', ')}`);
        L.push('');
        L.push(c.description);
        L.push('');
        L.push('Exemplars: ' + c.exemplars.map(e => `\`${e}\``).join(', '));
        L.push('');
    }

    L.push('## Caveats that are facts, not classes');
    L.push('');
    L.push('Nothing can detect these from a row, but every consumer of the funnel needs them before drawing a');
    L.push('conclusion. All verified in code.');
    L.push('');
    for (const c of FUNNEL_CAVEATS) {
        L.push(`- **\`${c.id}\`** — ${c.note}`);
    }
    L.push('');
    return L.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const has = (flag: string) => args.includes(flag);
    const val = (flag: string): string | undefined => {
        const i = args.indexOf(flag);
        return i >= 0 ? args[i + 1] : undefined;
    };

    const docPath = val('--emit-doc');
    if (docPath) {
        const abs = path.isAbsolute(docPath) ? docPath : path.resolve(process.cwd(), docPath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, renderDoc());
        console.log(`Wrote ${FAILURE_CLASSES.length} classes to ${abs}`);
        if (!has('--in') && !has('--from-db')) return;
    }

    const inFile = val('--in');
    const fromDb = has('--from-db');
    if (!inFile && !fromDb) {
        console.error('Usage: classify-drops.ts (--in <warm.json|.jsonl> | --from-db [--since <date>] [--limit N]) '
            + '[--no-incumbent] [--json <path>] [--emit-doc <path>] [--examples N]');
        process.exitCode = 1;
        return;
    }

    const wantIncumbent = !has('--no-incumbent');
    let prisma: PrismaLike | null = null;
    let inputs: FunnelRowInput[];
    let label: string;

    if (fromDb) {
        const sinceRaw = val('--since');
        const since = sinceRaw ? new Date(sinceRaw) : undefined;
        if (since && Number.isNaN(since.getTime())) throw new Error(`--since is not a date: ${sinceRaw}`);
        const limit = Number(val('--limit') ?? 20000);
        prisma = openPrisma();
        inputs = await readFromDb(prisma, { since, limit });
        label = `MappingEventLog (READ ONLY)${sinceRaw ? ` since ${sinceRaw}` : ''} limit ${limit}`;
    } else {
        inputs = readInputFile(inFile!);
        label = path.relative(process.cwd(), inFile!);
    }

    const rows = inputs.map(makeFunnelRow);

    if (rows.length === 0) {
        // Fail closed (playbook §11 class B): a funnel report over zero rows
        // reads as "no drops", which is the opposite of what an empty input
        // means (a failed warm, a bad --since, the wrong file).
        console.error(`FAIL: ${label} yielded ZERO rows — a report over nothing must not read as "no drops"; exit 2.`);
        process.exitCode = 2;
        if (prisma) await prisma.$disconnect();
        return;
    }

    if (wantIncumbent) {
        try {
            prisma = prisma ?? openPrisma();
            const keys = await attachIncumbents(prisma, rows);
            console.log(`Resolved hadIncumbent for ${keys} canonical cache keys.`);
        } catch (err) {
            console.warn(`hadIncumbent lookup skipped (${(err as Error).message}); counts will show as unknown.`);
        }
    }

    const report = aggregate(rows, { inputLabel: label, examplesPerClass: Number(val('--examples') ?? 5) });
    printReport(report);

    const jsonPath = val('--json');
    if (jsonPath) {
        const abs = path.isAbsolute(jsonPath) ? jsonPath : path.resolve(process.cwd(), jsonPath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, JSON.stringify(report, null, 1));
        console.log(`\nStructured result written to ${abs}`);
    }

    if (prisma) await prisma.$disconnect();
}

if (require.main === module) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
