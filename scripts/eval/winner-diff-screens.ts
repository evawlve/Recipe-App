/**
 * winner-diff-screens.ts — the PURE half of the frozen-pool winner-diff harness.
 * ==========================================================================
 * Everything in this file is a pure function of its arguments: no database, no
 * network, no filesystem, no `src/lib` import that constructs a PrismaClient.
 * That is deliberate and load-bearing.
 *
 * WHY THE SPLIT EXISTS
 * `scripts/` used to be entirely untestable (memory: eval-harness-blindness — the
 * abstention hole in run-eval.ts survived for months because importing the script
 * ran a full eval). The runner (`winner-diff.ts`) must load `src/lib/mapping/*`
 * with forced env flags and a live Prisma client; the moment a test imports that,
 * it needs the box. So the verdict table, the screens, the population parsers and
 * the noise-floor receipt gate — every part with a right and a wrong answer — live
 * here, and `__tests__/winner-diff.test.ts` pins them against fixtures.
 *
 * READ-ONLY: this file performs no I/O of any kind.
 *
 * OPEN WIRING REQUIREMENT (2026-07-26). winner-diff.ts's reportGoldenBands() still
 * prints only the cases whose VERDICT differs between A and B, and falls back to the
 * line "no golden case changed verdict". With grams/total/expectItems now correctly
 * reported as UNKNOWN (see THE HONEST LIMIT in section 6), most cases are UNKNOWN on
 * BOTH sides, so that comparison stays quiet and the clearance line remains exactly as
 * misleading as it was. It must be replaced with:
 *     sayAll(formatGoldenScreen(runGoldenScreen(cases, A.rows, B.rows)));
 * which prints the coverage table and the moved-winner-behind-an-unjudged-band list.
 * Until that one line lands, DO NOT quote the runner's golden clearance line.
 */

import { matchesAlt, textOf } from './assertions';

// ============================================================
// 1. Wire types — shared with winner-diff.ts, kept here so tests need no runner
// ============================================================

export type SelectionPath =
    /** confidenceGate returned skipAiRerank+selected: simpleRerank NEVER RAN. */
    | 'confidence_gate_early_exit'
    /** VARIANT ONLY (gate-backstop): rerank declined, the gate's pick was used as a backstop. */
    | 'confidence_gate_backstop'
    | 'rerank'
    | 'scored_by_confidence'
    | 'no_winner_rerank_declined'
    | 'no_winner_all_filtered'
    | 'no_winner_no_candidates'
    /** the snapshot row itself errored — excluded from every screen */
    | 'snapshot_failed'
    | 'replay_error';

export interface PanelLike {
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
    per100g: boolean;
}

export interface WinnerInfo {
    foodId: string;
    foodName: string;
    brandName: string | null;
    source: string;
    kcalPer100g: number | null;
    /**
     * FULL macro panel, never kcal alone. A name-only comparison in an earlier
     * session called a protein-halving swap "lateral"; identity plus one number
     * is not enough to adjudicate a winner change.
     */
    panel: PanelLike | null;
    confidence: number;
    selectionReason: string;
    /** index in `filtered` (GATHER order) — >= 10 means it was outside slice(0,10) */
    indexInFiltered: number;
    /** Positional: index in `filtered` < 10. NOT window membership — the rerank
     *  window is lane-composed, so use `inRerankWindow` for "reached the reranker". */
    inTop10: boolean;
    inRerankWindow: boolean;
}

export interface PoolLadder {
    gather: number;
    afterTokenFilter: number;
    afterCoreToken: number;
    afterZeroMacro: number;
    afterPlausibility: number;
    afterDenylist: number;
    /** final `filtered.length` fed to the sort / gate / rerank */
    admitted: number;
    /** candidatesForRerank.length */
    rerankWindow: number;
}

export interface CounterfactualInfo {
    path: SelectionPath;
    rerankWindow: number;
    rerankWindowIds: string[];
    rerankReason?: string;
    winner: WinnerInfo | null;
    notes: string[];
}

/**
 * What the SERVING stage billed, once a winner exists.
 *
 * Populated only under `replay --with-serving`. It exists because the harness
 * used to stop at winner selection, and that blind spot passed a green gate on a
 * change that made the user's number WORSE: PR #173 moved `mac and cheese` onto
 * the correct record and the billed total went 90.4 -> 39.5 kcal against a true
 * ~400, because the 28g serving anchor never moved. A winner diff cannot see
 * that. This can.
 */
export interface ServingInfo {
    /** grams billed for the parsed quantity, or null when the stage produced nothing */
    grams: number | null;
    /** cascade branch that billed the grams — 'bare_category_default', 'fs_label_count', … */
    servingTier: string | null;
    servingDescription: string | null;
    /** kcal the user is actually shown — the number every under-bill report quotes */
    totalKcal: number | null;
    /**
     * True when the grams came from an AI estimator. Those tiers are not
     * deterministic across replays, so the diff reports them in their own bucket
     * rather than counting them as movement your change caused.
     */
    aiTouched: boolean;
    /** the serving stage threw — the row is UNJUDGEABLE, which is not the same as unchanged */
    error?: string;
}

export interface ReplayRow {
    query: string;
    /** population tag, so a report can separate real user lines from warmer keys */
    origin?: QueryOrigin;
    /** golden-set case id when the population came from --golden */
    goldenId?: string;
    path: SelectionPath;
    relaxedRecovery: boolean;
    pool: PoolLadder;
    rerankWindowIds: string[];
    /** every id in `filtered` at admission time, in GATHER order */
    admittedIds: string[];
    /** false ⇒ no rerank window was ever built (NOT "the window was empty") */
    rerankRan: boolean;
    gate: { skipAiRerank: boolean; reason: string; confidence: number };
    rerankReason?: string;
    winner: WinnerInfo | null;
    /**
     * The grams/kcal the winner was actually billed at.
     *   undefined ⇒ the serving stage was never run (no --with-serving)
     *   null      ⇒ it ran and produced no result (no winner, or the builder returned null)
     * The distinction matters: a diff must refuse to compare a stage that never
     * ran, and must NOT read that as "serving unchanged".
     */
    serving?: ServingInfo | null;
    /** present only when the gate pre-empted: what simpleRerank would have picked */
    counter?: CounterfactualInfo;
    counterMicros?: number;
    notes: string[];
    error?: string;
}

export interface ReplayFile {
    kind: 'winner-diff/replay';
    version: 1;
    label: string;
    /** which transcribed selection variant produced these rows */
    variant: string;
    ranAt: string;
    gitHead: string;
    /**
     * SHA over every .ts in src/lib/mapping — NOT `git diff`. A/B trees are
     * routinely plain copies with no .git at all, so `git rev-parse` cannot
     * identify the code under test. Two replays with the same gitDirty provably
     * ran the same mapping code; that is exactly the property the noise floor needs.
     */
    gitDirty: string;
    snapshotTakenAt: string;
    snapshotPopulation: string;
    /**
     * The snapshot file this replay was produced from. Recorded so `diff` can find
     * the noise-floor ledger by construction instead of guessing at it — the guess
     * only worked when a directory held exactly one snapshot, so every gate run
     * with both a cold and a regression population misresolved it.
     */
    snapshotPath?: string;
    callerHash: string;
    helpersHash: string;
    /** true when `--with-serving` ran the serving stage and populated row.serving */
    withServing?: boolean;
    rows: ReplayRow[];
}

// ============================================================
// 2. Verdicts
// ============================================================

export type Verdict =
    | 'SAME'
    | 'WINNER-CHANGED'
    | 'NOWINNER->WINNER'
    | 'WINNER->NOWINNER'
    | 'PATH-CHANGED'
    | 'ERROR';

export const VERDICTS: readonly Verdict[] = [
    'SAME', 'WINNER-CHANGED', 'NOWINNER->WINNER', 'WINNER->NOWINNER', 'PATH-CHANGED', 'ERROR',
];

/**
 * The measurement this whole harness exists to produce: did the WINNER move?
 *
 * Deliberately NOT a set comparison over pools. Four downstream consumers are
 * non-monotone in pool size (slice(0,10) over gather order; relaxed recovery gated
 * on length===0; basic_produce_bypass returning candidates[0]; brand macro-consensus
 * gated on siblings.length>=3), so "the pool only grew" says nothing about the answer.
 * A pool-set Jaccard is the measurement that makes those bugs invisible.
 */
export function classifyVerdict(a: ReplayRow, b: ReplayRow): Verdict {
    if (a.path === 'replay_error' || b.path === 'replay_error'
        || a.path === 'snapshot_failed' || b.path === 'snapshot_failed') return 'ERROR';
    if (!a.winner && b.winner) return 'NOWINNER->WINNER';
    if (a.winner && !b.winner) return 'WINNER->NOWINNER';
    if (a.winner && b.winner && a.winner.foodId !== b.winner.foodId) return 'WINNER-CHANGED';
    if (a.path !== b.path || a.relaxedRecovery !== b.relaxedRecovery) return 'PATH-CHANGED';
    return 'SAME';
}

// ============================================================
// 3b. THE SERVING VERDICT  (blind spot (B), closed 2026-07-27)
// ============================================================

