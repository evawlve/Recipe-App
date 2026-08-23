/**
 * warm-cold-diff.ts — THE UNION INSTRUMENT: replay one population BOTH WAYS.
 * ==========================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * Three instruments measure this pipeline and each of them sees exactly one side
 * of it:
 *
 *   flywheel-sweep.ts:405-411   runs the golden eval WARM (no --nocache). It is
 *                               the nightly. It measures the CACHE.
 *   run-eval.ts --nocache       runs the golden eval COLD. It is the session gate.
 *                               It measures the PIPELINE.
 *   winner-diff.ts              replays a FROZEN snapshot with `skipCache: true`
 *                               forced (its own blind spot (C)). Cold, always.
 *
 * Nothing takes the union, so nobody can answer the only question that matters to
 * a user: *does the thing the cache is holding agree with the thing the pipeline
 * would compute?* Measured by hand on 2026-08-19 over 54 volume-unit golden cases,
 * the winner `foodId` differed warm vs cold on 39 of them — and of the 29 carrying
 * a grams band, warm passed 25 and cold passed 28. Three cases failed WARM ONLY
 * and all three were prose. That 54-case hand measurement is a HARD SUBSET,
 * deliberately chosen, and must never be quoted as a population number. This
 * script exists to replace it with one.
 *
 * WHY IT IS NOT A MODE OF winner-diff.ts
 * --------------------------------------
 * winner-diff is an IN-PROCESS, FROZEN-POOL harness: it forces `skipCache: true`
 * before any `src/lib` module loads, aborts the mapper at `gatherCandidates`, and
 * enforces read-only with a Prisma `$use` middleware. Every one of those three
 * properties is incompatible with measuring warm behaviour:
 *   - `skipCache: true` is the definition of the cold side; there is no warm side
 *     to compare against inside that process.
 *   - aborting at gather means the FoodMapping cache read (the thing under test)
 *     never runs.
 *   - a Prisma middleware cannot guard a request served by the box.
 * And the divergence mechanism we most want to see — a prose line whose cache key
 * is authored by the LLM segmenter (`route.ts:341,358` feeding
 * `map-ingredient-with-fallback.ts:641`) — lives in the ROUTE, above the mapper,
 * on a surface winner-diff never executes. So this is a sibling, and it probes the
 * live API the way run-eval.ts does.
 *
 * ==========================================================================
 * WHAT IT DOES
 * ==========================================================================
 * For every line in a population it sends TWO requests to `/api/nlp/parse`:
 *
 *   WARM   ?nosave=1&debug=1               cache read ON  (FoodMapping + SegmentationCache)
 *   COLD   ?nocache=1&nosave=1&debug=1     cache read OFF, full pipeline
 *
 * and records, per line and per side: `foodId`, `foodName`, `source`, `grams`,
 * `servingTier`, `cacheHit`, `kcal`, and the number of items the request produced.
 * It then reports which lines diverge on IDENTITY, which diverge only on GRAMS or
 * TIER, which diverge because SEGMENTATION produced a different number of items,
 * and — for any line carrying a golden grams band — which SIDE is inside it.
 *
 * ==========================================================================
 * WRITES — disclosed, bounded, and NOT zero
 * ==========================================================================
 * This is a read-mostly instrument, not a read-only one. Saying otherwise would be
 * the lie the playbook keeps catching. Every probe carries `nosave=1`, so:
 *
 *   FoodMapping (saveValidatedMapping)  SUPPRESSED  — `skipSave: noSave`, route.ts:360.
 *   SegmentationCache (write-through)   SUPPRESSED  — in the `suppress` list, route.ts:612.
 *   aiServing                           SUPPRESSED  — same list.
 *   MappingEventLog                     **WRITTEN**, on purpose. It is the measurement
 *                                       substrate and `nosave` deliberately spares it.
 *                                       Two rows per line per run (one warm, one cold).
 *   FoodMapping.usedCount / lastUsedAt  **WRITTEN** on every WARM cache HIT
 *                                       (validated-mapping-helpers.ts:441). A read bumps
 *                                       the counter; that is a column update on an
 *                                       existing row, never an insert.
 *   AiNormalizeCache (saveAiNormalizeCache)  **NOT SUPPRESSED BY nosave** — twice
 *                                       confirmed, and it is not a FoodMapping write but
 *                                       it IS a write. Any probe that reaches ai-normalize
 *                                       on a key the normalize cache does not hold will
 *                                       insert a row. Cold probes reach it far more often
 *                                       than warm ones. The run prints how many lines were
 *                                       exposed to it and the receipt records the number.
 *
 * `--dry-run` prints the population and the exact requests it would send, and
 * sends none of them. Use it before any population you have not run before.
 *
 * ==========================================================================
 * FAIL-CLOSED — playbook §11 class B, "absence encoded as a PASS"
 * ==========================================================================
 * A warm/cold instrument has a specific and very cheap way to lie: report
 * "0 divergences" when in fact nothing was compared. Four separate shapes of
 * nothing produce that same clean-looking output, and all four are VOID here:
 *
 *   population 0 lines               → nothing to probe
 *   every line skipped               → nothing probed
 *   one side dark (all its probes errored) → the two sides were never compared;
 *                                     "0 divergences" is a statement about the
 *                                     transport, not the cache
 *   the warm side never hit the cache → warm ≡ cold by construction, so 0
 *                                     divergences is a tautology. This is the
 *                                     subtle one: a population of never-asked
 *                                     lines produces a perfectly clean, perfectly
 *                                     meaningless report.
 *
 * See `warmColdExitCode`. Fail injection lives in
 * `scripts/eval/__tests__/warm-cold-diff.test.ts`, which drives this file's real
 * `runWarmCold()` against a stub server that errors, empties out and goes dark,
 * and asserts a nonzero exit each time — plus a positive control, because a guard
 * that refuses everything is a tautology and not a test.
 *
 * SKIPS ARE COUNTED AND PRINTED. A silently truncated population reads as full
 * coverage; every line the run did not probe is reported with its reason.
 *
 * ==========================================================================
 * THE NOISE FLOOR IS NOT ZERO HERE, AND THAT IS THE POINT
 * ==========================================================================
 * winner-diff's replay noise floor MUST be 0 because it replays a frozen pool.
 * This instrument replays neither frozen nor deterministic: the COLD side runs
 * live retrieval (Typesense returns ties in whatever order it likes —
 * `typesense-client.ts:66` passes no `sort_by`) and, for `text` input, a live LLM
 * segmenter. So the same side probed twice genuinely disagrees with itself
 * sometimes, and a warm-vs-cold divergence count is only a finding if it stands
 * ABOVE that floor.
 *
 *   `noise-floor --side cold`  probes the cold side TWICE and counts self-disagreement.
 *   `noise-floor --side warm`  the same for warm (expected ~0; a non-zero warm floor
 *                              means the cache itself is moving under the run).
 *
 * Each writes a receipt next to `--out`. `run` looks for a matching receipt and
 * prints the floor beside the divergence; with no receipt it prints an UNMEASURED
 * FLOOR banner and stamps `noiseFloor: null` on its own receipt, so no reader can
 * quote the number as if it had been separated from noise.
 *
 * ==========================================================================
 * WHAT THIS STRUCTURALLY CANNOT SEE — do not soften these
 * ==========================================================================
 * (A) WHICH SIDE IS RIGHT. Divergence is not error. A different record with the
 *     same acceptable weight is benign, and 39-of-54 was mostly that. Only the
 *     golden band adjudicates, and only 162 of the 265 nlp cases carry one.
 * (B) WHY a line diverged. The instrument reports that warm and cold disagree; it
 *     does not attribute the disagreement to the FoodMapping row, the segmenter,
 *     or a retrieval tie. `segmentationDiverged` and the noise floor narrow it;
 *     they do not close it.
 * (C) ANY LINE NOT IN THE POPULATION. `--from-cache` and `--from-events` contain
 *     only what has already been asked (winner-diff blind spot (D), unchanged
 *     here). A cache defect on a key nobody has queried is invisible.
 * (D) THE ORDER EFFECT. Warm is probed before cold for each line. A warm hit bumps
 *     `usedCount`; nothing else about the line changes between the two probes, but
 *     the run is not perfectly non-perturbing and pretending otherwise is how the
 *     last three "read-only" claims in this repo failed review.
 *
 * ==========================================================================
 * USAGE — from a backend repo root
 * ==========================================================================
 *   RUN='npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/eval/warm-cold-diff.ts'
 *
 *   $RUN run --golden --out /tmp/wc-golden.json
 *   $RUN run --from-cache --order used --limit 300 --out /tmp/wc-cache.json
 *   $RUN noise-floor --side cold --from-cache --limit 100 --out /tmp/wc-cache.json
 *   $RUN run --from-file lines.txt --dry-run
 *
 * EXIT CODES
 *   0  a real measurement: both sides answered, the warm side was actually warm
 *   1  PARTIAL — some rows errored on one side; those rows were verified by nothing
 *   2  VOID — see the four shapes of nothing above, or a bad invocation
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// 1. WIRE CONTRACT
// ============================================================

/**
 * The two query strings, as constants, because the difference between them is the
 * entire experiment and it must be greppable and testable.
 *
 * `nosave=1` rides on BOTH sides deliberately. A warm probe without it re-saves the
 * row it just read; a cold probe without it overwrites the cache it is measuring
 * (measured 2026-08-02 on run-eval: 20 rows changed, 3 added). `debug=1` is the
 * dev-bypass-only echo that puts `servingTier` and `cacheHit` on each item — the
 * only way to see which rung billed, and the only way to know whether the warm
 * side was warm at all. Real clients never send either.
 */
