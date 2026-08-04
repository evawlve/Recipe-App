/**
 * _consensus_generic_probe.ts — SIZING MEASUREMENT for Phase 2 item #4.
 *
 * QUESTION. `RANK_BRAND_CONSENSUS` (the macro-consensus outlier demotion in
 * `simpleRerank()`) was calibrated on tight BRANDED sibling groups. PR #236
 * ungated it from `targetBrand` and was refuted; the finding was that the brand
 * gate was never the binding constraint — CONSENSUS_AGREE_TOLERANCE is. The
 * plan says reviving #4 needs the two constants re-derived against GENERIC
 * pools. This probe re-derives them, read-only, from frozen winner-diff
 * snapshots. It proposes nothing and changes nothing.
 *
 * STRICTLY READ-ONLY. No DB, no network, no LLM, no writes. It reads JSON
 * snapshot files and three leaf-safe modules.
 *
 * WHAT IS IMPORTED, AND WHY ONLY THESE THREE
 * ------------------------------------------
 *   normalizeNameKey        src/lib/search/dedupe-candidates.ts  (imports one TYPE only)
 *   filterCandidatesByTokens src/lib/mapping/filter-candidates.ts (imports a type + logger)
 *   buildRerankPool          src/lib/mapping/rerank-pool.ts       (imports NOTHING, by design)
 *
 * `simple-rerank.ts` is deliberately NOT imported even though the pass lives
 * there: it pulls `modifier-constraints` -> `gather-candidates`, which drags in
 * prisma, Typesense and the ONNX embedding warm-up (playbook section 4). The
 * consequence is recorded under DEVIATIONS below rather than hidden.
 *
 * THE PREDICATE UNDER TEST, transcribed from simple-rerank.ts `simpleRerank()`:
 *
 *     const agreeing = values.filter(v => Math.abs(v - med) / med <= CONSENSUS_AGREE_TOLERANCE);
 *     if (agreeing.length < 2 || agreeing.length * 2 <= values.length) return new Set();
 *
 * i.e. STRICT majority (`agreeing > n/2`), never fewer than two, and the
 * candidate under test IS a member of its own `values` array — it counts
 * toward both the median and the agreeing tally.
 *
 * GROUPING. Two modes, both reported, because the code has two answers:
 *   A  QUERY-KEYED  — exactly what PR #236 (d9dd8e5) did on the generic branch:
 *      siblings are the pool members whose normalizeNameKey(name) equals
 *      normalizeNameKey(rerankQuery). ONE group per query, and the only groups
 *      the shipped shape of the pass could ever act on.
 *   B  ALL NAME-KEY GROUPS — every normalizeNameKey group of size >= 3 inside a
 *      pool, whether or not it matches the query. A superset of A. It measures
 *      the DISPERSION of generic sibling groups, which is the statistical
 *      question behind re-deriving the constant, on a much larger n.
 *
 * STAGES. The pass runs on the rerank WINDOW, not the gather pool:
 *   gather -> filterCandidatesByTokens -> 3b..3e -> buildRerankPool(filtered, 10)
 * so two stages are reported:
 *   G  gather pool, as frozen in the snapshot. An UPPER BOUND on sibling count:
 *      every later stage is a subset. If the tuning fails here it fails everywhere.
 *   W  buildRerankPool(filterCandidatesByTokens(...).filtered, 10). An
 *      APPROXIMATION of the real window — see DEVIATIONS.
 *
 * THE RE-DERIVATION ITSELF. For a group of n values with median `med`, define
 *     Trequired = the k-th smallest |v - med| / med, k = floor(n/2) + 1
 * Majority holds at tolerance T iff T >= Trequired (and n >= 3, which forces
 * k >= 2 so the `agreeing >= 2` clause is implied). The percentile distribution
 * of Trequired over the generic population IS the re-derived constant. Nothing
 * else in this file is a proposal; that number is a measurement.
 *
 * OVER-PERMISSIVENESS. Raising T alone is meaningless — every group agrees
 * eventually. So the outlier side is held at the REAL constants
 * (CONSENSUS_KCAL_OUTLIER_DEV = 0.30, CONSENSUS_PROTEIN_OUTLIER_DEV = 0.20) and
 * two things are reported per T: the share of members actually flagged, and the
 * INCOHERENCE count — groups holding a member that is simultaneously "agreeing"
 * (within T) and "an outlier" (beyond dev). That is impossible while T <= dev
 * and unavoidable above it, which is what makes T > 0.30 not a tuning choice.
 *
 * DEVIATIONS FROM THE LIVE CALLER — all of them, all directional:
 *   D1  `rerankQuery` is `aiCanonicalBase || stripPrepModifiers(parsed?.name ||
 *       normalizedName)`. `stripPrepModifiers` lives in simple-rerank and cannot
 *       be imported (see above), so this probe uses the un-stripped form. It can
 *       only leave MORE tokens in the key, and normalizeNameKey is a token SET,
 *       so mode A here UNDER-counts siblings. Direction: conservative.
 *   D2  Stage W applies only caller step 3 (`filterCandidatesByTokens`). Steps
 *       3b-3e (core-token mismatch, zero-macro, plausibility, denylist) need
 *       `map-ingredient-with-fallback`, which pulls prisma. Those steps only
 *       REMOVE candidates, so stage W's input is a SUPERSET of the real
 *       `filtered` and its window composition can differ. Stage W is an
 *       approximation and is labelled as one everywhere it is printed.
 *   D3  `toRerankCandidate()` collapses doubled FDC descriptions. normalizeNameKey
 *       is a token SET, so a doubled name and its collapsed form produce the
 *       IDENTICAL key. Not a deviation; verified by reading the function.
 *   D4  The snapshot is a frozen gather; per the winner-diff header it cannot see
 *       retrieval changes. Every number here is conditioned on that pool.
 *
 * USAGE
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/eval/_consensus_generic_probe.ts \
 *     --snapshot <path> [--snapshot <path> ...] [--dump-groups N]
 */