export type ServingVerdict =
    /** both sides billed the same grams (within FP tolerance) */
    | 'SERVING-SAME'
    /** grams moved — the only verdict that changes what the user is billed */
    | 'GRAMS-CHANGED'
    /** same grams, different cascade branch: no user-visible change TODAY, but the
     *  provenance moved, and a tier is what the next fix will target */
    | 'TIER-CHANGED'
    | 'NOSERVING->SERVING'
    | 'SERVING->NOSERVING'
    /** at least one side came from an AI estimator — not deterministic, not judgeable */
    | 'AI-NONDETERMINISTIC'
    /** the stage did not run on one or both sides, or it threw */
    | 'UNJUDGED';

export const SERVING_VERDICTS: readonly ServingVerdict[] = [
    'SERVING-SAME', 'GRAMS-CHANGED', 'TIER-CHANGED',
    'NOSERVING->SERVING', 'SERVING->NOSERVING', 'AI-NONDETERMINISTIC', 'UNJUDGED',
];

/** Grams are floats off a cascade of multiplications; 0.01g is not a change. */
const GRAMS_EPSILON = 0.01;

/**
 * Did the number the USER IS BILLED move?
 *
 * `UNJUDGED` is returned whenever the stage did not run on both sides, and that
 * is load-bearing: the failure this verdict exists to prevent is reading silence
 * as safety. A replay taken without --with-serving has `serving === undefined`,
 * and calling that SERVING-SAME would reproduce the exact blind spot that let a
 * green gate ship a worse billed number.
 */
export function classifyServing(a: ReplayRow, b: ReplayRow): ServingVerdict {
    const sa = a.serving;
    const sb = b.serving;
    if (sa === undefined || sb === undefined) return 'UNJUDGED';
    if (sa?.error || sb?.error) return 'UNJUDGED';
    if (sa?.aiTouched || sb?.aiTouched) return 'AI-NONDETERMINISTIC';

    const ga = sa?.grams ?? null;
    const gb = sb?.grams ?? null;
    if (ga == null && gb == null) return 'SERVING-SAME';
    if (ga == null) return 'NOSERVING->SERVING';
    if (gb == null) return 'SERVING->NOSERVING';
    if (Math.abs(ga - gb) > GRAMS_EPSILON) return 'GRAMS-CHANGED';
    if ((sa?.servingTier ?? null) !== (sb?.servingTier ?? null)) return 'TIER-CHANGED';
    return 'SERVING-SAME';
}

/**
 * Percent change in the billed total. Signed: negative means the change made the
 * user's number SMALLER, which for an under-bill fix is the wrong direction and
 * is the single fact PR #173's report should have led with.
 */
export function billedKcalDeltaPct(a: ReplayRow, b: ReplayRow): number | null {
    const ka = a.serving?.totalKcal ?? null;
    const kb = b.serving?.totalKcal ?? null;
    if (ka == null || kb == null || ka === 0) return null;
    return (100 * (kb - ka)) / ka;
}

export interface ServingSummary {
    counts: Record<ServingVerdict, number>;
    /** rows whose billed grams moved, worst-magnitude first */
    moved: Array<{
        query: string;
        aGrams: number | null; bGrams: number | null;
        aTier: string | null; bTier: string | null;
        aKcal: number | null; bKcal: number | null;
        kcalDeltaPct: number | null;
    }>;
    /** rows the gate could not adjudicate — must be printed, never summarised away */
    unjudged: string[];
}

export function summariseServing(aRows: ReplayRow[], bRows: ReplayRow[]): ServingSummary {
    const byQ = new Map(bRows.map(r => [r.query, r]));
    const counts = Object.fromEntries(SERVING_VERDICTS.map(v => [v, 0])) as Record<ServingVerdict, number>;
    const moved: ServingSummary['moved'] = [];
    const unjudged: string[] = [];

    for (const a of aRows) {
        const b = byQ.get(a.query);
        if (!b) continue;
        const v = classifyServing(a, b);
        counts[v]++;
        if (v === 'UNJUDGED' || v === 'AI-NONDETERMINISTIC') unjudged.push(a.query);
        if (v === 'GRAMS-CHANGED' || v === 'NOSERVING->SERVING' || v === 'SERVING->NOSERVING') {
            moved.push({
                query: a.query,
                aGrams: a.serving?.grams ?? null, bGrams: b.serving?.grams ?? null,
                aTier: a.serving?.servingTier ?? null, bTier: b.serving?.servingTier ?? null,
                aKcal: a.serving?.totalKcal ?? null, bKcal: b.serving?.totalKcal ?? null,
                kcalDeltaPct: billedKcalDeltaPct(a, b),
            });
        }
    }
    moved.sort((x, y) => Math.abs(y.kcalDeltaPct ?? 0) - Math.abs(x.kcalDeltaPct ?? 0));
    return { counts, moved, unjudged };
}

export function formatServingSummary(s: ServingSummary, top = 30): string[] {
    const out: string[] = [];
    const total = Object.values(s.counts).reduce((a, b) => a + b, 0);
    out.push('');
    out.push('=== SERVING DIFF — what the user is BILLED (winner-diff blind spot (B)) ===');
    if (total === 0) { out.push('  no comparable rows'); return out; }
    for (const v of SERVING_VERDICTS) {
        if (!s.counts[v]) continue;
        out.push(`  ${v.padEnd(22)} ${String(s.counts[v]).padStart(5)}  (${((100 * s.counts[v]) / total).toFixed(1)}%)`);
    }
    if (s.moved.length) {
        out.push('');
        out.push('  BILLED-NUMBER MOVERS  (worst kcal delta first)');
        for (const m of s.moved.slice(0, top)) {
            const d = m.kcalDeltaPct == null ? '   n/a' : `${m.kcalDeltaPct >= 0 ? '+' : ''}${m.kcalDeltaPct.toFixed(1)}%`;
            out.push(`    ${m.query}`);
            out.push(`      ${fmtG(m.aGrams)} ${m.aTier ?? '-'} ${fmtK(m.aKcal)}  ->  ${fmtG(m.bGrams)} ${m.bTier ?? '-'} ${fmtK(m.bKcal)}   kcal ${d}`);
        }
        if (s.moved.length > top) out.push(`    … and ${s.moved.length - top} more`);
    }
    if (s.unjudged.length) {
        out.push('');
        out.push(`  ${s.unjudged.length} row(s) UNJUDGED (stage not run, threw, or AI-estimated).`);
        out.push('  These are NOT evidence of no change. Listed so the count cannot be read as clearance:');
        for (const q of s.unjudged.slice(0, top)) out.push(`    ${q}`);
        if (s.unjudged.length > top) out.push(`    … and ${s.unjudged.length - top} more`);
    }
    return out;
}

function fmtG(g: number | null): string { return g == null ? '(none)' : `${g.toFixed(1)}g`; }
function fmtK(k: number | null): string { return k == null ? '(none)' : `${k.toFixed(0)}kcal`; }

/** Window ids present in A but not B, and vice versa. */
export function windowChurn(a: ReplayRow, b: ReplayRow): { evicted: string[]; added: string[] } {
    const aw = new Set(a.rerankWindowIds);
    const bw = new Set(b.rerankWindowIds);
    return {
        evicted: a.rerankWindowIds.filter(i => !bw.has(i)),
        added: b.rerankWindowIds.filter(i => !aw.has(i)),
    };
}

/**
 * "Any movement" — winner OR pool OR rerank window. Surfaces silent churn hiding
 * under an unchanged winner, which is the early-warning signal for a change that
 * is one candidate away from flipping something.
 */
export function rowHasMovement(a: ReplayRow, b: ReplayRow): boolean {
    if (classifyVerdict(a, b) !== 'SAME') return true;
    if (a.pool.admitted !== b.pool.admitted) return true;
    const churn = windowChurn(a, b);
    return churn.evicted.length > 0 || churn.added.length > 0;
}

/**
 * True when the rerank-window eviction line would be misleading: across a gate
 * flip the window was never BUILT on one side, so "evicted 10 ids" describes a
 * window that does not exist rather than candidates that lost a seat.
 */
export function windowChurnIsMeaningless(a: ReplayRow, b: ReplayRow): boolean {
    return a.rerankRan !== b.rerankRan;
}

// ============================================================
// 3. Histograms — path + gate reason, with the FIRING split
// ============================================================

export function counter<T extends string>(items: T[]): Array<[T, number]> {
    const m = new Map<T, number>();
    for (const it of items) m.set(it, (m.get(it) ?? 0) + 1);
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
}

export function pathHistogram(rows: ReplayRow[]): Array<[SelectionPath, number]> {
    return counter(rows.map(r => r.path));
}

/**
 * Gate-reason histogram, split by whether the gate ACTUALLY FIRED.
 *
 * THE TRAP THIS FIXES: confidenceGate is called on every row that reaches Step 3a
 * and its verdict string is recorded whether or not it pre-empted the reranker. A
 * flat histogram therefore reads `margin_too_small 2670` — which is 2,670 times the
 * gate DECLINED, not 2,670 firings. On the 4,165-row WARM population the real firing
 * count was 441 (308 high_confidence_clear_winner + 133 basic_produce_bypass), a 6x
 * misread. Firing is derived from `gate.skipAiRerank`, never from a hardcoded reason
 * list — `yeast_variant_preference` also fires and simply did not occur there.
 */