export const WARM_QS = 'nosave=1&debug=1';
export const COLD_QS = 'nocache=1&nosave=1&debug=1';

export type Side = 'warm' | 'cold';

export function queryStringFor(side: Side): string {
    return side === 'warm' ? WARM_QS : COLD_QS;
}

/** Input shape of one population line, which decides which route path it exercises. */
export type LineShape =
    /** posted as `{items:[{rawText}]}` — deterministic parse, the LLM segmenter never runs */
    | 'item'
    /** posted as `{text}` — may reach the LLM segmenter, whose output becomes the cache key */
    | 'text';

export interface PopLine {
    id: string;
    /** what a human would call this line; for `item` shape it is the rawText */
    query: string;
    shape: LineShape;
    /** golden category, or the population source name for non-golden lines */
    category: string;
    /** the golden grams band for items[0], when the case declares one */
    band: [number, number] | null;
    knownIssue?: boolean;
    /** the exact `items[0]` object a golden `item` case declares, posted verbatim */
    item?: Record<string, unknown>;
    /** `--from-cache` only: how often the cache row has been used */
    usedCount?: number;
}

export interface SideObs {
    ok: boolean;
    error: string | null;
    httpStatus: number | null;
    foodId: string | null;
    foodName: string | null;
    source: string | null;
    grams: number | null;
    kcal: number | null;
    /** absent (undefined) when the server sent no debug echo — NOT the same as null */
    servingTier?: string | null;
    /** 'early' | 'normalized' | null; undefined when the echo is absent */
    cacheHit?: string | null;
    itemCount: number;
    /** every item's foodId in order, so a segmentation change is visible */
    foodIds: Array<string | null>;
    /** parsed `X-Write-Receipt`, when the server sent one */
    writeReceipt: { suppress?: string[]; refusedTotal?: number } | null;
    ms: number;
}

export interface Row {
    line: PopLine;
    warm: SideObs;
    cold: SideObs;
}

/** A line the run did NOT probe, and why. Never silently dropped. */
export interface Skip {
    id: string;
    query: string;
    reason: string;
}

// ============================================================
// 2. VERDICTS — pure, testable, no network
// ============================================================

export type WcVerdict =
    /** at least one side did not answer; nothing about this line was compared */
    | 'ERROR'
    /** the two sides produced a different NUMBER of items — the split itself moved */
    | 'SEGMENTATION-DIVERGED'
    /** items[0] is a different food record */
    | 'IDENTITY-DIVERGED'
    /** same record, different billed grams */
    | 'GRAMS-DIVERGED'
    /** same record, same grams, different serving rung */
    | 'TIER-DIVERGED'
    | 'SAME';

/** Grams equal within a tenth of a gram; below that is float noise, not a finding. */
export const GRAMS_EPSILON = 0.1;

export function classifyRow(r: Row): WcVerdict {
    if (!r.warm.ok || !r.cold.ok) return 'ERROR';
    if (r.warm.itemCount !== r.cold.itemCount) return 'SEGMENTATION-DIVERGED';
    if (r.warm.foodId !== r.cold.foodId) return 'IDENTITY-DIVERGED';
    const a = r.warm.grams, b = r.cold.grams;
    const gramsSame = (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < GRAMS_EPSILON);
    if (!gramsSame) return 'GRAMS-DIVERGED';
    // Tier is only comparable when BOTH sides echoed it. An absent echo is absence of
    // the observable, never a difference — the same fail-open rule scoreNlpCase uses
    // for expectServingTier.
    const ta = r.warm.servingTier, tb = r.cold.servingTier;
    if (ta !== undefined && tb !== undefined && ta !== tb) return 'TIER-DIVERGED';
    return 'SAME';
}

/** True when `g` sits inside the band, inclusive. `null` grams is never inside. */
export function inBand(g: number | null | undefined, band: [number, number] | null): boolean | null {
    if (!band) return null;
    if (typeof g !== 'number') return false;
    return g >= band[0] && g <= band[1];
}

export interface BandVerdict {
    /** null when the line carries no band, or a side did not answer */
    warmIn: boolean | null;
    coldIn: boolean | null;
    /** exactly one side is inside the band — the only band result that is a FINDING */
    crossed: boolean;
    /** which side is the one inside, when crossed */
    insideSide: Side | null;
}

export function bandVerdict(r: Row): BandVerdict {
    if (!r.line.band || !r.warm.ok || !r.cold.ok) {
        return { warmIn: null, coldIn: null, crossed: false, insideSide: null };
    }
    const warmIn = inBand(r.warm.grams, r.line.band);
    const coldIn = inBand(r.cold.grams, r.line.band);
    const crossed = warmIn !== coldIn;
    return {
        warmIn, coldIn, crossed,
        insideSide: crossed ? (warmIn ? 'warm' : 'cold') : null,
    };
}

// ============================================================
// 3. COUNTS + THE FAIL-CLOSED EXIT VERDICT
// ============================================================

export interface WcCounts {
    /** lines the population source offered, BEFORE any skip */
    population: number;
    /** lines not probed at all, for any reason */
    skipped: number;
    /** rows actually probed (population - skipped) */
    probed: number;
    warmErrors: number;
    coldErrors: number;
    bothErrors: number;
    /** rows where BOTH sides answered — the only rows any comparison ran on */
    comparable: number;
    same: number;
    identityDiverged: number;
    segmentationDiverged: number;
    gramsDiverged: number;
    tierDiverged: number;
    /** comparable rows carrying a golden grams band */
    banded: number;
    bandCrossed: number;
    bandBothIn: number;
    bandBothOut: number;
    /** band crossings where WARM is the side inside — the cache is better here */
    warmOnlyIn: number;
    /** band crossings where COLD is the side inside — the cache is WORSE here */
    coldOnlyIn: number;
    /** rows whose warm probe reported a non-null `cacheHit`: proof the warm side was warm */
    warmCacheHits: number;
    /**
     * INTERNAL NOISE CONTROL. Comparable rows whose WARM probe MISSED the cache.
     * On those rows the warm side ran the same pipeline the cold side ran, so the two
     * observations are two draws from one distribution and any divergence between them
     * is noise, not cache disagreement. `warmMissDiverged / warmMisses` is therefore a
     * floor estimate the run computes about ITSELF, for free, with no second pass — and
     * it is the number to check the divergence rate against when no `noise-floor`
     * receipt exists. It is a small sample by construction (a good warm population has
     * few misses) and it is NOT a substitute for the real floor.
     */
    warmMisses: number;
    warmMissDiverged: number;
    /** rows where the server sent no debug echo at all (tier + cacheHit unobservable) */
    echoMissing: number;
    /** `text`-shaped lines sent — the ones that can reach the LLM segmenter and ai-normalize */
    textLinesSent: number;
}

export const WC_VOID_EXIT = 2;
export const WC_PARTIAL_EXIT = 1;

/**
 * The verdict that stops this script printing a clean report over nothing.
 *
 * Ordered most-fundamental first, because the reasons are not interchangeable and
 * an operator needs the FIRST thing that went wrong, not the last. The order also
 * matters for the "one side dark" cases: reporting "0 divergences, 1 partial
 * error" when in fact every cold probe 500'd would be exactly the class B failure
 * this file's header names.
 *
 * `allowUnwarmed` exists for the one legitimate case — deliberately probing lines
 * that have never been cached — and it STAINS the receipt (`warmSideWasCold:true`)
 * rather than quietly permitting the run, because the resulting number is not a
 * warm/cold measurement and must not be quotable as one.
 */