import * as fs from 'fs';
import { normalizeNameKey } from '../../src/lib/search/dedupe-candidates';
import { filterCandidatesByTokens } from '../../src/lib/mapping/filter-candidates';
import { buildRerankPool, RERANK_POOL_LIMIT } from '../../src/lib/mapping/rerank-pool';

// ============================================================
// The live constants, transcribed from src/lib/mapping/simple-rerank.ts.
// Kept as named consts so the sweep's relationship to them is explicit.
// ============================================================
const LIVE_AGREE_TOLERANCE = 0.15;
const LIVE_KCAL_OUTLIER_DEV = 0.30;
const LIVE_PROTEIN_OUTLIER_DEV = 0.20;
const LIVE_MIN_KCAL_MEDIAN = 50;
const LIVE_MIN_PROTEIN_MEDIAN = 8;
const LIVE_MIN_SIBLINGS = 3;

const T_SWEEP = [0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50];

// ============================================================
// Snapshot shapes (structural — the file is winner-diff/snapshot v1)
// ============================================================
interface SnapNutrition {
    kcal: number; protein: number; carbs: number; fat: number; per100g: boolean;
}
interface SnapCandidate {
    id: string;
    source: string;
    name: string;
    brandName?: string | null;
    score: number;
    foodType?: string | null;
    nutrition?: SnapNutrition | null;
    semanticSimilarity?: number | null;
}
interface SnapEntry {
    query: string;
    ok: boolean;
    trimmed: string;
    parsed: { name?: string } | null;
    normalizedName: string;
    isBrandedQuery: boolean;
    targetBrand?: string;
    aiCanonicalBase?: string;
    candidates: SnapCandidate[];
}
interface SnapFile {
    kind: string; takenAt: string; gitHead: string; population: string; entries: SnapEntry[];
}