export function gateReasonHistogram(rows: ReplayRow[]): {
    firing: Array<[string, number]>;
    nonFiring: Array<[string, number]>;
    firingTotal: number;
    nonFiringTotal: number;
} {
    const norm = (r: ReplayRow) => (r.gate.reason || '(empty)').split(' (')[0];
    const fire = rows.filter(r => r.gate.skipAiRerank);
    const dont = rows.filter(r => !r.gate.skipAiRerank);
    return {
        firing: counter(fire.map(norm)),
        nonFiring: counter(dont.map(norm)),
        firingTotal: fire.length,
        nonFiringTotal: dont.length,
    };
}

// ============================================================
// 4. Screens
// ============================================================

/**
 * Food-class nouns. If the winner's NAME carries one of these and the QUERY never
 * used it, the pick has drifted to a different class of food ("subway cold cut
 * combo" -> "Cold Cut Combo SALAD", 15.7 vs 69.5 kcal/100g).
 *
 * This is a COMMITTED CONSTANT with a test, not a hand-edited literal in an ad-hoc
 * script — the scratch version was a 48-item list that lived only in a Python file
 * on one machine. Additions must keep the list to nouns that name a food CLASS;
 * adjectives and brand words belong nowhere near it.
 */
export const CLASS_NOUNS: readonly string[] = [
    'salad', 'jerky', 'mix', 'powder', 'soup', 'chips', 'bar', 'sandwich',
    'frittata', 'sauce', 'dressing', 'seasoning', 'flavored', 'flavour',
    'drink', 'juice', 'smoothie', 'shake', 'cookie', 'cake', 'pie',
    'bowl', 'wrap', 'burrito', 'pizza', 'ice cream', 'yogurt', 'candy',
    'crackers', 'cereal', 'bread', 'syrup', 'concentrate', 'extract',
    'spread', 'dip', 'kit', 'meal', 'dinner', 'nuggets', 'patties',
    'sticks', 'bites', 'roll', 'muffin', 'donut', 'pudding', 'jelly',
];

/** Atwater ratio (4P + 4C + 9F) / kcal. null when the panel cannot be checked. */
export function atwaterRatio(panel: PanelLike | null | undefined): number | null {
    if (!panel) return null;
    if (!panel.kcal || panel.kcal <= 0) return null;
    return (4 * panel.protein + 4 * panel.carbs + 9 * panel.fat) / panel.kcal;
}

export const ATWATER_BAND = 0.25;

export function atwaterInconsistent(panel: PanelLike | null | undefined): boolean {
    const r = atwaterRatio(panel);
    return r != null && Math.abs(r - 1) > ATWATER_BAND;
}

/** Food-class nouns present in the winner name that the query never used. */
export function extraClassNouns(query: string, name: string | null | undefined): string[] {
    const q = (query || '').toLowerCase();
    const n = (name || '').toLowerCase();
    return CLASS_NOUNS.filter(c => n.includes(c) && !q.includes(c));
}

/** Signed % change in kcal/100g from A's panel to B's panel. null when incomparable. */
export function kcalDeltaPct(a: WinnerInfo | null, b: WinnerInfo | null): number | null {
    if (!a || !b) return null;
    const pa = a.panel;
    const pb = b.panel;
    if (!pa || !pb) return null;
    if (!pa.kcal) return null;
    return (100 * (pb.kcal - pa.kcal)) / pa.kcal;
}

export const DELTA_THRESHOLDS: readonly number[] = [0, 5, 10, 20, 30, 50, 100, 200];

export interface DeltaHistogram {
    n: number;
    buckets: Array<{ threshold: number; count: number; pct: number }>;
    median: number | null;
    mean: number | null;
    max: number | null;
}

export function deltaHistogram(absDeltas: number[]): DeltaHistogram {
    const n = absDeltas.length;
    const buckets = DELTA_THRESHOLDS.map(t => {
        const count = absDeltas.filter(x => x > t).length;
        return { threshold: t, count, pct: n ? (100 * count) / n : 0 };
    });
    if (n === 0) return { n, buckets, median: null, mean: null, max: null };
    const sorted = [...absDeltas].sort((x, y) => x - y);
    const mid = Math.floor(n / 2);
    const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return {
        n,
        buckets,
        median,
        mean: absDeltas.reduce((s, x) => s + x, 0) / n,
        max: sorted[n - 1],
    };
}

export interface ScreenPair {
    query: string;
    a: WinnerInfo | null;
    b: WinnerInfo | null;
}

export interface ScreenResult {
    labelA: string;
    labelB: string;
    /** pairs where both sides picked something AND the picks differ */
    disagreements: number;
    aOnly: number;
    bOnly: number;
    neither: number;
    delta: DeltaHistogram;
    direction: { aLower: number; aHigher: number; equal: number };
    noPanel: { a: number; b: number };
    atwater: {
        comparable: number;
        onlyA: number;
        onlyB: number;
        both: number;
        rows: Array<{ query: string; side: 'A' | 'B'; ratioA: number; ratioB: number; nameA: string; nameB: string }>;
    };
    classDrift: {
        onlyA: number;
        onlyB: number;
        both: number;
        neither: number;
        worstA: Array<{ query: string; name: string; nouns: string[]; deltaPct: number | null; kcalA: number | null; kcalB: number | null }>;
        worstB: Array<{ query: string; name: string; nouns: string[]; deltaPct: number | null; kcalA: number | null; kcalB: number | null }>;
    };
}

/**
 * The four mechanical screens. NONE of them is an adjudicator on its own — on the
 * confidenceGate population the kcal direction split (117 A-lower / 114 A-higher)
 * and Atwater (6 / 4) were a wash, and only class drift (53 / 2) was asymmetric.
 * Print all four so a future reader can see which ones are washes rather than
 * being handed the one that happens to favour the change.
 */
export function runScreens(pairs: ScreenPair[], labelA = 'A', labelB = 'B'): ScreenResult {
    const dis: ScreenPair[] = [];
    let aOnly = 0;
    let bOnly = 0;
    let neither = 0;
    for (const p of pairs) {
        if (p.a && p.b) {
            if (p.a.foodId !== p.b.foodId) dis.push(p);
        } else if (p.a && !p.b) aOnly++;
        else if (!p.a && p.b) bOnly++;
        else neither++;
    }

    const signed = dis
        .map(p => kcalDeltaPct(p.a, p.b))
        .filter((x): x is number => x != null);
    const delta = deltaHistogram(signed.map(Math.abs));

    const direction = {
        aLower: signed.filter(x => x > 0).length,
        aHigher: signed.filter(x => x < 0).length,
        equal: signed.filter(x => x === 0).length,
    };

    const noPanel = {
        a: dis.filter(p => !p.a?.panel).length,
        b: dis.filter(p => !p.b?.panel).length,
    };

    let comparable = 0;
    let atOnlyA = 0;
    let atOnlyB = 0;
    let atBoth = 0;
    const atRows: ScreenResult['atwater']['rows'] = [];
    for (const p of dis) {
        const ra = atwaterRatio(p.a?.panel);
        const rb = atwaterRatio(p.b?.panel);
        if (ra == null || rb == null) continue;
        comparable++;
        const badA = Math.abs(ra - 1) > ATWATER_BAND;
        const badB = Math.abs(rb - 1) > ATWATER_BAND;
        if (badA && badB) atBoth++;
        else if (badA) {
            atOnlyA++;
            atRows.push({ query: p.query, side: 'A', ratioA: ra, ratioB: rb, nameA: p.a!.foodName, nameB: p.b!.foodName });
        } else if (badB) {
            atOnlyB++;
            atRows.push({ query: p.query, side: 'B', ratioA: ra, ratioB: rb, nameA: p.a!.foodName, nameB: p.b!.foodName });
        }
    }

    let cdOnlyA = 0;
    let cdOnlyB = 0;
    let cdBoth = 0;
    let cdNeither = 0;
    const listA: ScreenResult['classDrift']['worstA'] = [];
    const listB: ScreenResult['classDrift']['worstB'] = [];
    for (const p of dis) {
        const ea = extraClassNouns(p.query, p.a?.foodName);
        const eb = extraClassNouns(p.query, p.b?.foodName);
        const d = kcalDeltaPct(p.a, p.b);
        const rec = (name: string, nouns: string[]) => ({
            query: p.query,
            name,
            nouns,
            deltaPct: d,
            kcalA: p.a?.panel?.kcal ?? null,
            kcalB: p.b?.panel?.kcal ?? null,
        });
        if (ea.length && !eb.length) { cdOnlyA++; listA.push(rec(p.a!.foodName, ea)); }
        else if (eb.length && !ea.length) { cdOnlyB++; listB.push(rec(p.b!.foodName, eb)); }
        else if (ea.length && eb.length) cdBoth++;
        else cdNeither++;
    }
    const byDelta = (x: { deltaPct: number | null }, y: { deltaPct: number | null }) =>
        Math.abs(y.deltaPct ?? 0) - Math.abs(x.deltaPct ?? 0);
    listA.sort(byDelta);
    listB.sort(byDelta);

    return {
        labelA,
        labelB,
        disagreements: dis.length,
        aOnly,
        bOnly,
        neither,
        delta,
        direction,
        noPanel,
        atwater: { comparable, onlyA: atOnlyA, onlyB: atOnlyB, both: atBoth, rows: atRows },
        classDrift: { onlyA: cdOnlyA, onlyB: cdOnlyB, both: cdBoth, neither: cdNeither, worstA: listA, worstB: listB },
    };
}