export function warmColdExitCode(
    c: Pick<WcCounts, 'population' | 'skipped' | 'probed' | 'warmErrors' | 'coldErrors' | 'comparable' | 'warmCacheHits'>,
    opts: { allowUnwarmed?: boolean } = {},
): { code: 0 | 1 | 2; reason: string | null } {
    if (c.population === 0) {
        return {
            code: WC_VOID_EXIT,
            reason: 'VOID: the population source produced ZERO lines. "0 divergences" over an empty '
                + 'population is a statement about the source file, not about the cache.',
        };
    }
    if (c.probed === 0) {
        return {
            code: WC_VOID_EXIT,
            reason: `VOID: all ${c.population} population lines were SKIPPED — nothing was probed. `
                + 'Read the SKIPPED section: a fully truncated run prints the same clean summary as a clean one.',
        };
    }
    if (c.warmErrors >= c.probed) {
        return {
            code: WC_VOID_EXIT,
            reason: `VOID: the WARM side is entirely dark — all ${c.probed} warm probes failed. `
                + 'The two sides were never compared; this run says nothing about the cache.',
        };
    }
    if (c.coldErrors >= c.probed) {
        return {
            code: WC_VOID_EXIT,
            reason: `VOID: the COLD side is entirely dark — all ${c.probed} cold probes failed. `
                + 'The two sides were never compared; this run says nothing about the pipeline.',
        };
    }
    if (c.comparable === 0) {
        return {
            code: WC_VOID_EXIT,
            reason: `VOID: ZERO of ${c.probed} rows had BOTH sides answer, so zero warm/cold comparisons ran. `
                + `(warm errors ${c.warmErrors}, cold errors ${c.coldErrors}.)`,
        };
    }
    if (c.warmCacheHits === 0 && !opts.allowUnwarmed) {
        return {
            code: WC_VOID_EXIT,
            reason: `VOID: not one of ${c.comparable} comparable rows reported a warm cache HIT, so the `
                + '"warm" side ran the pipeline exactly like the cold side. Any divergence count here is a '
                + 'tautology. Use a population of already-asked keys (--from-cache / --from-events), or pass '
                + '--allow-unwarmed to record it as an explicitly cold-vs-cold run.',
        };
    }
    if (c.warmErrors > 0 || c.coldErrors > 0) {
        return {
            code: WC_PARTIAL_EXIT,
            reason: `PARTIAL: ${c.warmErrors} warm and ${c.coldErrors} cold probes failed of ${c.probed} rows. `
                + 'Those rows were verified by NOTHING; the percentages below are over the '
                + `${c.comparable} rows that answered on both sides, not over the population.`,
        };
    }
    return { code: 0, reason: null };
}

/** Fold rows + skips into the counts. Pure; the tests drive it with synthetic rows. */
export function summarize(rows: Row[], skips: Skip[], population: number): WcCounts {
    const c: WcCounts = {
        population, skipped: skips.length, probed: rows.length,
        warmErrors: 0, coldErrors: 0, bothErrors: 0, comparable: 0,
        same: 0, identityDiverged: 0, segmentationDiverged: 0, gramsDiverged: 0, tierDiverged: 0,
        banded: 0, bandCrossed: 0, bandBothIn: 0, bandBothOut: 0, warmOnlyIn: 0, coldOnlyIn: 0,
        warmCacheHits: 0, warmMisses: 0, warmMissDiverged: 0, echoMissing: 0, textLinesSent: 0,
    };
    for (const r of rows) {
        if (r.line.shape === 'text') c.textLinesSent++;
        if (!r.warm.ok) c.warmErrors++;
        if (!r.cold.ok) c.coldErrors++;
        if (!r.warm.ok && !r.cold.ok) c.bothErrors++;
        if (!r.warm.ok || !r.cold.ok) continue;
        c.comparable++;
        if (r.warm.servingTier === undefined || r.cold.servingTier === undefined) c.echoMissing++;
        const warmHit = typeof r.warm.cacheHit === 'string' && !!r.warm.cacheHit;
        if (warmHit) c.warmCacheHits++;
        // A warm MISS ran the pipeline exactly as the cold probe did, so the pair is a
        // same-side-twice draw and any difference is this instrument's own noise. Only
        // counted when the echo was actually present: an ABSENT echo is not a miss.
        else if (r.warm.cacheHit === null) {
            c.warmMisses++;
            if (classifyRow(r) !== 'SAME') c.warmMissDiverged++;
        }
        switch (classifyRow(r)) {
            case 'SAME': c.same++; break;
            case 'IDENTITY-DIVERGED': c.identityDiverged++; break;
            case 'SEGMENTATION-DIVERGED': c.segmentationDiverged++; break;
            case 'GRAMS-DIVERGED': c.gramsDiverged++; break;
            case 'TIER-DIVERGED': c.tierDiverged++; break;
            default: break;
        }
        const bv = bandVerdict(r);
        if (bv.warmIn !== null && bv.coldIn !== null) {
            c.banded++;
            if (bv.crossed) {
                c.bandCrossed++;
                if (bv.insideSide === 'warm') c.warmOnlyIn++; else c.coldOnlyIn++;
            } else if (bv.warmIn) c.bandBothIn++;
            else c.bandBothOut++;
        }
    }
    return c;
}

// ============================================================
// 4. DECOMPOSITION — one aggregate is not an answer
// ============================================================

export interface Subset {
    label: string;
    n: number;
    identityDiverged: number;
    segmentationDiverged: number;
    banded: number;
    bandCrossed: number;
    coldOnlyIn: number;
    warmOnlyIn: number;
}

export function subsetOf(label: string, rows: Row[]): Subset {
    const s: Subset = {
        label, n: 0, identityDiverged: 0, segmentationDiverged: 0,
        banded: 0, bandCrossed: 0, coldOnlyIn: 0, warmOnlyIn: 0,
    };
    for (const r of rows) {
        if (!r.warm.ok || !r.cold.ok) continue;
        s.n++;
        const v = classifyRow(r);
        if (v === 'IDENTITY-DIVERGED') s.identityDiverged++;
        if (v === 'SEGMENTATION-DIVERGED') s.segmentationDiverged++;
        const bv = bandVerdict(r);
        if (bv.warmIn !== null && bv.coldIn !== null) {
            s.banded++;
            if (bv.crossed) {
                s.bandCrossed++;
                if (bv.insideSide === 'warm') s.warmOnlyIn++; else s.coldOnlyIn++;
            }
        }
    }
    return s;
}

/** Group rows by an arbitrary key and summarise each group, biggest first. */
export function decompose(rows: Row[], keyFn: (r: Row) => string): Subset[] {
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
        const k = keyFn(r);
        const g = groups.get(k);
        if (g) g.push(r); else groups.set(k, [r]);
    }
    return Array.from(groups.entries())
        .map(([k, rs]) => subsetOf(k, rs))
        .sort((a, b) => b.n - a.n);
}

export function pct(num: number, den: number): string {
    if (den === 0) return '  n/a';
    return `${((num / den) * 100).toFixed(1).padStart(5)}%`;
}

/**
 * What the server said it suppressed, folded across every probe.
 *
 * The header of this file CLAIMS which writes `nosave=1` stops. `X-Write-Receipt`
 * is the server's own statement of what it actually stopped, and a claim with an
 * available receipt that nobody reads is not a disclosure. A probe that came back
 * with NO receipt is counted separately: it means the request was not treated as
 * dev-bypass+nosave, so nothing was suppressed on it at all.
 */
export interface WriteReceiptSummary {
    probes: number;
    withReceipt: number;
    /** probes the server answered WITHOUT a receipt — those ran with no suppression */
    withoutReceipt: number;
    /** every distinct `suppress` set seen, as a sorted joined string */
    suppressSets: string[];
    refusedTotal: number;
}

export function writeReceiptSummary(rows: Row[]): WriteReceiptSummary {
    const sets = new Set<string>();
    let probes = 0, withReceipt = 0, refusedTotal = 0;
    for (const r of rows) {
        for (const o of [r.warm, r.cold]) {
            if (!o.ok) continue;
            probes++;
            if (!o.writeReceipt) continue;
            withReceipt++;
            sets.add((o.writeReceipt.suppress ?? []).slice().sort().join('+') || '(none)');
            refusedTotal += o.writeReceipt.refusedTotal ?? 0;
        }
    }
    return {
        probes, withReceipt, withoutReceipt: probes - withReceipt,
        suppressSets: Array.from(sets).sort(), refusedTotal,
    };
}

// ============================================================
// 5. NOISE FLOOR
// ============================================================