// ============================================================
// Stats
// ============================================================
function median(vals: number[]): number {
    const s = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function pct(sorted: number[], p: number): number {
    if (sorted.length === 0) return NaN;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return sorted[i];
}
function fmtPct(n: number, d: number): string {
    return d === 0 ? '  n/a' : `${((n / d) * 100).toFixed(1)}%`;
}

/** Relative deviations from the median, in the group's member order. */
function relDevs(values: number[], med: number): number[] {
    return values.map(v => Math.abs(v - med) / med);
}

/**
 * The smallest tolerance at which `agreeing * 2 > n` holds: the k-th smallest
 * relative deviation with k = floor(n/2) + 1. For n >= 3, k >= 2, so the
 * `agreeing.length < 2` clause is implied and needs no separate term.
 */
function requiredTolerance(devs: number[]): number {
    const s = [...devs].sort((a, b) => a - b);
    const k = Math.floor(s.length / 2) + 1;
    return s[k - 1];
}

/** The live majority predicate, transcribed verbatim in meaning. */
function majorityHolds(devs: number[], tol: number): boolean {
    const agreeing = devs.filter(d => d <= tol).length;
    return !(agreeing < 2 || agreeing * 2 <= devs.length);
}

// ============================================================
// Group model
// ============================================================
interface Group {
    /** snapshot label + query it came from, for dumping */
    snap: string;
    query: string;
    nameKey: string;
    stage: 'G' | 'W';
    mode: 'A' | 'B';
    n: number;
    kcal: number[];
    protein: number[];
    brandedCount: number;
    sourceMix: Record<string, number>;
    /** per-member, in the same order as `kcal`/`protein` — indexes line up with the dev array */
    memberSources: string[];
    memberBranded: boolean[];
    memberScores: number[];
    /** true when the snapshot recorded a targetBrand for the query this group came
     *  from — i.e. the population the live constants were calibrated on. */
    queryBranded: boolean;
    /** stable identity for de-duplicating the same record set seen by two queries */
    ident: string;
    names: string[];
    ids: string[];
}

function nutritionBearing(c: SnapCandidate): boolean {
    // Transcribed from the sibling filter: per100g === true && kcal > 0.
    return c.nutrition?.per100g === true && c.nutrition.kcal > 0;
}

function makeGroup(
    snap: string, query: string, nameKey: string, stage: 'G' | 'W', mode: 'A' | 'B',
    members: SnapCandidate[], queryBranded: boolean,
): Group {
    const ids = members.map(m => m.id);
    const sourceMix: Record<string, number> = {};
    for (const m of members) sourceMix[m.source] = (sourceMix[m.source] ?? 0) + 1;
    return {
        snap, query, nameKey, stage, mode,
        n: members.length,
        kcal: members.map(m => m.nutrition!.kcal),
        protein: members.map(m => m.nutrition!.protein ?? 0),
        brandedCount: members.filter(m => (m.brandName ?? '').trim().length > 0).length,
        sourceMix,
        memberSources: members.map(m => m.source),
        memberBranded: members.map(m => (m.brandName ?? '').trim().length > 0),
        memberScores: members.map(m => m.score ?? 0),
        queryBranded,
        ident: `${nameKey}|${[...ids].sort().join(',')}`,
        names: members.map(m => m.name),
        ids,
    };
}

/** A group is branded-dominant when a strict majority of its members carry a brandName. */
function isBrandedDominant(g: Group): boolean {
    return g.brandedCount * 2 > g.n;
}

// ============================================================
// Stage construction
// ============================================================
function stagePool(e: SnapEntry, stage: 'G' | 'W'): SnapCandidate[] {
    if (stage === 'G') return e.candidates;
    // D2: caller step 3 only, then the real window builder.
    // filter-candidates.ts logs `[DEBUG] hasCriticalModifierMismatch:` lines
    // UNCONDITIONALLY (not behind options.debug). Muted here so the report is
    // readable; the module is not touched.
    const realLog = console.log;
    console.log = () => { /* muted */ };
    try {
        const fr = filterCandidatesByTokens(
            e.candidates as never, e.normalizedName, { rawLine: e.trimmed },
        ) as unknown as { filtered: SnapCandidate[] };
        return buildRerankPool(fr.filtered as never, RERANK_POOL_LIMIT) as unknown as SnapCandidate[];
    } finally {
        console.log = realLog;
    }
}

/** D1: the un-stripped rerank query. */
function rerankQueryOf(e: SnapEntry): string {
    return e.aiCanonicalBase || e.parsed?.name || e.normalizedName;
}

function groupsFor(snap: string, entries: SnapEntry[], stage: 'G' | 'W', mode: 'A' | 'B'): Group[] {
    const out: Group[] = [];
    for (const e of entries) {
        if (!e.ok || !e.candidates || e.candidates.length === 0) continue;
        let pool: SnapCandidate[];
        try {
            pool = stagePool(e, stage);
        } catch {
            continue;
        }
        const bearing = pool.filter(nutritionBearing);
        if (bearing.length === 0) continue;

        if (mode === 'A') {
            const qKey = normalizeNameKey(rerankQueryOf(e));
            if (qKey.length === 0) continue;
            const members = bearing.filter(c => normalizeNameKey(c.name) === qKey);
            if (members.length >= LIVE_MIN_SIBLINGS) {
                out.push(makeGroup(snap, e.query, qKey, stage, mode, members, !!e.targetBrand));
            }
        } else {
            const by = new Map<string, SnapCandidate[]>();
            for (const c of bearing) {
                const k = normalizeNameKey(c.name);
                if (k.length === 0) continue;
                const arr = by.get(k);
                if (arr) arr.push(c); else by.set(k, [c]);
            }
            for (const [k, members] of by) {
                if (members.length >= LIVE_MIN_SIBLINGS) {
                    out.push(makeGroup(snap, e.query, k, stage, mode, members, !!e.targetBrand));
                }
            }
        }
    }
    return out;
}

function dedupeGroups(gs: Group[]): Group[] {
    const seen = new Set<string>();
    const out: Group[] = [];
    for (const g of gs) {
        if (seen.has(g.ident)) continue;
        seen.add(g.ident);
        out.push(g);
    }
    return out;
}

// ============================================================
// The sweep
// ============================================================
interface Axis {
    label: 'kcal' | 'protein';
    values: (g: Group) => number[];
    minMedian: number;
    dev: number;
}
const AXES: Axis[] = [
    { label: 'kcal', values: g => g.kcal, minMedian: LIVE_MIN_KCAL_MEDIAN, dev: LIVE_KCAL_OUTLIER_DEV },
    { label: 'protein', values: g => g.protein, minMedian: LIVE_MIN_PROTEIN_MEDIAN, dev: LIVE_PROTEIN_OUTLIER_DEV },
];

interface SweepRow {
    tol: number;
    eligible: number;     // n >= 3 AND median >= floor
    couldAct: number;     // + majority holds at tol
    doesAct: number;      // + at least one member beyond dev
    flaggedMembers: number;
    actingMembers: number;
    incoherentGroups: number;  // a member both agreeing at tol AND flagged at dev
}

function sweep(groups: Group[], axis: Axis): SweepRow[] {
    const eligible = groups.filter(g => {
        const v = axis.values(g);
        return v.length >= LIVE_MIN_SIBLINGS && median(v) >= axis.minMedian;
    });
    return T_SWEEP.map(tol => {
        let couldAct = 0, doesAct = 0, flaggedMembers = 0, actingMembers = 0, incoherent = 0;
        for (const g of eligible) {
            const v = axis.values(g);
            const med = median(v);
            const devs = relDevs(v, med);
            if (!majorityHolds(devs, tol)) continue;
            couldAct++;
            const flagged = devs.filter(d => d > axis.dev).length;
            if (flagged > 0) {
                doesAct++;
                flaggedMembers += flagged;
                actingMembers += v.length;
            }
            if (devs.some(d => d <= tol && d > axis.dev)) incoherent++;
        }
        return {
            tol, eligible: eligible.length, couldAct, doesAct,
            flaggedMembers, actingMembers, incoherentGroups: incoherent,
        };
    });
}

function printSweep(title: string, groups: Group[], axis: Axis): void {
    const rows = sweep(groups, axis);
    const denom = rows[0]?.eligible ?? 0;
    console.log(`\n  ${title}   axis=${axis.label}  outlierDev=${axis.dev}  medianFloor=${axis.minMedian}`);
    console.log(`  eligible groups (n>=${LIVE_MIN_SIBLINGS} AND median>=${axis.minMedian}): ${denom}`);
    if (denom === 0) { console.log('  (nothing eligible)'); return; }
    console.log('    T      majority   %      acts    %      flagged/members   incoherent');
    for (const r of rows) {
        const live = Math.abs(r.tol - LIVE_AGREE_TOLERANCE) < 1e-9 ? ' <- LIVE' : '';
        const fm = r.actingMembers > 0
            ? `${r.flaggedMembers}/${r.actingMembers} (${((r.flaggedMembers / r.actingMembers) * 100).toFixed(1)}%)`
            : '0/0';
        console.log(
            `    ${r.tol.toFixed(2)}   ${String(r.couldAct).padStart(6)}  ${fmtPct(r.couldAct, r.eligible).padStart(6)}` +
            `  ${String(r.doesAct).padStart(6)} ${fmtPct(r.doesAct, r.eligible).padStart(6)}` +
            `   ${fm.padStart(17)}   ${String(r.incoherentGroups).padStart(6)}${live}`,
        );
    }
}

function printRequiredTolerance(title: string, groups: Group[], axis: Axis): void {
    const eligible = groups.filter(g => {
        const v = axis.values(g);
        return v.length >= LIVE_MIN_SIBLINGS && median(v) >= axis.minMedian;
    });
    if (eligible.length === 0) { console.log(`\n  ${title}: no eligible groups`); return; }
    const req = eligible.map(g => {
        const v = axis.values(g);
        return requiredTolerance(relDevs(v, median(v)));
    }).sort((a, b) => a - b);
    console.log(`\n  ${title}  (Trequired = smallest tolerance at which a strict majority forms)`);
    console.log(`    n=${req.length}   p10=${pct(req, 0.10).toFixed(3)}  p25=${pct(req, 0.25).toFixed(3)}` +
        `  p50=${pct(req, 0.50).toFixed(3)}  p75=${pct(req, 0.75).toFixed(3)}` +
        `  p90=${pct(req, 0.90).toFixed(3)}  max=${req[req.length - 1].toFixed(3)}`);
    const below = req.filter(r => r <= LIVE_AGREE_TOLERANCE).length;
    console.log(`    already satisfied by the LIVE ${LIVE_AGREE_TOLERANCE}: ${below}/${req.length} (${fmtPct(below, req.length)})`);
}

/**
 * WHO the pass would penalise, at a given tolerance.
 *
 * The #236 refutation's stated mechanism was "a FatSecret row is typically a
 * singleton inside an OFF-dominated sibling group, so it reads as the outlier
 * against an OFF-majority median". That is directly measurable here: compare
 * the source composition of FLAGGED members against the source composition of
 * the eligible groups they sit in. This is a COMPOSITION measurement, not a
 * winner measurement — only winner-diff.ts can say what the pick becomes.
 */
function printFlaggedComposition(title: string, groups: Group[], axis: Axis, tol: number): void {
    const eligible = groups.filter(g => {
        const v = axis.values(g);
        return v.length >= LIVE_MIN_SIBLINGS && median(v) >= axis.minMedian;
    });
    const poolMix: Record<string, number> = {};
    const flagMix: Record<string, number> = {};
    let poolBranded = 0, flagBranded = 0, poolN = 0, flagN = 0;
    for (const g of eligible) {
        const v = axis.values(g);
        const med = median(v);
        const devs = relDevs(v, med);
        if (!majorityHolds(devs, tol)) continue;
        for (let i = 0; i < g.n; i++) {
            const src = g.memberSources[i];
            poolMix[src] = (poolMix[src] ?? 0) + 1;
            poolN++;
            if (g.memberBranded[i]) poolBranded++;
            if (devs[i] > axis.dev) {
                flagMix[src] = (flagMix[src] ?? 0) + 1;
                flagN++;
                if (g.memberBranded[i]) flagBranded++;
            }
        }
    }
    if (poolN === 0) { console.log(`\n  ${title}: no acting groups at T=${tol}`); return; }
    const srcs = [...new Set([...Object.keys(poolMix), ...Object.keys(flagMix)])].sort();
    console.log(`\n  ${title}  axis=${axis.label}  T=${tol}  dev=${axis.dev}`);
    console.log(`    members inside majority-forming groups: ${poolN}   flagged as outliers: ${flagN} (${fmtPct(flagN, poolN)})`);
    for (const s of srcs) {
        const p = poolMix[s] ?? 0, f = flagMix[s] ?? 0;
        console.log(`      ${s.padEnd(15)} in-pool ${String(p).padStart(5)} (${fmtPct(p, poolN).padStart(6)})   flagged ${String(f).padStart(4)} (${fmtPct(f, poolN).padStart(6)} of pool)   flag-rate-within-source ${fmtPct(f, p)}`);
    }
    console.log(`      ${'brandName set'.padEnd(15)} in-pool ${String(poolBranded).padStart(5)} (${fmtPct(poolBranded, poolN).padStart(6)})   flagged ${String(flagBranded).padStart(4)} (${fmtPct(flagBranded, poolN).padStart(6)} of pool)   flag-rate-within-branded ${fmtPct(flagBranded, poolBranded)}`);

    // PROXY, clearly labelled: a penalty on a member that was never going to win
    // is inert. The snapshot carries the RETRIEVAL score, not the rerank score
    // (simple-rerank cannot be imported — see the header), so rank-by-retrieval-
    // score within the group is a proxy for "was this the record about to win".
    // It is not a winner measurement; only winner-diff.ts can make that claim.
    const rankHist: number[] = [0, 0, 0, 0];  // rank1, rank2, rank3, rank4+
    let rankedFlags = 0;
    // Direction split. Item #4's population is defined as >=1.6x OR <=0.6x the
    // sibling median, so which side the pass actually fires on is load-bearing.
    const dirHi: Record<string, number> = {}, dirLo: Record<string, number> = {};
    for (const g of eligible) {
        const v = axis.values(g);
        const med = median(v);
        const devs = relDevs(v, med);
        if (!majorityHolds(devs, tol)) continue;
        const order = g.memberScores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
        const rankOf = new Map<number, number>();
        order.forEach((o, r) => rankOf.set(o.i, r + 1));
        for (let i = 0; i < g.n; i++) {
            if (devs[i] <= axis.dev) continue;
            const r = rankOf.get(i)!;
            rankHist[Math.min(r, 4) - 1]++;
            rankedFlags++;
            const src = g.memberSources[i];
            if (v[i] > med) dirHi[src] = (dirHi[src] ?? 0) + 1;
            else dirLo[src] = (dirLo[src] ?? 0) + 1;
        }
    }
    if (rankedFlags > 0) {
        console.log(`    PROXY — flagged member's rank by RETRIEVAL score inside its group:` +
            ` r1 ${rankHist[0]} (${fmtPct(rankHist[0], rankedFlags)})  r2 ${rankHist[1]} (${fmtPct(rankHist[1], rankedFlags)})` +
            `  r3 ${rankHist[2]} (${fmtPct(rankHist[2], rankedFlags)})  r4+ ${rankHist[3]} (${fmtPct(rankHist[3], rankedFlags)})`);
        const hiT = Object.values(dirHi).reduce((a, b) => a + b, 0);
        const loT = Object.values(dirLo).reduce((a, b) => a + b, 0);
        const per = [...new Set([...Object.keys(dirHi), ...Object.keys(dirLo)])].sort()
            .map(k => `${k}=${dirHi[k] ?? 0}hi/${dirLo[k] ?? 0}lo`).join('  ');
        console.log(`    DIRECTION of flagged members: ABOVE median ${hiT} (${fmtPct(hiT, rankedFlags)})  BELOW median ${loT} (${fmtPct(loT, rankedFlags)})   [${per}]`);
    }
}

function printSizes(title: string, groups: Group[]): void {
    if (groups.length === 0) { console.log(`\n  ${title}: 0 groups`); return; }
    const sizes = groups.map(g => g.n).sort((a, b) => a - b);
    const brandedDom = groups.filter(isBrandedDominant).length;
    console.log(`\n  ${title}: ${groups.length} groups   size p50=${pct(sizes, 0.5)} p90=${pct(sizes, 0.9)} max=${sizes[sizes.length - 1]}`);
    console.log(`    branded-dominant ${brandedDom} (${fmtPct(brandedDom, groups.length)})   generic-dominant ${groups.length - brandedDom} (${fmtPct(groups.length - brandedDom, groups.length)})`);
}

function dumpGroups(groups: Group[], limit: number, axis: Axis): void {
    const eligible = groups.filter(g => {
        const v = axis.values(g);
        return v.length >= LIVE_MIN_SIBLINGS && median(v) >= axis.minMedian;
    });
    const withReq = eligible.map(g => {
        const v = axis.values(g);
        const med = median(v);
        return { g, med, req: requiredTolerance(relDevs(v, med)) };
    }).sort((a, b) => b.req - a.req);
    console.log(`\n  --- ${limit} widest-dispersion eligible groups (axis=${axis.label}) ---`);
    for (const { g, med, req } of withReq.slice(0, limit)) {
        const vals = axis.values(g).map(v => Math.round(v * 10) / 10).sort((a, b) => a - b);
        console.log(`   [${g.stage}/${g.mode}] "${g.query}" key="${g.nameKey}" n=${g.n} med=${med.toFixed(1)} Treq=${req.toFixed(3)} branded=${g.brandedCount}/${g.n} ${JSON.stringify(g.sourceMix)}`);
        console.log(`        ${JSON.stringify(vals)}`);
    }
}

// ============================================================
// main
// ============================================================
/**
 * TRIPWIRE. The plan records one worked example of the live predicate failing:
 * `apple`, sibling kcal [19, 23.9, 46.6, 46.6, 49, 52, 57, 61, 71, 398], median
 * 50.5, "exactly 5 of 10 within +/-15%, against a strict-majority guard". If the
 * transcription in this file does not reproduce that exact outcome, every number
 * below is worthless, so it aborts rather than printing.
 */
function selfCheck(): void {
    const apple = [19, 23.9, 46.6, 46.6, 49, 52, 57, 61, 71, 398];
    const med = median(apple);
    const devs = relDevs(apple, med);
    const agreeing = devs.filter(d => d <= LIVE_AGREE_TOLERANCE).length;
    const holds = majorityHolds(devs, LIVE_AGREE_TOLERANCE);
    const req = requiredTolerance(devs);
    const ok = Math.abs(med - 50.5) < 1e-9 && agreeing === 5 && holds === false;
    console.log(`SELF-CHECK (documented \`apple\` case): median=${med} agreeing@0.15=${agreeing}/10 majority=${holds}` +
        `  Trequired=${req.toFixed(3)}  -> ${ok ? 'MATCHES the documented outcome' : 'MISMATCH'}`);
    if (!ok) {
        console.error('FAIL: the transcribed predicate does not reproduce the documented apple failure. Aborting.');
        process.exit(2);
    }
}

function main(): void {
    const argv = process.argv.slice(2);
    const snaps: string[] = [];
    let dump = 0;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--snapshot') { snaps.push(argv[++i]); continue; }
        if (argv[i] === '--dump-groups') { dump = parseInt(argv[++i], 10) || 0; continue; }
        if (argv[i] === '--help' || argv[i] === '-h') {
            console.log('usage: _consensus_generic_probe.ts --snapshot <path> [--snapshot <path>] [--dump-groups N]');
            process.exit(0);
        }
    }
    if (snaps.length === 0) {
        console.error('FAIL: no --snapshot given. This probe is read-only and takes frozen winner-diff snapshots.');
        process.exit(2);
    }

    console.log('='.repeat(100));
    console.log('CONSENSUS TUNING PROBE — read-only sizing for Phase 2 item #4');
    console.log(`LIVE constants: AGREE_TOLERANCE=${LIVE_AGREE_TOLERANCE} KCAL_OUTLIER_DEV=${LIVE_KCAL_OUTLIER_DEV}` +
        ` PROTEIN_OUTLIER_DEV=${LIVE_PROTEIN_OUTLIER_DEV} MIN_KCAL_MEDIAN=${LIVE_MIN_KCAL_MEDIAN}` +
        ` MIN_PROTEIN_MEDIAN=${LIVE_MIN_PROTEIN_MEDIAN} MIN_SIBLINGS=${LIVE_MIN_SIBLINGS}`);
    console.log('Majority predicate: agreeing >= 2 AND agreeing*2 > n  (STRICT; candidate included in its own set)');
    console.log('='.repeat(100));
    selfCheck();

    const loaded: { label: string; file: SnapFile }[] = [];
    for (const p of snaps) {
        const file = JSON.parse(fs.readFileSync(p, 'utf8')) as SnapFile;
        const label = p.split('/').pop() ?? p;
        loaded.push({ label, file });
        const branded = file.entries.filter(e => e.targetBrand).length;
        console.log(`\nSNAPSHOT ${label}`);
        console.log(`  kind=${file.kind} takenAt=${file.takenAt} gitHead=${file.gitHead}`);
        console.log(`  population: ${file.population}`);
        console.log(`  entries=${file.entries.length}  ok=${file.entries.filter(e => e.ok).length}` +
            `  targetBrand set on ${branded}  (the pass runs its BRANDED path on those today)`);
        console.log(`  candidates=${file.entries.reduce((a, e) => a + (e.candidates?.length ?? 0), 0)}`);
    }

    for (const stage of ['G', 'W'] as const) {
        const stageName = stage === 'G'
            ? 'STAGE G — gather pool as frozen (UPPER BOUND: every later stage is a subset)'
            : `STAGE W — buildRerankPool(filterCandidatesByTokens(...), ${RERANK_POOL_LIMIT}) — APPROXIMATION, steps 3b-3e omitted (D2)`;
        console.log(`\n${'#'.repeat(100)}\n${stageName}\n${'#'.repeat(100)}`);

        for (const mode of ['A', 'B'] as const) {
            const modeName = mode === 'A'
                ? 'MODE A — QUERY-KEYED siblings (transcribes PR #236 d9dd8e5; the only groups the pass could act on)'
                : 'MODE B — ALL name-key groups in the pool (dispersion population, superset of A)';
            console.log(`\n${'-'.repeat(100)}\n${modeName}\n${'-'.repeat(100)}`);

            const all: Group[] = [];
            for (const { label, file } of loaded) all.push(...groupsFor(label, file.entries, stage, mode));
            const uniq = dedupeGroups(all);

            printSizes('group instances (one per query occurrence)', all);
            printSizes('distinct groups (deduped by nameKey + member id set)', uniq);

            const brandedDom = uniq.filter(isBrandedDominant);
            const genericDom = uniq.filter(g => !isBrandedDominant(g));

            for (const axis of AXES) {
                printSweep(`ALL distinct groups`, uniq, axis);
                printRequiredTolerance(`ALL distinct groups`, uniq, axis);
                printSweep(`BRANDED-DOMINANT groups (>50% of members carry a brandName)`, brandedDom, axis);
                printRequiredTolerance(`BRANDED-DOMINANT groups`, brandedDom, axis);
                printSweep(`GENERIC-DOMINANT groups (<=50% of members carry a brandName)`, genericDom, axis);
                printRequiredTolerance(`GENERIC-DOMINANT groups`, genericDom, axis);
                // The calibration control: groups from queries where production
                // detected a brand (the branded path runs there TODAY) vs not.
                const fromBrandedQ = uniq.filter(g => g.queryBranded);
                const fromGenericQ = uniq.filter(g => !g.queryBranded);
                if (fromBrandedQ.length > 0) {
                    printSweep(`groups from BRANDED queries (targetBrand set — the calibration population)`, fromBrandedQ, axis);
                    printRequiredTolerance(`groups from BRANDED queries`, fromBrandedQ, axis);
                }
                printSweep(`groups from GENERIC queries (no targetBrand — the item #4 population)`, fromGenericQ, axis);
                printRequiredTolerance(`groups from GENERIC queries`, fromGenericQ, axis);
                printFlaggedComposition(`WHO GETS FLAGGED at the LIVE tolerance`, uniq, axis, LIVE_AGREE_TOLERANCE);
                printFlaggedComposition(`WHO GETS FLAGGED at T=0.30`, uniq, axis, 0.30);
            }

            if (dump > 0 && mode === 'A') dumpGroups(uniq, dump, AXES[0]);
            if (dump > 0 && mode === 'B' && stage === 'G') dumpGroups(uniq, dump, AXES[0]);
        }
    }

    console.log('\nDONE. Read-only: no DB, no network, no writes.');
}

main();