export function formatScreens(s: ScreenResult, top = 30): string[] {
    const L: string[] = [];
    const A = s.labelA;
    const B = s.labelB;
    L.push('');
    L.push(`SCREENS over ${s.disagreements} disagreement(s)  ` +
        `[${A}-only-picked ${s.aOnly}, ${B}-only-picked ${s.bOnly}, neither-picked ${s.neither}]`);
    L.push('');
    L.push(`  |kcal/100g delta| over ${s.delta.n} pair(s) with BOTH panels present`);
    for (const b of s.delta.buckets) {
        L.push(`      >${String(b.threshold).padStart(3)}%  ${String(b.count).padStart(5)}  (${b.pct.toFixed(1)}%)`);
    }
    if (s.delta.n > 0) {
        L.push(`      median ${s.delta.median!.toFixed(1)}%   mean ${s.delta.mean!.toFixed(1)}%   max ${s.delta.max!.toFixed(1)}%`);
    }
    L.push(`  direction: ${A} lower than ${B} on ${s.direction.aLower} rows, ${A} higher on ${s.direction.aHigher} rows` +
        (s.direction.equal ? `, equal on ${s.direction.equal}` : ''));
    L.push(`      (a SYMMETRIC split adjudicates nothing — say so rather than quoting one side)`);
    L.push('');
    L.push(`  no-nutrition winner:  ${A} ${s.noPanel.a}   ${B} ${s.noPanel.b}`);
    L.push('');
    L.push(`  ATWATER  (4P+4C+9F)/kcal outside [${(1 - ATWATER_BAND).toFixed(2)}, ${(1 + ATWATER_BAND).toFixed(2)}] over ${s.atwater.comparable} comparable pairs`);
    L.push(`      only ${A} inconsistent: ${s.atwater.onlyA}      only ${B} inconsistent: ${s.atwater.onlyB}      both: ${s.atwater.both}`);
    L.push('');
    L.push('  CLASS-DRIFT  (winner name carries a food-class noun the query never used)');
    L.push(`      only ${A} drifts: ${s.classDrift.onlyA}      only ${B} drifts: ${s.classDrift.onlyB}      both: ${s.classDrift.both}      neither: ${s.classDrift.neither}`);
    for (const [side, list] of [[A, s.classDrift.worstA], [B, s.classDrift.worstB]] as const) {
        if (!list.length) continue;
        L.push('');
        L.push(`      worst ${Math.min(top, list.length)} ${side}-only class drifts (query | winner | extra nouns | kcal delta):`);
        for (const r of list.slice(0, top)) {
            const d = r.deltaPct == null ? '' : `${r.deltaPct >= 0 ? '+' : ''}${r.deltaPct.toFixed(0)}%`;
            L.push(`        ${r.query.slice(0, 44).padEnd(46)} | ${r.name.slice(0, 44).padEnd(46)} | ` +
                `${r.nouns.join(',').slice(0, 22).padEnd(24)} | ${d}  (${A} ${r.kcalA ?? '?'} -> ${B} ${r.kcalB ?? '?'})`);
        }
    }
    return L;
}

// ============================================================
// 5. Noise-floor receipts
// ============================================================

export interface NoiseFloorReceipt {
    kind: 'winner-diff/noise-floor';
    version: 1;
    ranAt: string;
    snapshotTakenAt: string;
    gitHead: string;
    gitDirty: string;
    variant: string;
    rows: number;
    winnerDiffs: number;
    pathDiffs: number;
    /**
     * Set only when the noise-floor run itself used --with-serving. A receipt
     * without it proves nothing about serving determinism, which is why
     * `noiseGate` refuses a serving-bearing diff that can only find one of these.
     */
    withServing?: boolean;
    /** grams/tier differences between two replays of the SAME tree — must also be 0 */
    servingDiffs?: number;
}

export interface NoiseFloorLedger {
    kind: 'winner-diff/noise-floor-ledger';
    version: 1;
    receipts: NoiseFloorReceipt[];
}

export function emptyLedger(): NoiseFloorLedger {
    return { kind: 'winner-diff/noise-floor-ledger', version: 1, receipts: [] };
}

export function findReceipt(
    ledger: NoiseFloorLedger | null,
    snapshotTakenAt: string,
    gitDirty: string,
    variant: string,
): NoiseFloorReceipt | null {
    if (!ledger) return null;
    const hits = ledger.receipts.filter(r =>
        r.snapshotTakenAt === snapshotTakenAt && r.gitDirty === gitDirty && r.variant === variant);
    if (!hits.length) return null;
    return hits.sort((x, y) => (x.ranAt < y.ranAt ? 1 : -1))[0];
}

export interface NoiseGateVerdict {
    ok: boolean;
    problems: string[];
    receiptA: NoiseFloorReceipt | null;
    receiptB: NoiseFloorReceipt | null;
}

/**
 * The gate that stops `diff` from reporting a number that means nothing.
 *
 * A diff is only a measurement if replaying the SAME variant twice on the SAME
 * snapshot produces zero winner changes — and that property is PER TREE, so both
 * sides need their own receipt. Two numbers are involved and they are NOT the same:
 *   replayNoise     same snapshot, same tree      MUST be 0 (this gate)
 *   retrievalNoise  DIFFERENT snapshots, same tree — is genuinely non-zero, and is
 *                   not a bug (Typesense/FatSecret return a different pool minutes
 *                   apart). A scratch log labelled a cross-snapshot run "the noise
 *                   floor. Expect 0 changed rows" and it was simply false.
 */
export function noiseGate(
    ledger: NoiseFloorLedger | null,
    a: ReplayFile,
    b: ReplayFile,
    opts: { crossSnapshot: boolean },
): NoiseGateVerdict {
    const problems: string[] = [];

    if (a.snapshotTakenAt !== b.snapshotTakenAt && !opts.crossSnapshot) {
        problems.push(
            `A and B replayed DIFFERENT snapshots (${a.snapshotTakenAt} vs ${b.snapshotTakenAt}). ` +
            'Retrieval nondeterminism is inside the signal. Re-replay both sides from ONE snapshot, ' +
            'or pass --cross-snapshot to accept a RETRIEVAL-NOISE-CONTAMINATED report.');
    }

    const ra = findReceipt(ledger, a.snapshotTakenAt, a.gitDirty, a.variant);
    const rb = findReceipt(ledger, b.snapshotTakenAt, b.gitDirty, b.variant);

    for (const [side, f, r] of [['A', a, ra], ['B', b, rb]] as const) {
        if (!r) {
            problems.push(
                `no noise-floor receipt for side ${side} (snapshot ${f.snapshotTakenAt}, ` +
                `tree ${f.gitDirty}, variant ${f.variant}). Run: winner-diff noise-floor ` +
                `--snapshot <snap.json> --variant ${f.variant}   FROM THAT TREE.`);
        } else if (r.rows === 0) {
            // A receipt over ZERO rows says nothing replayed, not that everything
            // replayed identically — `winnerDiffs !== 0 || pathDiffs !== 0` is
            // trivially false when no row was ever compared. An empty snapshot
            // (`--from-events` matching no MappingEventLog rows) therefore wrote a
            // PASSING receipt and licensed a diff run with no floor under it.
            problems.push(
                `side ${side} noise-floor receipt covers ZERO rows (snapshot ${f.snapshotTakenAt}, ` +
                `variant ${f.variant}). Nothing was replayed, so "0 differences" is an absence of ` +
                'measurement, not determinism. Re-take the floor against a non-empty snapshot.');
        } else if (r.winnerDiffs !== 0 || r.pathDiffs !== 0) {
            problems.push(
                `side ${side} noise floor is NON-ZERO (${r.winnerDiffs} winner / ${r.pathDiffs} path ` +
                `differences over ${r.rows} rows). The replay is not deterministic on this tree; ` +
                'any diff number below would be noise plus signal with no way to separate them.');
        } else if (f.withServing && !r.withServing) {
            // A winner-only receipt says nothing about whether the SERVING stage
            // replays deterministically. Accepting it would let a serving diff be
            // reported with no floor under it — the same "silence read as safety"
            // failure the serving stage was added to prevent.
            problems.push(
                `side ${side} replayed WITH the serving stage but its noise-floor receipt was ` +
                'taken WITHOUT it. Re-run: winner-diff noise-floor --snapshot <snap.json> ' +
                '--with-serving   FROM THAT TREE.');
        } else if (f.withServing && r.servingDiffs !== 0) {
            problems.push(
                `side ${side} SERVING noise floor is NON-ZERO (${r.servingDiffs} grams/tier ` +
                `differences over ${r.rows} rows). Serving resolution is not deterministic on ` +
                'this tree, so no billed-number claim below it is a result.');
        }
    }

    return { ok: problems.length === 0, problems, receiptA: ra, receiptB: rb };
}

// ============================================================
// 6. Populations
// ============================================================

export type QueryOrigin = 'user' | 'warmer';