export interface WcNoiseReceipt {
    kind: 'warm-cold-diff/noise-floor';
    version: 1;
    ranAt: string;
    side: Side;
    population: string;
    /** stable hash of the exact line set, so `run` can tell a matching floor from a stray one */
    populationFingerprint: string;
    rows: number;
    comparable: number;
    idDiffs: number;
    gramsDiffs: number;
    itemCountDiffs: number;
    tierDiffs: number;
    /**
     * Serving-process identity bracketing the floor run (absent on receipts
     * written before the stamp existed — absent means UNSTAMPED, not unchanged).
     * A floor and a run compared across different buildIds measure different
     * programs.
     */
    server?: { before: ServerStamp | null; after: ServerStamp | null; changedMidRun: boolean | null };
}

export interface WcNoiseLedger {
    kind: 'warm-cold-diff/noise-floor-ledger';
    version: 1;
    receipts: WcNoiseReceipt[];
}

export function emptyNoiseLedger(): WcNoiseLedger {
    return { kind: 'warm-cold-diff/noise-floor-ledger', version: 1, receipts: [] };
}

/**
 * A stable fingerprint of the population, order-independent.
 *
 * Order-independent on purpose: `--from-cache order=used` can reshuffle two rows
 * with equal `usedCount` between runs, and a floor receipt should not be discarded
 * for that. What must match is the SET of lines.
 */
export function populationFingerprint(lines: PopLine[]): string {
    // require() rather than a top-level import so this module stays importable from
    // a browser-less test env with no crypto polyfill assumptions.
    const { createHash } = require('crypto') as typeof import('crypto');
    // NUL as the split-invariant separator (a query can contain any printable
    // character). Written as the \u0000 ESCAPE, never a literal NUL byte: the
    // byte form makes grep classify this whole file as binary, which cost a
    // session its searches before anyone found it. Same runtime string either
    // way, so fingerprints (and every ledger receipt keyed on them) are stable.
    const sorted = lines.map(l => `${l.shape}\u0000${l.query}`).sort();
    return createHash('sha256').update(sorted.join('\n')).digest('hex').slice(0, 16);
}

export function findNoiseReceipt(
    ledger: WcNoiseLedger | null, side: Side, fingerprint: string,
): WcNoiseReceipt | null {
    if (!ledger) return null;
    const hits = ledger.receipts.filter(r => r.side === side && r.populationFingerprint === fingerprint);
    if (!hits.length) return null;
    return hits.sort((a, b) => (a.ranAt < b.ranAt ? 1 : -1))[0];
}

export function noiseReceiptPath(outPath: string): string {
    return outPath.replace(/\.json$/, '') + '.noise-floor.json';
}

/**
 * Compare two observations of the SAME side. Used only by `noise-floor`.
 * Returns the four ways the same side can disagree with itself.
 */
export function selfDiff(a: SideObs, b: SideObs): {
    comparable: boolean; id: boolean; grams: boolean; itemCount: boolean; tier: boolean;
} {
    if (!a.ok || !b.ok) return { comparable: false, id: false, grams: false, itemCount: false, tier: false };
    const gramsDiff = !((a.grams == null && b.grams == null)
        || (a.grams != null && b.grams != null && Math.abs(a.grams - b.grams) < GRAMS_EPSILON));
    return {
        comparable: true,
        id: a.foodId !== b.foodId,
        grams: gramsDiff,
        itemCount: a.itemCount !== b.itemCount,
        tier: a.servingTier !== undefined && b.servingTier !== undefined && a.servingTier !== b.servingTier,
    };
}

// ============================================================
// 6. THE PROBE
// ============================================================

export interface ProbeConfig {
    base: string;
    apiKey: string;
    timeoutMs: number;
    /** injected in tests; defaults to global fetch */
    fetchImpl?: typeof fetch;
}

/** The request body for a line, which is what decides whether the segmenter runs. */
export function bodyFor(line: PopLine): Record<string, unknown> {
    if (line.shape === 'text') return { text: line.query };
    // `item` shape posts the case's own item object when it has one (golden cases
    // carry quantity/unit/name the route's deterministic parser would otherwise have
    // to re-derive), else a bare rawText.
    return { items: [line.item ?? { rawText: line.query, mealType: 'snacks' }] };
}

/**
 * The serving process's identity, read from /api/ok. `buildId` is public;
 * `pid`/`since` ride the keyed `llm` block, so an unauthorized key stamps them
 * null (which is "unmeasured", never "unchanged"). The /api/ok delta rule owns
 * the semantics: two reads describe the SAME process only if buildId, pid AND
 * since all match — a restart resets counters silently, and a mid-run deploy
 * means the two arms measured two different programs.
 */
export interface ServerStamp {
    buildId: string | null;
    pid: number | null;
    since: string | null;
}

export async function fetchServerStamp(cfg: ProbeConfig): Promise<ServerStamp | null> {
    const doFetch = cfg.fetchImpl ?? fetch;
    try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
        let res: Response;
        try {
            res = await doFetch(`${cfg.base}/api/ok`, {
                headers: { 'x-api-key': cfg.apiKey },
                signal: ctrl.signal,
            });
        } finally {
            clearTimeout(to);
        }
        if (!res.ok) return null;
        const j = await res.json() as Record<string, any>;
        return {
            buildId: typeof j?.buildId === 'string' ? j.buildId : null,
            pid: typeof j?.llm?.pid === 'number' ? j.llm.pid : null,
            since: typeof j?.llm?.since === 'string' ? j.llm.since : null,
        };
    } catch {
        return null;
    }
}

/**
 * true  = the server affirmatively changed between the two reads
 * false = both reads exist and every identity field matches
 * null  = at least one read is missing — UNMEASURED, which must never be
 *         rendered as "unchanged" (the same fail-closed rule as the noise floor).
 */
export function serverChanged(before: ServerStamp | null, after: ServerStamp | null): boolean | null {
    if (!before || !after) return null;
    return before.buildId !== after.buildId
        || before.pid !== after.pid
        || before.since !== after.since;
}