export interface PopulationLine {
    query: string;
    origin: QueryOrigin;
    /** occurrences in the source table, when the source provides one */
    count?: number;
    goldenId?: string;
}

/** Newline list; `#` comments and blank lines dropped. */
export function parseQueryFile(text: string): string[] {
    return text.split('\n').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('#'));
}

/** True when the tokens are already in ascending order (>= 2 tokens required). */
export function isTokenSorted(s: string): boolean {
    const toks = s.trim().split(/\s+/).filter(Boolean);
    if (toks.length < 2) return false;
    for (let i = 1; i < toks.length; i++) {
        if (toks[i - 1] > toks[i]) return false;
    }
    return true;
}

/**
 * HEURISTIC origin tag. `cache-parity-sweep.ts` posts `100g ${name}` where `name`
 * is a token-SORTED FoodMapping key, so a third of MappingEventLog is our own
 * warmer wearing user-traffic clothes ("100g debbie little roll swiss"). Word order
 * is signal in this pipeline (deriveMustHaveTokens is order-sensitive), so scrambled
 * keys exercise different filters than sentences users type — a rate computed over
 * the raw event log is a rate over a mixed distribution.
 *
 * IT IS A HEURISTIC AND IT UNDERCOUNTS. Measured over the real 4,165-line event
 * population (scratchpad/zz-cg-harm-popALL.txt):
 *     `^100g ` prefix alone        1297  (31.1%)
 *     this function ('warmer')      957  (23.0%)
 *     prefixed but tagged 'user'    340
 * Most of that 340 is SINGLE-TOKEN keys — "100g honey", "100g salt" — which
 * `isTokenSorted` refuses to call sorted because one token is no evidence of
 * anything. Those really are warmer lines, so 23.0% is a FLOOR on contamination,
 * not an estimate of it. In the other direction, a genuine user line that happens
 * to be alphabetical is tagged 'warmer'. Report the split; never silently drop rows
 * on it, and never quote either number as "the" warmer share.
 */
export function classifyOrigin(line: string): QueryOrigin {
    const m = line.match(/^100g\s+(.*)$/i);
    if (!m) return 'user';
    return isTokenSorted(m[1]) ? 'warmer' : 'user';
}

export function originSplit(lines: string[]): { user: number; warmer: number; warmerPct: number } {
    const warmer = lines.filter(l => classifyOrigin(l) === 'warmer').length;
    return {
        user: lines.length - warmer,
        warmer,
        warmerPct: lines.length ? (100 * warmer) / lines.length : 0,
    };
}

// ---- golden set --------------------------------------------------------

/**
 * Every assertion kind `run-eval.ts` supports on an `nlp` case.
 *
 * THIS LIST IS THE FIX FOR THE WORST DEFECT THIS HARNESS HAS HAD. `GoldenCase`
 * used to carry `expectName` and `macros` and NOTHING ELSE, so `checkGoldenBands`
 * printed "no golden case changed verdict" while it could not see the assertion
 * type the corpus is mostly made of. Re-derived from scripts/eval/golden-set.json
 * on 2026-07-26 over all 243 nlp cases (`search` cases are a different runner and
 * are not screened here):
 *
 *     expectName     243  (100.0%)  — every case
 *     grams          148  ( 60.9%)  <-- the majority assertion, previously INVISIBLE
 *     macros          59  ( 24.3%)
 *     expectItems     47  ( 19.3%)  — all 47 are `text`-shaped
 *     total           18  (  7.4%)  <-- previously INVISIBLE
 *     forbidName       0            — documented in _readme, no live case uses it
 *     expectAbstain    0            —      "
 *     maxConfidence    0            —      "
 *     cases with no assertion at all: 0
 *     cases with a name but NO numeric band: 47   (= the 47 in the _readme)
 *
 * Split by shape, because `--golden` replays only `item` cases unless
 * `--include-multi-item` is passed:
 *     item-shaped 160:  grams 117, macros 43, total  7, expectItems  0
 *     text-shaped  83:  grams  31, macros 16, total 11, expectItems 47
 *
 * forbidName/expectAbstain/maxConfidence are parsed and evaluated anyway. They
 * cost nothing to support and the corpus has carried them before (n-mq-38..42 held
 * a forbidName that was removed on 2026-07-26 because enumerating wrong brands only
 * ever excludes the wrong answers you have already seen). A screen that only knows
 * the assertions in today's file is one commit away from being blind again.
 */
export type GoldenBandKind =
    | 'expectName'
    | 'forbidName'
    | 'expectAbstain'
    | 'maxConfidence'
    | 'expectItems'
    | 'macros'
    | 'grams'
    | 'total';

export const GOLDEN_BAND_KINDS: readonly GoldenBandKind[] = [
    'expectName', 'forbidName', 'expectAbstain', 'maxConfidence', 'expectItems', 'macros', 'grams', 'total',
];

/**
 * ============================================================================
 * THE HONEST LIMIT — read this before quoting anything this screen prints.
 * ============================================================================
 * A frozen-pool replay selects a WINNER. It re-runs the mapper's Step 3a/Step 4
 * selection over a recorded candidate pool and stops there. It does NOT run:
 *
 *   - serving resolution (`resolveServing` / simple-serving-estimator / the unit
 *     heuristics at map-ingredient-with-fallback.ts:3209+), which is what produces
 *     `grams`;
 *   - the grams -> nutrition scaling (`const scale = mapped.grams / 100`,
 *     route.ts:375), which is what produces the billed `nutrition` block;
 *   - the post-selection sanity check (MAX_REASONABLE_GRAMS / MAX_REASONABLE_KCAL,
 *     mapper :3063) which can turn a selected winner into a no-pick;
 *   - the LLM segmenter, which is what produces more than one item.
 *
 * Therefore `grams`, `total` and `expectItems` are NOT EVALUABLE from a replay,
 * and this file reports them as such — never as a satisfied band. They are not
 * derivable either: `WinnerInfo` carries identity, source, confidence and a macro
 * panel, and no serving/portion rows at all. Making `grams` evaluable is a RUNNER
 * change (winner-diff.ts would have to record the winner's serving rows and run the
 * resolver), not something this pure module can fake.
 *
 * And the blindness is not academic. Of the 117 item-shaped `grams` cases, exactly
 * 3 use an explicit weight unit (`g` x2, `oz` x1) whose grams are fixed by the
 * parsed quantity regardless of which record wins. The other 114 resolve their
 * grams FROM THE WINNER RECORD's serving data — so a winner change is precisely the
 * event that moves them, and precisely the event this screen could not see.
 */
export const REPLAY_BLIND_BANDS: Readonly<Record<string, string>> = {
    grams: 'grams comes from serving resolution, which runs AFTER winner selection; the replay stops at selection',
    total: 'total = per-100g panel x grams/100, and grams is not resolved by a replay',
    expectItems: 'item count comes from the LLM segmenter, which a single-query replay never runs',
};

/** The only per-100g keys a replay `PanelLike` can answer. A band on any other key is blind. */
export const MEASURABLE_MACRO_KEYS: readonly string[] = ['kcal100', 'protein100', 'carbs100', 'fat100'];

/**
 * Mirrors `isWeightUnit` at map-ingredient-with-fallback.ts:2410. Volume units
 * (cup/tbsp/tsp) are deliberately absent: their grams go through a density that is
 * itself record-dependent, so they are not "fixed by the quantity".
 */
const WEIGHT_UNIT_RE = /^(g|gram|grams|oz|ounce|ounces|lb|lbs|pound|pounds|kg|kilogram|kilograms)$/i;

export interface GoldenCase {
    id: string;
    category: string;
    rawText: string;
    /** alternatives; each alternative is a list of required substrings (AND within, OR across) */
    expectName: string[][];
    /** same shape as expectName; run-eval FAILS if any returned item matches */
    forbidName?: string[][];
    /** the mapper is required to produce no confident pick */
    expectAbstain?: boolean;
    /** it may guess, but must not look authoritative enough to cache */
    maxConfidence?: number;
    /** minimum number of segmented items */
    expectItems?: number;
    /** band on items[0].nutritionPer100g */
    macros?: Record<string, [number, number]>;
    /** band on items[0].grams — the RESOLVED serving weight */
    grams?: [number, number];
    /** band on items[0].nutrition — the BILLED totals for the requested quantity */
    total?: Record<string, [number, number]>;
    knownIssue?: boolean;
    /** 'item' = single-ingredient case; 'text' = multi-item line meant for the segmenter */
    shape: 'item' | 'text';
    /** item.unit as written in the case, when there is one */
    unit?: string;
    /** item.quantity as written in the case, when there is one */
    quantity?: number;
    /**
     * True for a `text` case that /api/nlp/parse resolves WITHOUT the segmenter.
     * See isDeterministicSingleItemText — for these a one-query replay is faithful;
     * for the rest it is a different function and every band is blind.
     *
     * OPTIONAL, and the default is the CONSERVATIVE one (see isSingleIngredientCase):
     * a hand-built `text` case that does not say is treated as segmenter-bound, i.e.
     * unjudgeable. parseGoldenSet always sets it explicitly.
     */
    deterministicSingleItem?: boolean;
}

const MEAL_SUFFIX_RE = /\s*(?:for|at|as)\s+(breakfast|lunch|dinner|snacks?)\s*\.?\s*$/i;
const MULTI_ITEM_SIGNALS_RE = /[,;\n+&]|\b(?:and|with|plus)\b/i;

/**
 * Byte-for-byte mirror of `singleItemFromText` (src/app/api/nlp/parse/route.ts:29-45).
 *
 * WHY IT MATTERS HERE: a `text` case does not automatically mean "the segmenter ran".
 * The route short-circuits short, separator-free lines straight to one
 * mapIngredientWithFallback call — which is exactly what a replay does — so
 * "7up", "2 7up" and "three slices of bacon" ARE faithfully reproduced by a
 * single-query replay, while "2 eggs and toast" is not. Blanket-marking every
 * `text` case unevaluable would be as dishonest in the other direction as the
 * silent pass this file exists to remove.
 *
 * If the route's rule changes, this must change with it. It is pinned by a test.
 */
export function isDeterministicSingleItemText(text: string): boolean {
    const trimmed = (text ?? '').trim();
    if (trimmed.length === 0 || trimmed.length > 60) return false;
    let rawText = trimmed;
    const mealMatch = trimmed.match(MEAL_SUFFIX_RE);
    if (mealMatch) rawText = trimmed.slice(0, mealMatch.index).trim();
    if (rawText.length === 0 || MULTI_ITEM_SIGNALS_RE.test(rawText)) return false;
    if (rawText.split(/\s+/).length > 6) return false;
    return true;
}

/**
 * Is one mapIngredientWithFallback call over this case's raw text the same function
 * the real eval runs? Defaults to `shape === 'item'` when the case does not say —
 * the conservative direction, because being wrong here in the other direction means
 * reporting a judged verdict for a case the replay never actually reproduced.
 */
export function isSingleIngredientCase(c: GoldenCase): boolean {
    return c.deterministicSingleItem ?? (c.shape === 'item');
}

/** Every assertion kind this case actually carries, in a stable order. */
export function assertedBands(c: GoldenCase): GoldenBandKind[] {
    const out: GoldenBandKind[] = [];
    if (c.expectName && c.expectName.length > 0) out.push('expectName');
    if (c.forbidName && c.forbidName.length > 0) out.push('forbidName');
    if (c.expectAbstain) out.push('expectAbstain');
    if (typeof c.maxConfidence === 'number') out.push('maxConfidence');
    if (typeof c.expectItems === 'number') out.push('expectItems');
    if (c.macros && Object.keys(c.macros).length) out.push('macros');
    if (c.grams) out.push('grams');
    if (c.total && Object.keys(c.total).length) out.push('total');
    return out;
}

/**
 * Bands this case can NEVER be judged on from a replay, independent of which
 * winner came back. Winner-dependent gaps (a winner with no per-100g panel) are
 * NOT here — those are decided per winner inside checkGoldenBands.
 */
export function structurallyBlindBands(c: GoldenCase): GoldenBandKind[] {
    const asserted = assertedBands(c);
    // A `text` case that the route hands to the LLM segmenter is a different
    // function from the one a replay runs. Nothing about it is evaluable here.
    if (!isSingleIngredientCase(c)) return asserted;
    return asserted.filter(k => {
        if (k in REPLAY_BLIND_BANDS) return true;
        if (k === 'macros') {
            return Object.keys(c.macros ?? {}).every(key => !MEASURABLE_MACRO_KEYS.includes(key));
        }
        return false;
    });
}

/** True when the case's grams band is fixed by the parsed quantity rather than by the record. */
export function gramsBandIsRecordIndependent(c: GoldenCase): boolean {
    return !!c.grams && !!c.unit && WEIGHT_UNIT_RE.test(c.unit);
}

/**
 * golden-set.json is an OBJECT `{_readme, search[], nlp[]}`, not an array — reading
 * it as an array yields nothing and the population silently becomes empty.
 *
 * Only `nlp` cases are usable here, and by default only those with `item.rawText`:
 * a `text` case is a multi-ingredient line whose real path goes through the LLM
 * segmenter in /api/nlp/parse, not through one mapIngredientWithFallback call.
 * Passing includeMultiItem accepts them anyway, and the caller must say so in-band.
 */
export function parseGoldenSet(raw: unknown, opts: { includeMultiItem?: boolean } = {}): GoldenCase[] {
    const root = raw as { nlp?: unknown[] } | null;
    if (!root || !Array.isArray(root.nlp)) {
        throw new Error('golden-set.json: expected an object with an `nlp` array (shape {_readme, search[], nlp[]})');
    }
    const out: GoldenCase[] = [];
    for (const c of root.nlp as Array<Record<string, any>>) {
        const item = c.item as { rawText?: string; unit?: string; quantity?: number } | undefined;
        const rawText = item?.rawText ?? (typeof c.text === 'string' ? c.text : undefined);
        if (!rawText) continue;
        const shape: 'item' | 'text' = item?.rawText ? 'item' : 'text';
        if (shape === 'text' && !opts.includeMultiItem) continue;
        out.push({
            id: String(c.id),
            category: String(c.category ?? ''),
            rawText,
            expectName: Array.isArray(c.expectName) ? (c.expectName as string[][]) : [],
            forbidName: Array.isArray(c.forbidName) ? (c.forbidName as string[][]) : undefined,
            expectAbstain: c.expectAbstain === true ? true : undefined,
            maxConfidence: typeof c.maxConfidence === 'number' ? c.maxConfidence : undefined,
            expectItems: typeof c.expectItems === 'number' ? c.expectItems : undefined,
            macros: c.macros as Record<string, [number, number]> | undefined,
            grams: Array.isArray(c.grams) ? (c.grams as [number, number]) : undefined,
            total: c.total as Record<string, [number, number]> | undefined,
            knownIssue: !!c.knownIssue,
            shape,
            unit: typeof item?.unit === 'string' && item.unit ? item.unit : undefined,
            quantity: typeof item?.quantity === 'number' ? item.quantity : undefined,
            // An `item` case is by definition one mapIngredientWithFallback call.
            deterministicSingleItem: shape === 'item' ? true : isDeterministicSingleItemText(rawText),
        });
    }
    return out;
}

export type GoldenVerdict = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface GoldenBandResult {
    verdict: GoldenVerdict;
    /**
     * Everything a reader must see, violations first then `NOT-EVALUABLE:` notices.
     * winner-diff.ts prints this array verbatim, which is why the blind spots are in
     * it rather than tucked away in a field the runner does not know about.
     */
    failures: string[];
    /** bands the winner genuinely violated */
    violations: string[];
    /** bands that could not be judged, each with its reason */
    notEvaluable: string[];
    /** every assertion kind the case carries */
    asserted: GoldenBandKind[];
    /** the subset actually judged against this winner */
    evaluated: GoldenBandKind[];
    /** the subset that could not be judged (structural OR winner-dependent) */
    blind: GoldenBandKind[];
}

/**
 * Does this winner still satisfy the case's assertions — and, just as importantly,
 * WHICH of them could be judged at all?
 *
 * HARD RULE, unchanged: assert the right answer, never enumerate the wrong ones. A
 * case that merely forbids one wrong brand passes the moment the winner moves to a
 * DIFFERENT wrong brand. `forbidName` is therefore evaluated only as a CONJUNCT — it
 * can add a failure, never turn one into a pass — and a case whose only assertion is
 * a forbid is reported as such rather than as a clean PASS.
 *
 * VERDICT RULE:
 *   FAIL     at least one asserted band was judged and violated
 *   UNKNOWN  nothing was violated, but at least one asserted band could not be judged
 *   PASS     every asserted band was judged and satisfied
 *
 * UNKNOWN is the whole point. Before 2026-07-26 this function knew about
 * `expectName` and `macros` only, so a case asserting `grams: [24, 120]` returned a
 * clean PASS on any winner whose NAME matched — and 148 of the 243 nlp cases assert
 * grams. Both sides of a diff returned PASS, the runner compared the two verdicts,
 * saw no change, and printed "no golden case changed verdict" over a screen that
 * could not see the majority of the corpus. An unmeasurable band is not a satisfied
 * band; see REPLAY_BLIND_BANDS above for exactly what a replay cannot see and why.
 *
 * Semantics mirror run-eval.ts runNlpCase() band-for-band, including WHICH object
 * each band reads: macros -> items[0].nutritionPer100g, total -> items[0].nutrition,
 * grams -> items[0].grams. A replay has only the first of those three.
 */