export async function probe(line: PopLine, side: Side, cfg: ProbeConfig): Promise<SideObs> {
    const t0 = Date.now();
    const doFetch = cfg.fetchImpl ?? fetch;
    const empty = (error: string, httpStatus: number | null): SideObs => ({
        ok: false, error, httpStatus,
        foodId: null, foodName: null, source: null, grams: null, kcal: null,
        itemCount: 0, foodIds: [], writeReceipt: null, ms: Date.now() - t0,
    });
    try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
        let res: Response;
        try {
            res = await doFetch(`${cfg.base}/api/nlp/parse?${queryStringFor(side)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey },
                body: JSON.stringify(bodyFor(line)),
                signal: ctrl.signal,
            });
        } finally {
            clearTimeout(to);
        }
        if (!res.ok) return empty(`HTTP ${res.status}`, res.status);
        const items: unknown = await res.json();
        if (!Array.isArray(items) || items.length === 0) {
            // An empty array is ABSENCE of a reading, never a reading of "nothing
            // matched" — the route's abstain branch still returns one item. Same rule
            // as scoreNlpCase's fail-closed contract.
            return empty(
                `no items returned (${Array.isArray(items) ? 'empty array' : typeof items})`,
                res.status,
            );
        }
        const first = items[0] as Record<string, any>;
        let writeReceipt: SideObs['writeReceipt'] = null;
        const hdr = res.headers?.get?.('x-write-receipt');
        if (hdr) { try { writeReceipt = JSON.parse(hdr); } catch { writeReceipt = null; } }
        // The debug echo's KEY is the signal: absent means the server never stamped it,
        // which is different from stamping null. Preserve the distinction.
        const echoed = Object.prototype.hasOwnProperty.call(first, 'servingTier');
        return {
            ok: true, error: null, httpStatus: res.status,
            foodId: first?.foodId ?? null,
            foodName: first?.foodName ?? null,
            source: first?.source ?? null,
            grams: typeof first?.grams === 'number' ? first.grams : null,
            kcal: first?.nutrition?.calories ?? null,
            ...(echoed ? { servingTier: first?.servingTier ?? null, cacheHit: first?.cacheHit ?? null } : {}),
            itemCount: items.length,
            foodIds: (items as Array<Record<string, any>>).map(it => it?.foodId ?? null),
            writeReceipt,
            ms: Date.now() - t0,
        };
    } catch (err) {
        return empty(`ERROR: ${(err as Error).message}`, null);
    }
}

/** Bounded-concurrency map that preserves input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
    const out = new Array<R>(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        for (;;) {
            const i = next++;
            if (i >= items.length) return;
            out[i] = await fn(items[i], i);
        }
    });
    await Promise.all(workers);
    return out;
}

// ============================================================
// 7. THE RUN — exported so the fail-injection test drives the REAL thing
// ============================================================

export interface RunOptions {
    lines: PopLine[];
    populationDesc: string;
    /** lines the population builder already refused, with reasons */
    skips: Skip[];
    cfg: ProbeConfig;
    concurrency: number;
    outPath?: string;
    allowUnwarmed?: boolean;
    /** print instead of probe */
    dryRun?: boolean;
    /** sink for report lines; defaults to console.log */
    log?: (s: string) => void;
}

export interface RunResult {
    code: 0 | 1 | 2;
    reason: string | null;
    counts: WcCounts;
    rows: Row[];
    skips: Skip[];
    noiseFloor: WcNoiseReceipt | null;
    lines: string[];
}

export async function runWarmCold(opts: RunOptions): Promise<RunResult> {
    const out: string[] = [];
    const say = (s = '') => { out.push(s); (opts.log ?? console.log)(s); };

    const fingerprint = populationFingerprint(opts.lines);
    printPopulationBlock(say, opts, fingerprint);

    if (opts.dryRun) {
        say('');
        say('DRY RUN — no request was sent. The two requests per line would be:');
        for (const l of opts.lines.slice(0, 8)) {
            say(`  ${l.id.padEnd(14)} WARM POST /api/nlp/parse?${WARM_QS}  ${JSON.stringify(bodyFor(l))}`);
            say(`  ${''.padEnd(14)} COLD POST /api/nlp/parse?${COLD_QS}  ${JSON.stringify(bodyFor(l))}`);
        }
        if (opts.lines.length > 8) say(`  ... and ${opts.lines.length - 8} more lines, x2 requests each`);
        const counts = summarize([], opts.skips, opts.lines.length);
        return { code: 0, reason: null, counts, rows: [], skips: opts.skips, noiseFloor: null, lines: out };
    }

    // Bracket the whole probe pass with /api/ok reads. A results file that
    // records `base` but not the BUILD lets a reader diff two runs across a
    // deploy and call the difference noise (the documented cold-gate trap, now
    // closed for this instrument); and a restart mid-run clears in-process
    // caches (servingCache) under our feet.
    // (An empty population sends NOTHING — including these reads; the VOID
    // verdict below covers it and an unstamped void run is not a diff trap.)
    const serverBefore = opts.lines.length > 0 ? await fetchServerStamp(opts.cfg) : null;
    if (serverBefore) {
        say(`server         buildId ${serverBefore.buildId ?? '(unstamped)'}   pid ${serverBefore.pid ?? '?'}   since ${serverBefore.since ?? '?'}`);
    } else if (opts.lines.length > 0) {
        say('server         !! /api/ok UNREADABLE — this run is UNSTAMPED; do not diff its receipt against another run');
    }

    // WARM first, then COLD, for each line. Sequential per line on purpose: the warm
    // read is the state as found, and probing cold first would leave the ai-normalize
    // cache freshly populated for the warm probe to read.
    const rows: Row[] = await mapLimit(opts.lines, opts.concurrency, async (line) => {
        const warm = await probe(line, 'warm', opts.cfg);
        const cold = await probe(line, 'cold', opts.cfg);
        return { line, warm, cold };
    });

    const serverAfter = opts.lines.length > 0 ? await fetchServerStamp(opts.cfg) : null;
    const serverChangedMidRun = serverChanged(serverBefore, serverAfter);
    if (serverChangedMidRun === true) {
        say('');
        say(`!! SERVER CHANGED MID-RUN: ${serverBefore!.buildId}/${serverBefore!.pid} -> ${serverAfter!.buildId}/${serverAfter!.pid}`);
        say('   The two sides of some lines were answered by different processes (or builds).');
        say('   The receipt is stamped serverChangedMidRun:true — do not quote this run.');
    } else if (serverChangedMidRun === null && opts.lines.length > 0) {
        say('');
        say('!! SERVER STAMP INCOMPLETE — /api/ok was unreadable on at least one side of the run;');
        say('   "unchanged" is NOT established. The receipt carries whatever was read.');
    }

    const counts = summarize(rows, opts.skips, opts.lines.length);
    const verdict = warmColdExitCode(counts, { allowUnwarmed: opts.allowUnwarmed });

    const ledger = opts.outPath ? readNoiseLedger(noiseReceiptPath(opts.outPath)) : null;
    const floorCold = findNoiseReceipt(ledger, 'cold', fingerprint);
    const floorWarm = findNoiseReceipt(ledger, 'warm', fingerprint);

    printReport(say, rows, counts, verdict, { cold: floorCold, warm: floorWarm });

    if (opts.outPath) {
        writeJsonAtomic(opts.outPath, {
            kind: 'warm-cold-diff/run',
            version: 1,
            ranAt: new Date().toISOString(),
            base: opts.cfg.base,
            /** the serving process's identity, bracketing the probe pass — see ServerStamp */
            server: { before: serverBefore, after: serverAfter, changedMidRun: serverChangedMidRun },
            population: opts.populationDesc,
            populationFingerprint: fingerprint,
            warmQuery: WARM_QS,
            coldQuery: COLD_QS,
            exit: verdict.code,
            exitReason: verdict.reason,
            /** stains the receipt when the warm side was not actually warm */
            warmSideWasCold: counts.warmCacheHits === 0,
            /** null means the floor was NEVER MEASURED for this population — do not quote the diff */
            noiseFloor: { cold: floorCold, warm: floorWarm },
            counts,
            decomposition: {
                byShape: decompose(rows, r => r.line.shape),
                byCategory: decompose(rows, r => r.line.category),
            },
            writeReceipts: writeReceiptSummary(rows),
            skips: opts.skips,
            rows: rows.map(r => ({
                id: r.line.id, query: r.line.query, shape: r.line.shape, category: r.line.category,
                band: r.line.band, knownIssue: r.line.knownIssue ?? false,
                verdict: classifyRow(r), band_: bandVerdict(r),
                warm: r.warm, cold: r.cold,
            })),
        });
        say(`\nreceipt written: ${opts.outPath}`);
    }

    return { code: verdict.code, reason: verdict.reason, counts, rows, skips: opts.skips, noiseFloor: floorCold, lines: out };
}

function printPopulationBlock(say: (s?: string) => void, opts: RunOptions, fingerprint: string) {
    say('');
    say('================================================================================');
    say('WARM/COLD DIFF — one population, both ways');
    say('================================================================================');
    say(`base           ${opts.cfg.base}`);
    say(`population     ${opts.populationDesc}`);
    say(`lines          ${opts.lines.length}   fingerprint ${fingerprint}`);
    const textLines = opts.lines.filter(l => l.shape === 'text').length;
    say(`shape split    item ${opts.lines.length - textLines}   text ${textLines}`);
    say('');
    say('WRITES THIS RUN WILL CAUSE (nosave=1 on both sides):');
    say(`  MappingEventLog        ~${opts.lines.length * 2} rows (2 per line; nosave deliberately spares telemetry)`);
    say('  FoodMapping.usedCount  bumped on every WARM cache HIT (column update, never an insert)');
    say(`  AiNormalizeCache       NOT suppressed by nosave. ${textLines} text-shaped lines and every cold`);
    say('                         probe can reach saveAiNormalizeCache and insert a row.');
    say('  FoodMapping rows       none — skipSave is on for both sides');
    say('  SegmentationCache      none — suppressed for both sides');
    // SKIPS FIRST, and always, because a truncated population prints the same clean
    // summary as a complete one. This is the line that stops that.
    say('');
    if (opts.skips.length === 0) {
        say('SKIPPED        0 — every line the source offered is in the population above');
    } else {
        say(`SKIPPED        ${opts.skips.length} of ${opts.lines.length + opts.skips.length} lines the source offered:`);
        const byReason = new Map<string, number>();
        for (const s of opts.skips) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
        for (const [reason, n] of Array.from(byReason.entries()).sort((a, b) => b[1] - a[1])) {
            say(`               ${String(n).padStart(5)}  ${reason}`);
        }
        for (const s of opts.skips.slice(0, 12)) say(`               - ${s.id}: ${s.query.slice(0, 60)}`);
        if (opts.skips.length > 12) say(`               ... and ${opts.skips.length - 12} more (all in the receipt)`);
    }
}

function printReport(
    say: (s?: string) => void,
    rows: Row[],
    c: WcCounts,
    verdict: { code: 0 | 1 | 2; reason: string | null },
    floor: { cold: WcNoiseReceipt | null; warm: WcNoiseReceipt | null },
) {
    const comparable = c.comparable;
    say('');
    say('--------------------------------------------------------------------------------');
    say('COVERAGE — what was actually compared');
    say('--------------------------------------------------------------------------------');
    say(`  population offered      ${String(c.population + c.skipped).padStart(6)}`);
    say(`  skipped                 ${String(c.skipped).padStart(6)}`);
    say(`  probed                  ${String(c.probed).padStart(6)}`);
    say(`  warm errors             ${String(c.warmErrors).padStart(6)}`);
    say(`  cold errors             ${String(c.coldErrors).padStart(6)}   (both sides: ${c.bothErrors})`);
    say(`  COMPARABLE (both sides) ${String(comparable).padStart(6)}   <- every percentage below is over THIS`);
    say(`  warm cache HITS         ${String(c.warmCacheHits).padStart(6)}   ${pct(c.warmCacheHits, comparable)} — proof the warm side was warm`);
    say(`  debug echo missing      ${String(c.echoMissing).padStart(6)}   (tier unobservable on those rows)`);

    // The server's own statement of what nosave=1 actually stopped. The header of
    // this file CLAIMS a suppression list; this is the evidence, and a disclosure
    // nobody prints is not a disclosure.
    const wr = writeReceiptSummary(rows);
    say('');
    say(`  X-Write-Receipt         ${String(wr.withReceipt).padStart(6)} of ${wr.probes} answered probes carried one`);
    say(`    suppress sets seen    ${wr.suppressSets.join(' | ') || '(none)'}`);
    say(`    refusedTotal (sum)    ${wr.refusedTotal}`);
    if (wr.withoutReceipt > 0) {
        say(`    !! ${wr.withoutReceipt} probes came back WITH NO RECEIPT — nosave was not in force on those,`);
        say('       so nothing was suppressed for them. Check the api key is the dev-bypass one.');
    }

    say('');
    say('--------------------------------------------------------------------------------');
    say('DIVERGENCE');
    say('--------------------------------------------------------------------------------');
    say(`  SAME                    ${String(c.same).padStart(6)}   ${pct(c.same, comparable)}`);
    say(`  IDENTITY-DIVERGED       ${String(c.identityDiverged).padStart(6)}   ${pct(c.identityDiverged, comparable)}  different items[0].foodId`);
    say(`  SEGMENTATION-DIVERGED   ${String(c.segmentationDiverged).padStart(6)}   ${pct(c.segmentationDiverged, comparable)}  different item COUNT`);
    say(`  GRAMS-DIVERGED          ${String(c.gramsDiverged).padStart(6)}   ${pct(c.gramsDiverged, comparable)}  same record, different grams`);
    say(`  TIER-DIVERGED           ${String(c.tierDiverged).padStart(6)}   ${pct(c.tierDiverged, comparable)}  same record+grams, different rung`);
    say(`  warm-MISS control       ${String(c.warmMissDiverged).padStart(6)}   ${pct(c.warmMissDiverged, c.warmMisses)} of ${c.warmMisses} rows where the warm probe MISSED`);
    say('                                   the cache and therefore ran the SAME pipeline as cold. Any');
    say('                                   difference there is this instrument\'s own noise, measured');
    say('                                   in-run and for free. Small sample; not a substitute for the floor.');
    const floorLine = floor.cold
        ? `  cold self-noise floor   ${String(floor.cold.idDiffs).padStart(6)}   ${pct(floor.cold.idDiffs, floor.cold.comparable)} of ${floor.cold.comparable} (receipt ${floor.cold.ranAt})`
        : '  cold self-noise floor   UNMEASURED for this population — see the banner below';
    say(floorLine);
    if (floor.warm) {
        say(`  warm self-noise floor   ${String(floor.warm.idDiffs).padStart(6)}   ${pct(floor.warm.idDiffs, floor.warm.comparable)} of ${floor.warm.comparable}`);
    }
    if (!floor.cold) {
        say('');
        say('  !! UNMEASURED NOISE FLOOR !!');
        say('  The COLD side runs live retrieval (Typesense ties are broken by whatever comes');
        say('  back first) and, for text input, a live LLM segmenter. Probed twice it disagrees');
        say('  with ITSELF some of the time. Until `noise-floor --side cold` has run over THIS');
        say('  population, the divergence count above is signal plus noise with no way to');
        say('  separate them. Do not quote it as a divergence rate.');
    }

    say('');
    say('--------------------------------------------------------------------------------');
    say('GOLDEN BAND — the only thing that adjudicates WHICH side is right');
    say('--------------------------------------------------------------------------------');
    say(`  rows carrying a band    ${String(c.banded).padStart(6)}   of ${comparable} comparable`);
    say(`  both sides inside       ${String(c.bandBothIn).padStart(6)}`);
    say(`  both sides outside      ${String(c.bandBothOut).padStart(6)}   (the band, or the pipeline, is wrong for both)`);
    say(`  BAND CROSSED            ${String(c.bandCrossed).padStart(6)}   ${pct(c.bandCrossed, c.banded)} of banded — exactly one side inside`);
    say(`    warm inside only      ${String(c.warmOnlyIn).padStart(6)}   the CACHE is right and the pipeline is wrong`);
    say(`    cold inside only      ${String(c.coldOnlyIn).padStart(6)}   the PIPELINE is right and the cache is wrong`);

    const crossers = rows.filter(r => bandVerdict(r).crossed);
    if (crossers.length) {
        say('');
        say('  every band crossing, in full:');
        for (const r of crossers) {
            const bv = bandVerdict(r);
            say(`    ${r.line.id.padEnd(14)} ${r.line.query.slice(0, 40).padEnd(40)} `
                + `warm ${fmtG(r.warm.grams)} ${String(r.warm.foodId ?? '-').padEnd(20)} `
                + `cold ${fmtG(r.cold.grams)} ${String(r.cold.foodId ?? '-').padEnd(20)} `
                + `band [${r.line.band?.[0]},${r.line.band?.[1]}] inside=${bv.insideSide}`);
        }
    }

    say('');
    say('--------------------------------------------------------------------------------');
    say('DECOMPOSITION — one aggregate is not an answer');
    say('--------------------------------------------------------------------------------');
    printSubsets(say, 'by input shape (text = can reach the LLM segmenter)', decompose(rows, r => r.line.shape));
    printSubsets(say, 'by category', decompose(rows, r => r.line.category));

    say('');
    say('--------------------------------------------------------------------------------');
    if (verdict.code === 0) {
        say(`VERDICT: exit 0 — a real measurement over ${comparable} rows.`);
    } else {
        say(`VERDICT: exit ${verdict.code}`);
        say(`  ${verdict.reason}`);
    }
    if (c.warmCacheHits === 0) {
        say('  WARM SIDE WAS COLD — the receipt is stamped warmSideWasCold:true.');
    }
    say('--------------------------------------------------------------------------------');
}

function printSubsets(say: (s?: string) => void, title: string, subsets: Subset[]) {
    say('');
    say(`  ${title}`);
    say(`    ${'subset'.padEnd(22)} ${'n'.padStart(5)} ${'idDiv'.padStart(6)} ${'rate'.padStart(6)} `
        + `${'banded'.padStart(6)} ${'cross'.padStart(6)} ${'rate'.padStart(6)} ${'coldOnly'.padStart(8)} ${'warmOnly'.padStart(8)}`);
    for (const s of subsets) {
        say(`    ${s.label.slice(0, 22).padEnd(22)} ${String(s.n).padStart(5)} ${String(s.identityDiverged).padStart(6)} `
            + `${pct(s.identityDiverged, s.n)} ${String(s.banded).padStart(6)} ${String(s.bandCrossed).padStart(6)} `
            + `${pct(s.bandCrossed, s.banded)} ${String(s.coldOnlyIn).padStart(8)} ${String(s.warmOnlyIn).padStart(8)}`);
    }
}

function fmtG(g: number | null): string {
    return (g == null ? 'null' : g.toFixed(1)).padStart(7) + 'g';
}

/**
 * Re-render a run receipt that is already on disk, against whatever noise-floor
 * receipts exist NOW.
 *
 * This mode exists because of an ordering trap that is otherwise unavoidable. A run
 * must be taken against the cache AS FOUND, so it goes first; the floor costs a
 * second full pass, so it goes second. That leaves the expensive run permanently
 * printing "UNMEASURED FLOOR" even after the floor has been measured, and re-running
 * it to fix the banner would both cost another population pass AND change the
 * numbers. `report` re-prints the same rows against the now-known floor, for free.
 *
 * It RECOMPUTES the counts and the exit verdict from the stored rows rather than
 * echoing the stored ones, so a receipt cannot carry a stale or hand-edited verdict
 * past this mode.
 */
export function parseRunReceipt(j: any): { rows: Row[]; skips: Skip[]; populationDesc: string; base: string } {
    const rows: Row[] = (j?.rows ?? []).map((r: any) => ({
        line: {
            id: r.id, query: r.query, shape: r.shape, category: r.category,
            band: r.band ?? null, knownIssue: !!r.knownIssue,
        },
        warm: r.warm, cold: r.cold,
    }));
    return {
        rows,
        skips: j?.skips ?? [],
        populationDesc: j?.population ?? '(unrecorded)',
        base: j?.base ?? '(unrecorded)',
    };
}

export function runReport(receiptPath: string, log?: (s: string) => void): { code: 0 | 1 | 2; lines: string[] } {
    const out: string[] = [];
    const say = (s = '') => { out.push(s); (log ?? console.log)(s); };
    const j = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const { rows, skips, populationDesc, base } = parseRunReceipt(j);
    const lines = rows.map(r => r.line);
    const fingerprint = populationFingerprint(lines);
    const counts = summarize(rows, skips, lines.length);
    const verdict = warmColdExitCode(counts, { allowUnwarmed: !!j?.allowUnwarmed });
    const ledger = readNoiseLedger(noiseReceiptPath(receiptPath));

    say('');
    say('================================================================================');
    say('WARM/COLD DIFF — RE-RENDER of a stored run (no probe was sent)');
    say('================================================================================');
    say(`receipt        ${receiptPath}`);
    say(`ran at         ${j?.ranAt ?? '(unrecorded)'}   base ${base}`);
    say(`population     ${populationDesc}`);
    say(`fingerprint    ${fingerprint}${j?.populationFingerprint && j.populationFingerprint !== fingerprint
        ? `   !! DOES NOT MATCH the stored ${j.populationFingerprint} — the receipt's rows were edited` : ''}`);

    printReport(say, rows, counts, verdict, {
        cold: findNoiseReceipt(ledger, 'cold', fingerprint),
        warm: findNoiseReceipt(ledger, 'warm', fingerprint),
    });
    return { code: verdict.code, lines: out };
}

// ============================================================
// 8. NOISE-FLOOR RUN
// ============================================================

export interface NoiseOptions {
    lines: PopLine[];
    populationDesc: string;
    side: Side;
    cfg: ProbeConfig;
    concurrency: number;
    outPath?: string;
    log?: (s: string) => void;
}

export async function runNoiseFloor(opts: NoiseOptions): Promise<{ code: 0 | 1 | 2; receipt: WcNoiseReceipt }> {
    const say = (s = '') => (opts.log ?? console.log)(s);
    const fingerprint = populationFingerprint(opts.lines);
    say('');
    say(`NOISE FLOOR — the ${opts.side.toUpperCase()} side probed TWICE over the same ${opts.lines.length} lines`);
    say(`  population ${opts.populationDesc}   fingerprint ${fingerprint}`);
    say('  This floor is EXPECTED to be non-zero on the cold side and ~0 on the warm side.');
    say('  It is not a bug: cold runs live retrieval and, for text input, a live LLM segmenter.');

    const serverBefore = opts.lines.length > 0 ? await fetchServerStamp(opts.cfg) : null;
    if (opts.lines.length > 0) {
        say(serverBefore
            ? `  server buildId ${serverBefore.buildId ?? '(unstamped)'}   pid ${serverBefore.pid ?? '?'}`
            : '  server !! /api/ok UNREADABLE — this floor is UNSTAMPED');
    }

    const pairs = await mapLimit(opts.lines, opts.concurrency, async (line) => {
        const a = await probe(line, opts.side, opts.cfg);
        const b = await probe(line, opts.side, opts.cfg);
        return { line, a, b };
    });

    const serverAfter = opts.lines.length > 0 ? await fetchServerStamp(opts.cfg) : null;
    const floorServerChanged = serverChanged(serverBefore, serverAfter);
    if (floorServerChanged === true) {
        say(`  !! SERVER CHANGED MID-RUN (${serverBefore!.buildId}/${serverBefore!.pid} -> ${serverAfter!.buildId}/${serverAfter!.pid}) — do not quote this floor.`);
    }

    let comparable = 0, idDiffs = 0, gramsDiffs = 0, itemCountDiffs = 0, tierDiffs = 0;
    const offenders: string[] = [];
    for (const p of pairs) {
        const d = selfDiff(p.a, p.b);
        if (!d.comparable) continue;
        comparable++;
        if (d.id) { idDiffs++; offenders.push(`${p.line.id}: ${p.a.foodId} -> ${p.b.foodId}`); }
        if (d.grams) gramsDiffs++;
        if (d.itemCount) itemCountDiffs++;
        if (d.tier) tierDiffs++;
    }

    const receipt: WcNoiseReceipt = {
        kind: 'warm-cold-diff/noise-floor', version: 1,
        ranAt: new Date().toISOString(),
        side: opts.side,
        population: opts.populationDesc,
        populationFingerprint: fingerprint,
        rows: pairs.length, comparable, idDiffs, gramsDiffs, itemCountDiffs, tierDiffs,
        server: { before: serverBefore, after: serverAfter, changedMidRun: floorServerChanged },
    };

    say('');
    say(`  rows ${receipt.rows}   comparable ${comparable}   idDiffs ${idDiffs}   `
        + `gramsDiffs ${gramsDiffs}   itemCountDiffs ${itemCountDiffs}   tierDiffs ${tierDiffs}`);
    for (const o of offenders.slice(0, 25)) say(`    ${o}`);
    if (offenders.length > 25) say(`    ... and ${offenders.length - 25} more`);

    // Zero comparable pairs is the same class B failure as everywhere else in this
    // file: a floor of "0" measured over nothing would clear a diff it never saw.
    if (comparable === 0) {
        say('');
        say(`  VOID: ZERO of ${pairs.length} lines answered twice, so the floor was measured over `
            + 'NOTHING. A "0" here would clear a diff this run never saw.');
        return { code: WC_VOID_EXIT, receipt };
    }

    if (opts.outPath) {
        const rp = noiseReceiptPath(opts.outPath);
        const ledger = readNoiseLedger(rp) ?? emptyNoiseLedger();
        ledger.receipts = ledger.receipts
            .filter(r => !(r.side === receipt.side && r.populationFingerprint === receipt.populationFingerprint))
            .concat(receipt);
        writeJsonAtomic(rp, ledger);
        say(`  receipt written: ${rp}`);
    }
    return { code: 0, receipt };
}

export function readNoiseLedger(p: string): WcNoiseLedger | null {
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')) as WcNoiseLedger; } catch { return null; }
}

function writeJsonAtomic(p: string, obj: unknown) {
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
    fs.renameSync(tmp, p);
}

// ============================================================
// 9. POPULATIONS
// ============================================================

export interface BuiltPopulation {
    lines: PopLine[];
    skips: Skip[];
    description: string;
}

/**
 * The 265 nlp golden cases, as lines.
 *
 * `item` cases post their own item object (the deterministic path); `text` cases
 * post the raw text (the segmenter path). A case with NEITHER is a malformed case
 * and is SKIPPED WITH A REASON rather than dropped — the whole point of the skip
 * ledger is that a shrinking denominator is visible.
 */
export function goldenPopulation(
    golden: { nlp?: any[] },
    opts: { grep?: string; limit?: number; includeKnownIssue?: boolean } = {},
): BuiltPopulation {
    const all: any[] = Array.isArray(golden?.nlp) ? golden.nlp : [];
    const lines: PopLine[] = [];
    const skips: Skip[] = [];
    for (const c of all) {
        if (opts.grep && !String(c.id ?? '').includes(opts.grep)) {
            skips.push({ id: c.id ?? '?', query: c.item?.rawText ?? c.text ?? '', reason: `--grep ${opts.grep} did not match` });
            continue;
        }
        if (c.knownIssue && opts.includeKnownIssue === false) {
            skips.push({ id: c.id, query: c.item?.rawText ?? c.text ?? '', reason: 'knownIssue case, excluded by --no-known-issue' });
            continue;
        }
        const hasItem = c.item && typeof c.item.rawText === 'string' && c.item.rawText.trim() !== '';
        const hasText = typeof c.text === 'string' && c.text.trim() !== '';
        if (!hasItem && !hasText) {
            skips.push({ id: c.id ?? '?', query: '', reason: 'golden case declares neither `item.rawText` nor `text`' });
            continue;
        }
        lines.push({
            id: c.id,
            query: hasItem ? c.item.rawText : c.text,
            shape: hasItem ? 'item' : 'text',
            category: c.category ?? 'uncategorized',
            band: Array.isArray(c.grams) && c.grams.length === 2 ? [c.grams[0], c.grams[1]] : null,
            knownIssue: !!c.knownIssue,
            ...(hasItem ? { item: c.item } : {}),
        });
    }
    if (opts.limit != null && lines.length > opts.limit) {
        for (const l of lines.slice(opts.limit)) {
            skips.push({ id: l.id, query: l.query, reason: `beyond --limit ${opts.limit}` });
        }
        lines.length = opts.limit;
    }
    return {
        lines, skips,
        description: `--golden (${lines.length} nlp cases${opts.grep ? `, grep ${opts.grep}` : ''}${opts.limit != null ? `, limit ${opts.limit}` : ''})`,
    };
}

/** One raw line per line of the file; blanks and #-comments ignored, and counted as skips. */
export function filePopulation(text: string, opts: { limit?: number } = {}): BuiltPopulation {
    const lines: PopLine[] = [];
    const skips: Skip[] = [];
    text.split('\n').forEach((raw, i) => {
        const t = raw.trim();
        if (!t) return;
        if (t.startsWith('#')) { skips.push({ id: `line${i + 1}`, query: t, reason: 'comment line' }); return; }
        lines.push({ id: `f${i + 1}`, query: t, shape: 'item', category: 'from-file', band: null });
    });
    if (opts.limit != null && lines.length > opts.limit) {
        for (const l of lines.slice(opts.limit)) skips.push({ id: l.id, query: l.query, reason: `beyond --limit ${opts.limit}` });
        lines.length = opts.limit;
    }
    return { lines, skips, description: `--from-file (${lines.length} lines)` };
}

/** Live FoodMapping keys, already cached by construction — the safe warm population. */
export function cachePopulation(
    rows: Array<{ normalizedForm: string; usedCount: number }>,
    order: string,
): BuiltPopulation {
    const lines: PopLine[] = [];
    const skips: Skip[] = [];
    for (const r of rows) {
        if (!r.normalizedForm || !r.normalizedForm.trim()) {
            skips.push({ id: r.normalizedForm ?? '?', query: '', reason: 'empty FoodMapping.normalizedForm' });
            continue;
        }
        lines.push({
            id: r.normalizedForm.slice(0, 40),
            query: r.normalizedForm,
            shape: 'item',
            category: 'foodmapping-key',
            band: null,
            usedCount: r.usedCount,
        });
    }
    return { lines, skips, description: `--from-cache order=${order} (${lines.length} live FoodMapping keys)` };
}

// ============================================================
// 10. CLI
// ============================================================

const HELP = `
warm-cold-diff.ts — replay one population BOTH ways and report the divergence.

MODES
  run           probe every line WARM and COLD, report identity / grams / tier /
                segmentation divergence and, where a golden band exists, which side
                is inside it
  noise-floor   probe ONE side TWICE and measure how much it disagrees with itself.
                Required before any divergence number from \`run\` can be quoted.
  report        re-render a stored run receipt (--run <file>) against whatever floor
                receipts exist now. Sends nothing; recomputes counts and the verdict
                from the stored rows rather than trusting the stored ones.
  help

POPULATION (exactly one)
  --golden                the nlp cases of scripts/eval/golden-set.json
  --from-cache            live FoodMapping keys  [--order used|recent|random]
  --from-file <path>      one raw ingredient line per line
  --limit <n>             cap the population (the excess is COUNTED as a skip)
  --grep <s>              --golden only: keep cases whose id contains <s>
  --no-known-issue        --golden only: exclude the 19 knownIssue cases

OPTIONS
  --base <url>            default http://192.168.1.133:3000
  --concurrency <n>       default 4
  --timeout <ms>          default 30000
  --out <path>            write the run receipt (and read/write the noise ledger)
  --side warm|cold        noise-floor only; default cold
  --allow-unwarmed        record an explicitly-cold-vs-cold run instead of VOIDing
  --dry-run               print the population and the requests; send nothing

EXIT  0 real measurement · 1 partial (some probes errored) · 2 VOID / bad invocation
`;

function argStr(argv: string[], name: string): string | undefined {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
}
function argInt(argv: string[], name: string): number | undefined {
    const v = argStr(argv, name);
    if (v == null) return undefined;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
}
function has(argv: string[], name: string): boolean { return argv.includes(`--${name}`); }

async function buildPopulationFromArgs(argv: string[]): Promise<BuiltPopulation> {
    const limit = argInt(argv, 'limit');
    const sources = ['golden', 'from-cache', 'from-file'].filter(s => has(argv, s));
    if (sources.length !== 1) {
        throw new Error(`exactly one population source required (--golden | --from-cache | --from-file), got ${sources.length}`);
    }
    if (has(argv, 'golden')) {
        const gp = argStr(argv, 'golden-set') ?? path.join(process.cwd(), 'scripts/eval/golden-set.json');
        const golden = JSON.parse(fs.readFileSync(gp, 'utf8'));
        return goldenPopulation(golden, {
            grep: argStr(argv, 'grep'),
            limit,
            includeKnownIssue: !has(argv, 'no-known-issue'),
        });
    }
    if (has(argv, 'from-file')) {
        const f = argStr(argv, 'from-file');
        if (!f) throw new Error('--from-file needs a path');
        return filePopulation(fs.readFileSync(f, 'utf8'), { limit });
    }
    // --from-cache: a read-only SELECT, the only DB access this script makes.
    const order = argStr(argv, 'order') ?? 'used';
    const take = limit ?? 200;
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    try {
        let rows: Array<{ normalizedForm: string; usedCount: number }>;
        if (order === 'random') {
            rows = await prisma.$queryRawUnsafe(
                'SELECT "normalizedForm", "usedCount" FROM "FoodMapping" ORDER BY random() LIMIT $1', take);
        } else {
            rows = await prisma.foodMapping.findMany({
                select: { normalizedForm: true, usedCount: true },
                orderBy: order === 'recent' ? { lastUsedAt: 'desc' } : { usedCount: 'desc' },
                take,
            });
        }
        return cachePopulation(rows, order);
    } finally {
        await prisma.$disconnect();
    }
}

export async function cli(argv: string[]): Promise<number> {
    const mode = argv[0];
    if (!mode || mode === 'help' || has(argv, 'help')) { console.log(HELP); return mode ? 0 : WC_VOID_EXIT; }
    if (mode === 'report') {
        const rp = argStr(argv, 'run');
        if (!rp) { console.error('VOID: report needs --run <receipt.json>'); return WC_VOID_EXIT; }
        return runReport(rp).code;
    }
    if (mode !== 'run' && mode !== 'noise-floor') {
        console.error(`unknown mode "${mode}"\n${HELP}`);
        return WC_VOID_EXIT;
    }

    const cfg: ProbeConfig = {
        base: argStr(argv, 'base') ?? process.env.EVAL_API_BASE ?? 'http://192.168.1.133:3000',
        apiKey: process.env.EVAL_API_KEY ?? process.env.DEV_API_KEY ?? '',
        timeoutMs: argInt(argv, 'timeout') ?? 30000,
    };
    const concurrency = argInt(argv, 'concurrency') ?? 4;
    const outPath = argStr(argv, 'out');

    let pop: BuiltPopulation;
    try {
        pop = await buildPopulationFromArgs(argv);
    } catch (e) {
        console.error(`VOID: ${(e as Error).message}`);
        return WC_VOID_EXIT;
    }

    if (mode === 'noise-floor') {
        const sideArg = argStr(argv, 'side') ?? 'cold';
        if (sideArg !== 'warm' && sideArg !== 'cold') {
            console.error('VOID: --side must be warm or cold');
            return WC_VOID_EXIT;
        }
        if (pop.lines.length === 0) {
            console.error('VOID: the population source produced ZERO lines — a floor over nothing is not a floor.');
            return WC_VOID_EXIT;
        }
        const { code } = await runNoiseFloor({
            lines: pop.lines, populationDesc: pop.description, side: sideArg,
            cfg, concurrency, outPath,
        });
        return code;
    }

    const res = await runWarmCold({
        lines: pop.lines, populationDesc: pop.description, skips: pop.skips,
        cfg, concurrency, outPath,
        allowUnwarmed: has(argv, 'allow-unwarmed'),
        dryRun: has(argv, 'dry-run'),
    });
    return res.code;
}

if (require.main === module) {
    cli(process.argv.slice(2))
        .then(c => process.exit(c))
        .catch(e => { console.error(e); process.exit(WC_VOID_EXIT); });
}