export function checkGoldenBands(c: GoldenCase, w: WinnerInfo | null): GoldenBandResult {
    const violations: string[] = [];
    const notEvaluable: string[] = [];
    const asserted = assertedBands(c);
    const blind = new Set<GoldenBandKind>();

    const markBlind = (k: GoldenBandKind, why: string) => {
        if (blind.has(k)) return;
        blind.add(k);
        notEvaluable.push(`NOT-EVALUABLE: ${k} — ${why}`);
    };

    // ---- structural blindness, decided by the CASE, not by the winner ----
    if (!isSingleIngredientCase(c)) {
        for (const k of asserted) {
            markBlind(k, 'multi-item `text` case: /api/nlp/parse segments it with the LLM and '
                + 'asserts over items[]; a replay maps the WHOLE LINE as one ingredient, which is a '
                + 'different function. Nothing about this case is evaluable from a replay.');
        }
        return finish();
    }
    for (const k of asserted) {
        const why = REPLAY_BLIND_BANDS[k];
        if (why) markBlind(k, why);
    }

    // ---- expectAbstain: the only assertion a no-winner row can SATISFY ----
    if (c.expectAbstain) {
        if (w) {
            violations.push(`expected abstention, got "${w.foodName}" conf=${w.confidence.toFixed(2)}`);
        }
        // Caveat, deliberately not a silent pass-through: the route can still turn a
        // selected winner into a no-pick after selection (mapper :3063 sanity check),
        // so a replay winner is an upper bound on what the real eval would see.
    }

    if (!w) {
        if (!c.expectAbstain) {
            violations.push('no winner — nothing was picked, so no positive assertion can be satisfied');
        }
        return finish();
    }

    const text = textOf({ name: w.foodName, brand: w.brandName });

    if (c.expectName.length > 0) {
        if (!matchesAlt(text, c.expectName)) {
            violations.push(`expectName not satisfied by "${w.foodName}"${w.brandName ? ` [${w.brandName}]` : ''} ` +
                `(wanted any of ${JSON.stringify(c.expectName)})`);
        }
    }

    if (c.forbidName && c.forbidName.length > 0) {
        if (matchesAlt(text, c.forbidName)) {
            violations.push(`forbidName matched by "${w.foodName}"${w.brandName ? ` [${w.brandName}]` : ''} ` +
                `(forbidden: ${JSON.stringify(c.forbidName)})`);
        }
        if (c.expectName.length === 0) {
            notEvaluable.push('WEAK ASSERTION: this case only forbids names. Not matching a forbidden '
                + 'name is not evidence the answer is right — the winner may have moved to a '
                + 'different wrong record.');
        }
    }

    if (typeof c.maxConfidence === 'number') {
        if (w.confidence > c.maxConfidence) {
            violations.push(`confidence=${w.confidence.toFixed(3)} exceeds maxConfidence ${c.maxConfidence} ` +
                `(mapped: "${w.foodName}")`);
        }
    }

    if (c.macros) {
        const p = w.panel;
        const keys = Object.keys(c.macros);
        const unknownKeys = keys.filter(k => !MEASURABLE_MACRO_KEYS.includes(k));
        if (!p || !p.per100g) {
            markBlind('macros', 'winner has no per-100g panel at selection time');
        } else {
            const got: Record<string, number> = {
                kcal100: p.kcal, protein100: p.protein, carbs100: p.carbs, fat100: p.fat,
            };
            for (const [k, band] of Object.entries(c.macros)) {
                if (!MEASURABLE_MACRO_KEYS.includes(k)) continue;
                const v = got[k];
                if (v < band[0] || v > band[1]) {
                    violations.push(`${k} ${v} outside [${band[0]}, ${band[1]}] (mapped: "${w.foodName}")`);
                }
            }
            if (unknownKeys.length === keys.length) {
                // every key is off-panel: the band as a whole was not judged
                markBlind('macros', `no key is on the replay panel (${unknownKeys.join(', ')}; `
                    + `panel carries ${MEASURABLE_MACRO_KEYS.join('/')})`);
            } else if (unknownKeys.length) {
                notEvaluable.push(`PARTIAL: macros keys ${unknownKeys.join(', ')} are not on the replay `
                    + `panel (${MEASURABLE_MACRO_KEYS.join('/')}) and were NOT judged`);
            }
        }
    }

    return finish();

    function finish(): GoldenBandResult {
        const failures = [...violations, ...notEvaluable];
        const blindList = asserted.filter(k => blind.has(k));
        const evaluated = asserted.filter(k => !blind.has(k));
        // A weak/partial note with no blind band still means "do not read this as clean".
        const softOnly = notEvaluable.length > 0 && blindList.length === 0;
        const verdict: GoldenVerdict = violations.length > 0
            ? 'FAIL'
            : (blindList.length > 0 || softOnly ? 'UNKNOWN' : 'PASS');
        return { verdict, failures, violations, notEvaluable, asserted, evaluated, blind: blindList };
    }
}

// ---- golden screen (the reportable object) -----------------------------

export interface GoldenScreenCase {
    id: string;
    rawText: string;
    category: string;
    knownIssue: boolean;
    shape: 'item' | 'text';
    winnerMoved: boolean;
    a: GoldenBandResult;
    b: GoldenBandResult;
    verdictChanged: boolean;
    /** same verdict on both sides, but the reasons moved (FAIL -> FAIL for a new reason) */
    failuresChanged: boolean;
}

export interface GoldenCoverage {
    cases: number;
    /** per assertion kind: how many cases carry it, and on how many it cannot be judged */
    byKind: Array<{ kind: GoldenBandKind; asserted: number; blind: number }>;
    casesWithBlindBand: number;
    casesFullyBlind: number;
    gramsCases: number;
    /** grams cases whose band is fixed by the parsed quantity, not by the winner record */
    gramsRecordIndependent: number;
}

export interface GoldenScreenResult {
    matched: number;
    /** golden rows in A with no case definition or no B counterpart */
    unmatched: number;
    winnerMoved: number;
    coverage: GoldenCoverage;
    /** verdict differs between A and B */
    changed: GoldenScreenCase[];
    /** verdict identical but the failure/blind reasons moved */
    reasonsChanged: GoldenScreenCase[];
    /**
     * THE POPULATION THE OLD SCREEN SWALLOWED: the winner moved, and the case carries
     * at least one band this replay cannot judge. A "no golden case changed verdict"
     * line says nothing whatsoever about these.
     */
    movedButBlind: GoldenScreenCase[];
}

export function goldenCoverage(cases: GoldenCase[]): GoldenCoverage {
    const byKind = GOLDEN_BAND_KINDS.map(kind => ({ kind, asserted: 0, blind: 0 }));
    const index = new Map(byKind.map(b => [b.kind, b]));
    let casesWithBlindBand = 0;
    let casesFullyBlind = 0;
    let gramsCases = 0;
    let gramsRecordIndependent = 0;
    for (const c of cases) {
        const asserted = assertedBands(c);
        const blind = new Set(structurallyBlindBands(c));
        for (const k of asserted) {
            const slot = index.get(k)!;
            slot.asserted++;
            if (blind.has(k)) slot.blind++;
        }
        if (blind.size > 0) casesWithBlindBand++;
        if (asserted.length > 0 && blind.size === asserted.length) casesFullyBlind++;
        if (c.grams) {
            gramsCases++;
            if (gramsBandIsRecordIndependent(c)) gramsRecordIndependent++;
        }
    }
    return {
        cases: cases.length,
        byKind: byKind.filter(b => b.asserted > 0),
        casesWithBlindBand,
        casesFullyBlind,
        gramsCases,
        gramsRecordIndependent,
    };
}

/**
 * The golden screen as a value, so the runner prints it instead of re-deriving it.
 *
 * Matching mirrors what winner-diff.ts's reportGoldenBands already does: A rows carry
 * `goldenId`, B is looked up by query text.
 *
 * NOTE FOR THE RUNNER: the old reportGoldenBands compared `va.verdict !== vb.verdict`
 * and `continue`d otherwise. With grams/total/expectItems correctly reported as
 * UNKNOWN, most cases are now UNKNOWN on BOTH sides — so that comparison stays quiet
 * and the clearance line would be exactly as misleading as before. `movedButBlind`
 * and `coverage` exist so the report can say what it could not see. Print
 * formatGoldenScreen() — never a bare clearance line.
 */
export function runGoldenScreen(
    cases: GoldenCase[] | Map<string, GoldenCase>,
    aRows: ReplayRow[],
    bRows: ReplayRow[],
): GoldenScreenResult {
    const byId = cases instanceof Map ? cases : new Map(cases.map(c => [c.id, c]));
    const bByQuery = new Map(bRows.map(r => [r.query, r]));

    const matchedCases: GoldenCase[] = [];
    const changed: GoldenScreenCase[] = [];
    const reasonsChanged: GoldenScreenCase[] = [];
    const movedButBlind: GoldenScreenCase[] = [];
    let unmatched = 0;
    let winnerMoved = 0;

    for (const a of aRows) {
        if (!a.goldenId) continue;
        const c = byId.get(a.goldenId);
        const b = bByQuery.get(a.query);
        if (!c || !b) { unmatched++; continue; }
        matchedCases.push(c);

        const va = checkGoldenBands(c, a.winner);
        const vb = checkGoldenBands(c, b.winner);
        const moved = (a.winner?.foodId ?? null) !== (b.winner?.foodId ?? null);
        if (moved) winnerMoved++;

        const rec: GoldenScreenCase = {
            id: c.id,
            rawText: c.rawText,
            category: c.category,
            knownIssue: !!c.knownIssue,
            shape: c.shape,
            winnerMoved: moved,
            a: va,
            b: vb,
            verdictChanged: va.verdict !== vb.verdict,
            failuresChanged: va.failures.join('|') !== vb.failures.join('|'),
        };
        if (rec.verdictChanged) changed.push(rec);
        else if (rec.failuresChanged) reasonsChanged.push(rec);
        if (moved && vb.blind.length > 0) movedButBlind.push(rec);
    }

    return {
        matched: matchedCases.length,
        unmatched,
        winnerMoved,
        coverage: goldenCoverage(matchedCases),
        changed,
        reasonsChanged,
        movedButBlind,
    };
}

export function formatGoldenScreen(s: GoldenScreenResult, top = 30): string[] {
    const L: string[] = [];
    L.push('');
    L.push(`GOLDEN-BAND SCREEN over ${s.matched} matched case(s)` +
        (s.unmatched ? `  (${s.unmatched} golden row(s) had no case definition or no B counterpart)` : ''));
    L.push('');
    L.push('  WHAT THIS SCREEN CANNOT SEE — a frozen-pool replay selects a WINNER. It does not');
    L.push('  run serving resolution, grams-scaling of nutrition, or the LLM segmenter, so');
    L.push('  `grams`, `total` and `expectItems` are NOT EVALUABLE here and are reported as');
    L.push('  UNKNOWN, never as satisfied. Do NOT read a quiet verdict column as clearance.');
    L.push('');
    L.push('  band coverage over the matched cases (asserted / of those, blind):');
    for (const b of s.coverage.byKind) {
        const flag = b.blind === b.asserted && b.asserted > 0 ? '  <-- NOT EVALUABLE'
            : b.blind > 0 ? '  <-- partly blind' : '';
        L.push(`      ${b.kind.padEnd(14)} asserted ${String(b.asserted).padStart(4)}   blind ${String(b.blind).padStart(4)}${flag}`);
    }
    L.push(`      ${s.coverage.casesWithBlindBand} of ${s.coverage.cases} case(s) carry at least one band this screen cannot judge` +
        `; ${s.coverage.casesFullyBlind} are fully blind.`);
    if (s.coverage.gramsCases) {
        L.push(`      of ${s.coverage.gramsCases} grams band(s), ${s.coverage.gramsRecordIndependent} are fixed by the parsed quantity ` +
            `(explicit weight unit) and ${s.coverage.gramsCases - s.coverage.gramsRecordIndependent} resolve FROM THE WINNER RECORD` +
            ` — i.e. a winner change is exactly what moves them.`);
    }
    L.push('');
    L.push(`  winner moved on ${s.winnerMoved} of ${s.matched} matched case(s)`);
    L.push('');

    const block = (title: string, list: GoldenScreenCase[], render: (r: GoldenScreenCase) => string[]) => {
        L.push(`  ${title}: ${list.length}`);
        for (const r of list.slice(0, top)) L.push(...render(r));
        if (list.length > top) L.push(`      ... ${list.length - top} more`);
        L.push('');
    };

    block('VERDICT CHANGED', s.changed, r => {
        const out = [`      ${r.id} ${r.knownIssue ? '(knownIssue) ' : ''}"${r.rawText}"   ${r.a.verdict} -> ${r.b.verdict}`];
        for (const f of r.b.failures) out.push(`          B: ${f}`);
        for (const f of r.a.failures) out.push(`          A: ${f}`);
        return out;
    });

    block('WINNER MOVED but the case has a band this screen CANNOT judge', s.movedButBlind, r =>
        [`      ${r.id} "${r.rawText}"   verdict ${r.a.verdict} -> ${r.b.verdict}   unjudged: ${r.b.blind.join(', ')}`]);

    block('same verdict, different reasons', s.reasonsChanged, r =>
        [`      ${r.id} "${r.rawText}"   ${r.b.verdict} (reasons moved)`]);

    if (!s.changed.length && !s.movedButBlind.length && !s.reasonsChanged.length) {
        L.push('  no golden case changed verdict AND no moved winner sits behind an unjudged band.');
        L.push('  (That sentence is only worth as much as the coverage table above.)');
    }
    return L;
}

// ============================================================
// 7. Counterfactual summary (gate early-exit vs what rerank would have picked)
// ============================================================

export interface CounterfactualSummary {
    rows: number;
    earlyExit: number;
    earlyExitPct: number;
    agree: number;
    disagree: number;
    rerankDeclined: number;
    /** exit reason -> [disagreements, firings] */
    byReason: Array<[string, { disagree: number; total: number }]>;
    medianCounterMicros: number | null;
    pairs: ScreenPair[];
}

/**
 * The cheapest standing monitor of the confidence gate: ONE replay, no B tree.
 *
 * `rerankDeclined` is the load-bearing row for any "demote the gate to a backstop"
 * proposal — if it is 0 the reranker never abstains where the gate fires, so the
 * demotion cannot manufacture a no-winner fall-through into AI backfill.
 *
 * `counter` is a COUNTERFACTUAL, not an outcome: it shows what simpleRerank WOULD
 * have returned on the frozen pool. It never shows which pick is correct.
 */
export function counterfactualSummary(rows: ReplayRow[]): CounterfactualSummary {
    const exits = rows.filter(r => r.path === 'confidence_gate_early_exit' && r.counter);
    let agree = 0;
    let disagree = 0;
    let declined = 0;
    const byReason = new Map<string, { disagree: number; total: number }>();
    const pairs: ScreenPair[] = [];
    const micros: number[] = [];
    for (const r of exits) {
        const reason = (r.gate.reason || '(empty)').split(' (')[0];
        const slot = byReason.get(reason) ?? { disagree: 0, total: 0 };
        slot.total++;
        const cw = r.counter?.winner ?? null;
        if (typeof r.counterMicros === 'number') micros.push(r.counterMicros);
        if (!cw) declined++;
        else if (r.winner && cw.foodId === r.winner.foodId) agree++;
        else {
            disagree++;
            slot.disagree++;
            pairs.push({ query: r.query, a: r.winner, b: cw });
        }
        byReason.set(reason, slot);
    }
    micros.sort((a, b) => a - b);
    return {
        rows: rows.length,
        earlyExit: exits.length,
        earlyExitPct: rows.length ? (100 * exits.length) / rows.length : 0,
        agree,
        disagree,
        rerankDeclined: declined,
        byReason: [...byReason.entries()].sort((x, y) => y[1].total - x[1].total),
        medianCounterMicros: micros.length ? micros[Math.floor(micros.length / 2)] : null,
        pairs,
    };
}

// ============================================================================
// 12. WHICH FILES DECIDE A REPLAY — the tree-hash membership rule
// ============================================================================
/**
 * `gitDirtyHash()` in winner-diff.ts answers "did the two sides run the same code".
 * The I/O lives there; the DECISION — which paths count — lives here, because that
 * is the half that has a right and a wrong answer, and the half that has twice been
 * wrong.
 *
 * History of the bug this encodes against (2026-08-14). The rule used to be a
 * hand-maintained list of four entries read only one directory deep for `.ts`. It
 * covered 54 files against the 164 a replay can load: 4 of 13 `src/lib` directories
 * and NONE of the three JSON files. `dropDenylistedCandidates()` reads
 * `src/lib/mapping/data/corrupt-off-denylist.json` LIVE at replay, so editing it
 * moved real winners while the hash sat still — the BASE noise-floor receipt then
 * satisfied the BRANCH and the header announced the run as a noise-floor check.
 * The same shape had already happened once, with `src/lib/servings` in 2026-07-27.
 *
 * So the rule is now a WALK, not a list, and it is deliberately FAIL-CLOSED: hashing
 * a file that cannot affect a replay costs one re-run (the driver re-takes both noise
 * floors every time); missing one that can produces a green receipt for untested code.
 * `__tests__` is excluded because a test file cannot change what a replay produces.
 */
export const HASHED_SOURCE_ROOTS = ['src/lib'] as const;
/**
 * Runtime data resolved off `process.cwd()` rather than imported. `readRulesFile()` in
 * normalization-rules.ts prefers this file over the in-code DEFAULT_RULES, so a stale
 * copy silently overrides a shipped code fix — that is the PR #211 incident, where the
 * cooking-state fix was inert on the box with every local gate green.
 */
export const HASHED_EXTRA_FILES = ['data/fatsecret/normalization-rules.json'] as const;
export const HASHED_EXTENSIONS = ['.ts', '.tsx', '.json'] as const;
const HASH_SKIP_DIRS = new Set(['__tests__', 'node_modules']);

/** True when a path segment must not be descended into when collecting hashable files. */
export function isSkippedHashDir(name: string): boolean {
    return HASH_SKIP_DIRS.has(name);
}

/**
 * Given every relative path under the repo that a caller has already enumerated,
 * return the subset whose contents decide a replay, sorted for a stable hash.
 * Pure: no I/O, no filesystem assumptions beyond `/`-joined relative paths.
 */
export function selectHashablePaths(allRelPaths: readonly string[]): string[] {
    const out: string[] = [];
    for (const rel of allRelPaths) {
        if (HASHED_EXTRA_FILES.includes(rel as typeof HASHED_EXTRA_FILES[number])) { out.push(rel); continue; }
        if (!HASHED_SOURCE_ROOTS.some(root => rel === root || rel.startsWith(root + '/'))) continue;
        if (rel.split('/').some(seg => isSkippedHashDir(seg))) continue;
        if (!HASHED_EXTENSIONS.some(e => rel.endsWith(e))) continue;
        out.push(rel);
    }
    return [...new Set(out)].sort();
}
