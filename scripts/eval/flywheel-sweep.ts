/**
 * flywheel-sweep.ts — Phase 4 recurring flywheel loop (PR E).
 *
 * One self-contained sweep of the cache-accuracy flywheel, meant to run
 * nightly on the OptiPlex via systemd timer (ops/systemd/flywheel-sweep.timer)
 * but runnable from any machine with LAN access + DATABASE_URL:
 *
 *   1. TELEMETRY  — mine MappingEventLog (last --days): top traffic keys
 *      (become extra warm seeds — real demand replaces guesswork corpora),
 *      never-cache-hit "attention" keys, cache-escape reasons, thrash keys
 *      (≥2 distinct foodIds resolved for one key), servingTier distribution.
 *      1b. STUCK KEYS — sub-gate keys (all-miss, max confidence < 0.85) that
 *      the cache can never save and so never surface for review; writes
 *      results/stuck-keys-<ts>.json (triage-batch input) + a trend line vs the
 *      previous stuck-keys report. Logic: src/lib/ops/stuck-keys.ts.
 *   2. WARM       — standard warm-cache corpus + telemetry seeds through
 *      /api/nlp/parse on the normal cache-first path (save gates apply).
 *   3. DIFF       — compare against the previous warm-*.json report: identity
 *      flips, per-100g kcal drift >5%, grams flap >25%, error deltas.
 *   4. EVAL GATE  — spawn run-eval.ts; real failures must be a subset of
 *      --allow-fail (default EMPTY — any real failure reds the gate). An
 *      allowance is opt-in per run, never standing. Gate failure → exit 1. An INSTRUMENT
 *      failure — run-eval crashed/killed, exited 2 (its own fail-closed
 *      zero-case signal), receipt missing/unreadable/contradicting the exit
 *      code, or a warm step that reached nothing — → exit 2: the sweep
 *      measured NOTHING and must not read as either green or "gate red".
 *      The gate is POST-HOC: step [2/4] has already written to FoodMapping
 *      before it runs, and nothing rolls back — a red gate means "writes
 *      happened AND the gate is red", and the exit reasons say so.
 *      Verdict logic is pure + fail-injection tested: flywheel-verdict.ts.
 *      4b. SEG REPLAY-DIFF (REPORT-ONLY) — top-N SegmentationCache lines by
 *      hitCount re-run through fresh AI segmentation with the cache bypassed
 *      (no cache read, NO cache write) and diffed against the cached splits;
 *      writes results/seg-replay-<ts>.json + a trend line vs the previous
 *      seg-replay artifact. Fail-soft: any error (LLM down, DB down) becomes
 *      a warning in the report and NEVER changes the sweep's exit code or
 *      gating. Logic: src/lib/ops/seg-replay.ts. Cost ~N LLM calls (default
 *      20, --seg-replay-top).
 *      4c. CORPUS COVERAGE (REPORT-ONLY) — share of a FIXED representative
 *      seed corpus (scripts/eval/coverage-corpus-2026-08-08.tsv, 4,102 seeds,
 *      the default since 2026-08-24; the 07-24 and 08-02 cuts stay committed)
 *      whose MAPPER-NORMALIZED key (deriveStaticCoverageKey(): normalizer →
 *      canonicalize → duplicate-collapse, the predicate since 2026-08-24)
 *      already exists in FoodMapping, overall and per domain, trended against
 *      the previous sweep on the SAME corpus. Answers "is the cache big enough
 *      yet?" (first read on this instrument 2931/4102 = 71.5%, 2026-08-24;
 *      stop signal >70-80%) as opposed to the warm run's cache_hit, which
 *      answers "did it hold?". Read-only and never gates. Logic:
 *      src/lib/ops/cache-coverage.ts (its header owns the predicate change).
 *   5. REPORT     — results/flywheel-<ts>.{json,md}; --publish-dir copies the
 *      markdown (dated + flywheel-latest.md) somewhere Syncthing carries it
 *      (e.g. sync-docs/) so every machine sees the nightly report.
 *
 * Deliberately NOT included: the cold cache-parity sweep — its nocache replay
 * overwrites cache rows as a side effect (see cache-parity-sweep.ts), so it
 * stays a manual, snapshot-first operation.
 *
 * Run (from repo root):
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
 *     scripts/eval/flywheel-sweep.ts --base http://localhost:3000 \
 *     [--days 7] [--top 100] [--concurrency 4] [--allow-fail <triaged-id,...>] \
 *     [--skip-warm] [--skip-eval] [--seg-replay-top 20] [--publish-dir sync-docs]
 *
 * --stuck-keys-only runs JUST the stuck-key report (read-only against the DB,
 * writes only results/stuck-keys-<ts>.json) — no warm, no eval, no publish.
 * --seg-replay-only likewise runs JUST the seg replay-diff step (reads the DB,
 * ~N LLM calls, writes only results/seg-replay-<ts>.json).
 * --coverage-only runs JUST the coverage read — no API calls, no LLM, no
 * writes at all. Cheap enough to run between warm batches to watch a domain
 * fill in; use --coverage-corpus <path> to measure a different seed list.
 */

// Load .env before any src/lib import: the seg replay-diff step calls the LLM
// in-process and structured-client captures OPENROUTER_API_KEY & co. from
// process.env at import time. dotenv never overrides vars already set.
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { assembleSeeds, runWarm, WarmResult, WarmRunReport } from './warm-cache';
import {
    EvalGate, EvalRunEvidence, judgeEvalGate, sweepVerdict, WarmFacts,
} from './flywheel-verdict';
import {
    collectStuckKeys, computeStuckTrend, findPreviousStuckReport, formatStuckKeysSection,
    StuckKeysReport, StuckTrend,
} from '../../src/lib/ops/stuck-keys';
import {
    collectSegReplay, computeSegReplayTrend, failedSegReplayReport, findPreviousSegReplayReport,
    formatSegReplaySection, SegReplayReport, SegReplayTrend, SEG_REPLAY_DEFAULT_TOP_N,
} from '../../src/lib/ops/seg-replay';
import { segmentTextWithAi } from '../../src/lib/nlp/ai-segmenter';
import {
    CacheCoverageReport, collectCacheCoverage, computeCoverageTrend, CoverageTrend,
    findPreviousCoverage, formatCoverageSection,
} from '../../src/lib/ops/cache-coverage';

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
}

const BASE = argValue('--base') ?? process.env.EVAL_API_BASE ?? 'http://localhost:3000';
const DAYS = Number(argValue('--days') ?? 7);
const TOP = Number(argValue('--top') ?? 100);
const CONCURRENCY = Number(argValue('--concurrency') ?? 4);
// Default is EMPTY: an allowance that is not currently absorbing a real
// failure is a slot where a future genuine red disappears. 'n-mq-10' was the
// standing default until 2026-07-31, by which point it had been passing as a
// hard assertion — pruned per the warm-push preflight. Pass --allow-fail
// explicitly, and only for a red you have triaged and chosen to stand.
const ALLOW_FAIL = (argValue('--allow-fail') ?? '').split(',').map(s => s.trim()).filter(Boolean);
const SKIP_WARM = args.includes('--skip-warm');
const SKIP_EVAL = args.includes('--skip-eval');
const STUCK_ONLY = args.includes('--stuck-keys-only');
const SEG_REPLAY_TOP = Number(argValue('--seg-replay-top') ?? SEG_REPLAY_DEFAULT_TOP_N);
const SEG_REPLAY_ONLY = args.includes('--seg-replay-only');
const PUBLISH_DIR = argValue('--publish-dir');
const SKIP_COVERAGE = args.includes('--skip-coverage');
const COVERAGE_ONLY = args.includes('--coverage-only');

const RESULTS_DIR = path.join(__dirname, 'results');
const REPO_ROOT = path.join(__dirname, '..', '..');
// Default REPOINTED 2026-08-24 (the 2026-08-08 decision, executed with the
// predicate change in src/lib/ops/cache-coverage.ts — one metric change, once):
// coverage-corpus-2026-08-08.tsv, cut 2026-08-08 by _cut_coverage_corpus.ts
// (PR #270) = the 08-02 corpus plus the staples-expansion seeds, 4,102 seeds,
// baseline 56.7% by the raw key at cut. The 2026-07-24 (3,307 seeds, 28.8%) and
// 2026-08-02 (3,754 seeds, restated 52.1%; last raw-key read 67.9% on
// 2026-08-24) cuts stay COMMITTED and unchanged so every reading logged before
// this date stays readable against its own denominator — a new default, never
// an append. The trend line is null across corpora, so the first nightly on
// this file prints no delta by design. --coverage-corpus <path> still reads any cut.
const COVERAGE_CORPUS = argValue('--coverage-corpus')
    ?? path.join(__dirname, 'coverage-corpus-2026-08-08.tsv');

// ---------------------------------------------------------------------------
// 1. Telemetry
// ---------------------------------------------------------------------------

interface KeyCount { key: string; n: number }
interface ThrashRow { key: string; ids: number; n: number }
interface CountRow { reason: string; n: number }

interface Telemetry {
    ok: boolean;
    error?: string;
    windowDays: number;
    events: number;
    topKeys: KeyCount[];
    attentionKeys: KeyCount[];   // seen ≥ twice, never a cache hit → uncached demand
    escapes: CountRow[];
    thrash: ThrashRow[];
    servingTiers: CountRow[];
}

async function collectTelemetry(): Promise<Telemetry> {
    const empty: Telemetry = {
        ok: false, windowDays: DAYS, events: 0,
        topKeys: [], attentionKeys: [], escapes: [], thrash: [], servingTiers: [],
    };
    const prisma = new PrismaClient();
    const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000);
    try {
        const [total] = await prisma.$queryRaw<{ n: number }[]>`
            SELECT count(*)::int AS n FROM "MappingEventLog"
            WHERE "createdAt" >= ${since} AND "noCache" = false`;

        const topKeys = await prisma.$queryRaw<KeyCount[]>`
            SELECT "normalizedForm" AS key, count(*)::int AS n
            FROM "MappingEventLog"
            WHERE "createdAt" >= ${since} AND "noCache" = false AND "normalizedForm" IS NOT NULL
            GROUP BY 1 ORDER BY n DESC LIMIT ${TOP}`;

        const attentionKeys = await prisma.$queryRaw<KeyCount[]>`
            SELECT "normalizedForm" AS key, count(*)::int AS n
            FROM "MappingEventLog"
            WHERE "createdAt" >= ${since} AND "noCache" = false AND "normalizedForm" IS NOT NULL
            GROUP BY 1
            HAVING count(*) >= 2 AND count(*) FILTER (WHERE "cacheHit" IS NOT NULL) = 0
            ORDER BY n DESC LIMIT 25`;

        const escapes = await prisma.$queryRaw<CountRow[]>`
            SELECT "cacheEscape" AS reason, count(*)::int AS n
            FROM "MappingEventLog"
            WHERE "createdAt" >= ${since} AND "cacheEscape" IS NOT NULL
            GROUP BY 1 ORDER BY n DESC`;

        const thrash = await prisma.$queryRaw<ThrashRow[]>`
            SELECT "normalizedForm" AS key, count(DISTINCT "foodId")::int AS ids, count(*)::int AS n
            FROM "MappingEventLog"
            WHERE "createdAt" >= ${since} AND "noCache" = false
              AND "normalizedForm" IS NOT NULL AND "foodId" IS NOT NULL
            GROUP BY 1 HAVING count(DISTINCT "foodId") >= 2
            ORDER BY ids DESC, n DESC LIMIT 30`;

        const servingTiers = await prisma.$queryRaw<CountRow[]>`
            SELECT coalesce("servingTier", '(none)') AS reason, count(*)::int AS n
            FROM "MappingEventLog"
            WHERE "createdAt" >= ${since} AND "noCache" = false
            GROUP BY 1 ORDER BY n DESC`;

        return {
            ok: true, windowDays: DAYS, events: total?.n ?? 0,
            topKeys, attentionKeys, escapes, thrash, servingTiers,
        };
    } catch (err) {
        return { ...empty, error: (err as Error).message };
    } finally {
        await prisma.$disconnect().catch(() => {});
    }
}

// ---------------------------------------------------------------------------
// 1b. Stuck keys (sub-gate, never cached) — logic in src/lib/ops/stuck-keys.ts
// ---------------------------------------------------------------------------

interface StuckKeysRun {
    report: StuckKeysReport;
    trend: StuckTrend;
    /** results/stuck-keys-<ts>.json (triage-batch input); null when the query failed. */
    outPath: string | null;
}

async function runStuckKeysReport(ranAt: string, stamp: string): Promise<StuckKeysRun> {
    const prisma = new PrismaClient();
    const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000);
    let report: StuckKeysReport;
    try {
        report = await collectStuckKeys(prisma, { since, windowDays: DAYS });
    } finally {
        await prisma.$disconnect().catch(() => {});
    }

    // Locate the previous report BEFORE writing this run's file (trend input).
    const prev = findPreviousStuckReport(RESULTS_DIR);
    const trend = computeStuckTrend(report.count, prev);

    let outPath: string | null = null;
    if (report.ok) {
        // Zero rows is a valid (great) result and still worth a trend datapoint;
        // a failed query writes nothing so it can't fake an empty population.
        fs.mkdirSync(RESULTS_DIR, { recursive: true });
        outPath = path.join(RESULTS_DIR, `stuck-keys-${stamp}.json`);
        fs.writeFileSync(outPath, JSON.stringify({
            ranAt,
            windowDays: report.windowDays,
            confidenceGate: report.confidenceGate,
            count: report.count,
            trend,
            rows: report.rows,
        }, null, 1));
    }
    return { report, trend, outPath };
}

// ---------------------------------------------------------------------------
// 4b. Seg replay-diff (REPORT-ONLY) — logic in src/lib/ops/seg-replay.ts
// ---------------------------------------------------------------------------

interface SegReplayRun {
    report: SegReplayReport;
    trend: SegReplayTrend;
    /** results/seg-replay-<ts>.json; null when the step failed (nothing to trend against). */
    outPath: string | null;
}

/**
 * Fail-soft wrapper: this step is strictly report-only. ANY failure (prisma
 * init, DB, LLM, fs) is folded into an ok:false report section — it must
 * never throw into main() and never influence the eval gate's exit code.
 */
async function runSegReplayStep(ranAt: string, stamp: string): Promise<SegReplayRun> {
    try {
        const prisma = new PrismaClient();
        let report: SegReplayReport;
        try {
            report = await collectSegReplay(prisma, segmentTextWithAi, { topN: SEG_REPLAY_TOP });
        } finally {
            await prisma.$disconnect().catch(() => {});
        }

        // Locate the previous artifact BEFORE writing this run's file (trend input).
        const prev = findPreviousSegReplayReport(RESULTS_DIR);
        const trend = computeSegReplayTrend(report.drifts, prev);

        let outPath: string | null = null;
        if (report.ok) {
            // Zero cached lines is a valid (clean) result and still a trend
            // datapoint; a failed run writes nothing so it can't fake a clean zero.
            fs.mkdirSync(RESULTS_DIR, { recursive: true });
            outPath = path.join(RESULTS_DIR, `seg-replay-${stamp}.json`);
            fs.writeFileSync(outPath, JSON.stringify({ ranAt, ...report, trend }, null, 1));
        }
        return { report, trend, outPath };
    } catch (err) {
        return {
            report: failedSegReplayReport(SEG_REPLAY_TOP, (err as Error).message),
            trend: { previous: null, previousDrifts: null, delta: null },
            outPath: null,
        };
    }
}

function segReplaySummaryLine(seg: SegReplayRun): string {
    const r = seg.report;
    if (!r.ok) return `  unavailable (report-only, not gating): ${r.error}`;
    if (r.cachedLines === 0) return '  0 cached lines to replay — clean zero';
    const trendBit = seg.trend.previous === null
        ? 'first run'
        : `prev drifts ${seg.trend.previousDrifts}, Δ ${seg.trend.delta}`;
    return `  replayed ${r.replayed}: ${r.matches} match / ${r.drifts} drift / ${r.aiErrors} ai_error (${trendBit})`;
}

// ---------------------------------------------------------------------------
// 3. Warm-report diff
// ---------------------------------------------------------------------------

interface WarmDiff {
    previous: string | null;
    identityFlips: { seed: string; was: string; now: string }[];
    kcalDrift: { seed: string; foodId: string; was: number; now: number }[];
    gramsFlap: { seed: string; was: number; now: number }[];
    newErrors: string[];
    resolvedErrors: string[];
}

function latestWarmReport(excludePath?: string): string | null {
    if (!fs.existsSync(RESULTS_DIR)) return null;
    const files = fs.readdirSync(RESULTS_DIR)
        .filter(f => f.startsWith('warm-') && f.endsWith('.json'))
        .map(f => path.join(RESULTS_DIR, f))
        .filter(f => f !== excludePath)
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return files[0] ?? null;
}

function diffWarmRuns(prevPath: string | null, current: WarmResult[]): WarmDiff {
    const diff: WarmDiff = {
        previous: prevPath, identityFlips: [], kcalDrift: [], gramsFlap: [],
        newErrors: [], resolvedErrors: [],
    };
    if (!prevPath) return diff;
    const prev: WarmResult[] = JSON.parse(fs.readFileSync(prevPath, 'utf8')).results ?? [];
    const prevBySeed = new Map(prev.map(r => [r.seed.toLowerCase(), r]));

    for (const cur of current) {
        const old = prevBySeed.get(cur.seed.toLowerCase());
        if (!old) continue;
        if (!old.ok && cur.ok) diff.resolvedErrors.push(cur.seed);
        if (old.ok && !cur.ok) diff.newErrors.push(cur.seed);
        if (!old.ok || !cur.ok) continue;

        if (old.foodId !== cur.foodId) {
            diff.identityFlips.push({
                seed: cur.seed,
                was: `${old.foodId} "${old.foodName}"`,
                now: `${cur.foodId} "${cur.foodName}"`,
            });
            continue;
        }
        const oldK = old.per100g?.kcal, curK = cur.per100g?.kcal;
        if (typeof oldK === 'number' && typeof curK === 'number' && oldK > 0
            && Math.abs(curK - oldK) / oldK > 0.05) {
            diff.kcalDrift.push({ seed: cur.seed, foodId: cur.foodId ?? '?', was: oldK, now: curK });
        }
        if (typeof old.grams === 'number' && typeof cur.grams === 'number' && old.grams > 0
            && Math.abs(cur.grams - old.grams) / old.grams > 0.25) {
            diff.gramsFlap.push({ seed: cur.seed, was: old.grams, now: cur.grams });
        }
    }
    return diff;
}

// ---------------------------------------------------------------------------
// 4. Eval gate
// ---------------------------------------------------------------------------

/**
 * Spawn run-eval.ts and JUDGE it — exit code first, results file second.
 *
 * The verdict logic itself is pure and lives in flywheel-verdict.ts
 * (judgeEvalGate), where it is fail-injection tested. The old version of this
 * function ignored `proc.status` whenever a results file existed, which
 * defeated run-eval's own `evalExitCode` fail-closed signal (PR #177):
 * run-eval writes its results file even on the zero-case path, exits 2, and
 * an empty `results` array re-derived here as "no unexpected failures" — a
 * PASS. That is playbook §11 class B, absence encoded as a pass.
 *
 * Exported with an injectable child + results dir so the jest suite can run
 * the EVIDENCE ASSEMBLY itself against a stub child process — the 35
 * fail-injection tests on judgeEvalGate prove the judge, but only a real
 * spawn proves that the exit code, the before/after file diff and the JSON
 * parse actually reach it. Defaults reproduce production behaviour exactly;
 * main() calls this with no arguments.
 */
export interface RunEvalGateOptions {
    /** Child to spawn; defaults to the real run-eval.ts under ts-node. */
    spawn?: { cmd: string; args: string[] };
    /** Where eval-*.json receipts appear; defaults to scripts/eval/results. */
    resultsDir?: string;
    /** Failure ids the gate may absorb; defaults to --allow-fail. */
    allowFail?: string[];
    cwd?: string;
    timeoutMs?: number;
}

export function runEvalGate(opts: RunEvalGateOptions = {}): EvalGate {
    const resultsDir = opts.resultsDir ?? RESULTS_DIR;
    const allowFail = opts.allowFail ?? ALLOW_FAIL;
    const child = opts.spawn ?? {
        cmd: 'npx',
        args: [
            'ts-node', '--transpile-only',
            '--compilerOptions', '{"module":"commonjs","moduleResolution":"node"}',
            path.join(__dirname, 'run-eval.ts'), '--base', BASE,
        ],
    };

    const before = new Set(
        fs.existsSync(resultsDir) ? fs.readdirSync(resultsDir).filter(f => f.startsWith('eval-')) : []);

    const proc = spawnSync(child.cmd, child.args, {
        cwd: opts.cwd ?? REPO_ROOT, stdio: 'inherit', timeout: opts.timeoutMs ?? 30 * 60 * 1000,
    });

    const evidence: EvalRunEvidence = {
        spawnError: proc.error ? proc.error.message : undefined,
        status: proc.status ?? null,
        signal: (proc.signal as string | null) ?? null,
        resultsFile: null,
    };

    if (!evidence.spawnError && fs.existsSync(resultsDir)) {
        const evalFile = fs.readdirSync(resultsDir)
            .filter(f => f.startsWith('eval-') && !before.has(f))
            .map(f => path.join(resultsDir, f))
            .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
        if (evalFile) {
            evidence.resultsFile = evalFile;
            try {
                evidence.data = JSON.parse(fs.readFileSync(evalFile, 'utf8'));
            } catch (err) {
                evidence.parseError = (err as Error).message;
            }
        }
    }

    return judgeEvalGate(evidence, allowFail);
}

// ---------------------------------------------------------------------------
// 5. Report
// ---------------------------------------------------------------------------

function fmtTable(rows: string[][], header: string[]): string {
    const all = [header, ...rows];
    const md = [
        `| ${header.join(' | ')} |`,
        `| ${header.map(() => '---').join(' | ')} |`,
        ...rows.map(r => `| ${r.join(' | ')} |`),
    ];
    return all.length > 1 ? md.join('\n') : '_none_';
}

/**
 * Roll a namespaced dropReason up to its class level for the report: keep
 * '<stage>:<class>' and drop the detail suffix. The stored column keeps full
 * granularity (Diego, 2026-07-24 decision 3) — this is display only.
 */
function dropReasonClass(reason: string): string {
    return reason.split(':').slice(0, 2).join(':');
}

/**
 * Funnel breakdown for a warm batch (sprint F1). Turns "our fixes felt
 * systematic" into a measurable conversion rate: what share of seeds reached a
 * cache row, and which class the rest died in.
 */
function buildFunnelSection(warm: WarmRunReport | null): string[] {
    const lines: string[] = ['## Funnel'];
    if (!warm) {
        lines.push('_skipped (--skip-warm)_');
        return lines;
    }

    const results = warm.results ?? [];
    const staged = results.filter(r => r.funnelStage);
    if (staged.length === 0) {
        // The sweep talks to the box over HTTP: an API that predates F1 returns
        // no funnel fields. Say so rather than reporting a funnel of all zeros.
        lines.push('_no funnel data — the API being swept predates the funnel instrumentation (sprint F1)_');
        return lines;
    }

    const byStage = new Map<string, number>();
    for (const r of staged) byStage.set(r.funnelStage!, (byStage.get(r.funnelStage!) ?? 0) + 1);

    const total = staged.length;
    const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
    const stageRows = [...byStage.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([stage, n]) => [stage, String(n), pct(n)]);
    lines.push(fmtTable(stageRows, ['stage', 'n', '%']));
    lines.push('');

    // Conversion = seeds that ended with a cache row. 'saved' is what THIS batch
    // converted; 'cache_hit' was already converted by an earlier batch.
    const saved = byStage.get('saved') ?? 0;
    const cacheHit = byStage.get('cache_hit') ?? 0;
    lines.push(`**Conversion**: ${pct(saved)} newly saved · ${pct(saved + cacheHit)} cached overall (${saved + cacheHit}/${total})`);

    const underGate = byStage.get('under_gate') ?? 0;
    if (underGate > 0) {
        lines.push(`**Under-gate** (served but never cached — the warm target): ${underGate} (${pct(underGate)})`);
    }
    lines.push('');

    const byClass = new Map<string, number>();
    for (const r of staged) {
        if (!r.dropReason) continue;
        const cls = dropReasonClass(r.dropReason);
        byClass.set(cls, (byClass.get(cls) ?? 0) + 1);
    }
    const drops = [...byClass.values()].reduce((a, b) => a + b, 0);
    lines.push(`### Top drop classes (${drops} drops)`);
    const classRows = [...byClass.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([cls, n]) => [cls, String(n), drops > 0 ? `${((n / drops) * 100).toFixed(1)}%` : '—']);
    lines.push(fmtTable(classRows, ['class', 'n', '% of drops']));
    if (byClass.size > 15) lines.push(`\n_(${byClass.size - 15} further classes not shown)_`);

    return lines;
}

function buildMarkdown(ranAt: string, telemetry: Telemetry, warm: WarmRunReport | null,
    seedCount: number, telemetrySeedCount: number, diff: WarmDiff | null, gate: EvalGate | null,
    stuck: StuckKeysRun | null, segReplay: SegReplayRun | null,
    coverage: { report: CacheCoverageReport; trend: CoverageTrend | null } | null): string {
    const lines: string[] = [];
    lines.push(`# Flywheel sweep — ${ranAt}`);
    lines.push('');
    lines.push(`Base: \`${BASE}\` · telemetry window: ${DAYS}d · seeds: ${seedCount} (${telemetrySeedCount} from telemetry)`);
    lines.push('');

    // Eval gate first — it's the headline.
    lines.push('## Eval gate');
    if (!gate) {
        lines.push('_skipped (--skip-eval)_');
    } else if (gate.error) {
        lines.push(`💥 **INSTRUMENT ERROR** (exit 2 — this sweep has NO gate verdict): ${gate.error}`);
    } else {
        lines.push(gate.pass
            ? `✅ **PASS** — ${gate.casesRun} cases; real failures ⊆ allowlist [${ALLOW_FAIL.join(', ')}]`
            : `❌ **FAIL** — unexpected real failures: ${gate.unexpectedFails.join(', ')}`);
        for (const f of gate.realFails) lines.push(`- [${f.id}] "${f.query}" — ${f.detail}`);
        if (gate.suppressedFails.length) {
            lines.push(`- ⚠️ real failures ABSORBED by --allow-fail (a standing red, kept visible): ${gate.suppressedFails.join(', ')}`);
        }
        if (gate.staleAllowFail.length) {
            lines.push(`- 🧹 --allow-fail entries that did NOT fail this run (stale — prune before they absorb a genuine red): ${gate.staleAllowFail.join(', ')}`);
        }
        lines.push(`- known issues still failing: ${gate.knownIssues}`);
        if (gate.knownNowPassing.length) {
            lines.push(`- 🟢 known issues NOW PASSING (promote after stability): ${gate.knownNowPassing.join(', ')}`);
        }
        if (gate.kinds) {
            for (const [kind, s] of Object.entries(gate.kinds)) {
                lines.push(`- ${kind}: ${s.pass}/${s.total} · p50 ${s.p50ms}ms · p95 ${s.p95ms}ms`);
            }
        }
    }
    lines.push('');

    // Second only to the gate: the gate says the cache is CORRECT, this says
    // whether it is yet BIG enough to be worth being correct about.
    lines.push('## Corpus coverage');
    if (!coverage) {
        lines.push('_skipped (--skip-coverage)_');
    } else {
        lines.push(...formatCoverageSection(coverage.report, coverage.trend));
    }
    lines.push('');

    lines.push('## Warm run');
    if (!warm) {
        lines.push('_skipped (--skip-warm)_');
    } else {
        const s = warm.summary;
        lines.push(`ok ${s.ok} · errors ${s.errors} · low-conf (not cached) ${s.lowConf} · sources ${JSON.stringify(s.bySource)}`);
    }
    lines.push('');

    lines.push(...buildFunnelSection(warm));
    lines.push('');

    lines.push('## Diff vs previous warm run');
    if (!diff) {
        lines.push('_skipped_');
    } else if (!diff.previous) {
        lines.push('_no previous warm report found_');
    } else {
        lines.push(`Previous: \`${path.basename(diff.previous)}\``);
        lines.push('');
        lines.push(`### Identity flips (${diff.identityFlips.length})`);
        lines.push(fmtTable(diff.identityFlips.map(f => [f.seed, f.was, f.now]), ['seed', 'was', 'now']));
        lines.push('');
        lines.push(`### kcal/100g drift >5% same record (${diff.kcalDrift.length})`);
        lines.push(fmtTable(diff.kcalDrift.map(d => [d.seed, d.foodId, String(d.was), String(d.now)]),
            ['seed', 'foodId', 'was', 'now']));
        lines.push('');
        lines.push(`### grams flap >25% (${diff.gramsFlap.length}) — AI serving-estimate stability watch`);
        lines.push(fmtTable(diff.gramsFlap.map(d => [d.seed, String(d.was), String(d.now)]), ['seed', 'was g', 'now g']));
        if (diff.newErrors.length) lines.push(`\nNew errors: ${diff.newErrors.join(', ')}`);
        if (diff.resolvedErrors.length) lines.push(`Resolved errors: ${diff.resolvedErrors.join(', ')}`);
    }
    lines.push('');

    lines.push('## Telemetry');
    if (!telemetry.ok) {
        lines.push(`_unavailable: ${telemetry.error ?? 'unknown'}_`);
    } else {
        lines.push(`${telemetry.events} live mapping events in window.`);
        lines.push('');
        lines.push(`### Top traffic keys (${Math.min(telemetry.topKeys.length, 15)} of ${telemetry.topKeys.length} shown — all fed to warmer)`);
        lines.push(fmtTable(telemetry.topKeys.slice(0, 15).map(k => [k.key, String(k.n)]), ['key', 'events']));
        lines.push('');
        lines.push(`### Attention: demanded but never cache-hit (${telemetry.attentionKeys.length})`);
        lines.push(fmtTable(telemetry.attentionKeys.map(k => [k.key, String(k.n)]), ['key', 'events']));
        lines.push('');
        lines.push(`### Cache escapes by reason`);
        lines.push(fmtTable(telemetry.escapes.map(e => [e.reason, String(e.n)]), ['reason', 'events']));
        lines.push('');
        lines.push(`### Thrash keys (≥2 distinct records resolved) (${telemetry.thrash.length})`);
        lines.push(fmtTable(telemetry.thrash.map(t => [t.key, String(t.ids), String(t.n)]), ['key', 'distinct records', 'events']));
        lines.push('');
        const totalTier = telemetry.servingTiers.reduce((a, t) => a + t.n, 0) || 1;
        lines.push(`### Serving-tier distribution (flat-100g share is the shrink metric)`);
        lines.push(fmtTable(telemetry.servingTiers.map(t =>
            [t.reason, String(t.n), `${(100 * t.n / totalTier).toFixed(1)}%`]), ['tier', 'events', 'share']));
    }
    lines.push('');

    if (stuck) {
        lines.push(...formatStuckKeysSection(stuck.report, stuck.trend));
        if (stuck.outPath) lines.push('', `Triage input: \`${path.basename(stuck.outPath)}\``);
        lines.push('');
    }

    if (segReplay) {
        lines.push(...formatSegReplaySection(segReplay.report, segReplay.trend));
        if (segReplay.outPath) lines.push('', `Artifact: \`${path.basename(segReplay.outPath)}\``);
        lines.push('');
    }
    return lines.join('\n');
}

// ---------------------------------------------------------------------------

/**
 * Corpus coverage — read-only, and the only step that answers "is the cache big
 * enough yet?" rather than "did it hold?". Never gates: a coverage number can't
 * be wrong in a way that should stop a deploy.
 */
async function runCoverageStep(ranAt: string, stamp: string): Promise<{
    report: CacheCoverageReport; trend: CoverageTrend | null;
}> {
    const prisma = new PrismaClient();
    let report: CacheCoverageReport;
    try {
        report = await collectCacheCoverage(prisma, COVERAGE_CORPUS, ranAt);
    } finally {
        await prisma.$disconnect().catch(() => {});
    }
    const previous = findPreviousCoverage(RESULTS_DIR, `flywheel-${stamp}.json`);
    return { report, trend: computeCoverageTrend(report, previous) };
}

async function main() {
    const ranAt = new Date().toISOString();
    const stamp = ranAt.replace(/[:.]/g, '-');

    // The *-only modes exist to produce exactly ONE report. Inside a full sweep
    // these steps are fail-soft by design (report-only, never gating), but when
    // the step IS the whole invocation, "unavailable: <error>" over an exit 0
    // is absence-encoded-as-success — fail closed instead.
    if (COVERAGE_ONLY) {
        console.log(`Coverage-only read @ ${ranAt} · corpus ${path.basename(COVERAGE_CORPUS)}`);
        const cov = await runCoverageStep(ranAt, stamp);
        console.log('');
        console.log(formatCoverageSection(cov.report, cov.trend).join('\n'));
        if (!cov.report.ok) {
            console.error(`\nFAIL: coverage-only run produced NO coverage read (${cov.report.error ?? 'unknown'}) — exit 2.`);
            process.exitCode = 2;
        }
        return;
    }

    if (STUCK_ONLY) {
        console.log(`Stuck-keys-only report @ ${ranAt} (window ${DAYS}d)`);
        const stuck = await runStuckKeysReport(ranAt, stamp);
        console.log('');
        console.log(formatStuckKeysSection(stuck.report, stuck.trend).join('\n'));
        if (stuck.outPath) console.log(`\nJSON: ${stuck.outPath}`);
        if (!stuck.report.ok) {
            console.error(`\nFAIL: stuck-keys-only run produced NO report (${stuck.report.error ?? 'unknown'}) — exit 2.`);
            process.exitCode = 2;
        }
        return;
    }

    if (SEG_REPLAY_ONLY) {
        console.log(`Seg-replay-only report @ ${ranAt} (top ${SEG_REPLAY_TOP} cached lines)`);
        const seg = await runSegReplayStep(ranAt, stamp);
        console.log('');
        console.log(formatSegReplaySection(seg.report, seg.trend).join('\n'));
        if (seg.outPath) console.log(`\nJSON: ${seg.outPath}`);
        if (!seg.report.ok) {
            console.error(`\nFAIL: seg-replay-only run produced NO report (${seg.report.error ?? 'unknown'}) — exit 2.`);
            process.exitCode = 2;
        }
        return;
    }

    console.log(`Flywheel sweep @ ${ranAt} → ${BASE} (window ${DAYS}d)`);

    console.log('\n[1/4] Telemetry…');
    const telemetry = await collectTelemetry();
    console.log(telemetry.ok
        ? `  ${telemetry.events} events, ${telemetry.topKeys.length} traffic keys, ${telemetry.thrash.length} thrash, ${telemetry.attentionKeys.length} attention`
        : `  unavailable: ${telemetry.error}`);

    console.log('\n[1b] Stuck keys (sub-gate, never cached)…');
    const stuck = await runStuckKeysReport(ranAt, stamp);
    console.log(stuck.report.ok
        ? `  ${stuck.report.count} stuck keys (${stuck.trend.previous === null
            ? 'first run'
            : `prev ${stuck.trend.previousCount}, Δ ${stuck.trend.delta}`})`
        : `  unavailable: ${stuck.report.error}`);

    let warm: WarmRunReport | null = null;
    let diff: WarmDiff | null = null;
    let seedCount = 0;
    const telemetrySeeds = telemetry.topKeys.map(k => k.key);
    if (SKIP_WARM) {
        console.log('\n[2/4] Warm run skipped (--skip-warm)');
    } else {
        const prevPath = latestWarmReport();
        const seeds = assembleSeeds({ extraSeeds: telemetrySeeds });
        seedCount = seeds.length;
        console.log(`\n[2/4] Warming ${seeds.length} seeds (${telemetrySeeds.length} telemetry-driven)…`);
        warm = await runWarm(seeds, { base: BASE, concurrency: CONCURRENCY });
        console.log('\n[3/4] Diffing vs previous warm report…');
        diff = diffWarmRuns(prevPath, warm.results);
        console.log(`  flips ${diff.identityFlips.length}, kcal drift ${diff.kcalDrift.length}, grams flap ${diff.gramsFlap.length}, new errors ${diff.newErrors.length}`);
    }

    let gate: EvalGate | null = null;
    if (SKIP_EVAL) {
        console.log('\n[4/4] Eval gate skipped (--skip-eval)');
    } else {
        console.log('\n[4/4] Golden-set eval gate…');
        gate = runEvalGate();
        console.log(gate.error
            ? `  INSTRUMENT ERROR (no verdict): ${gate.error}`
            : `  ${gate.pass ? 'PASS' : 'FAIL'} (${gate.casesRun} cases; real fails: ${gate.realFails.map(f => f.id).join(', ') || 'none'}`
              + `${gate.suppressedFails.length ? `; suppressed by allow-fail: ${gate.suppressedFails.join(', ')}` : ''})`);
        if (!gate.error && gate.staleAllowFail.length) {
            console.log(`  note: --allow-fail entries not failing any more: ${gate.staleAllowFail.join(', ')} (prune, or they absorb a future genuine red)`);
        }
    }

    // Report-only drift check — runs after the gate, never changes its verdict.
    console.log('\n[4b] Seg replay-diff (report-only)…');
    const segReplay = await runSegReplayStep(ranAt, stamp);
    console.log(segReplaySummaryLine(segReplay));

    // Report-only coverage read. Runs LAST so it measures the state this sweep
    // leaves behind, which is what "coverage now" has to mean.
    let coverage: { report: CacheCoverageReport; trend: CoverageTrend | null } | null = null;
    if (SKIP_COVERAGE) {
        console.log('\n[4c] Corpus coverage skipped (--skip-coverage)');
    } else {
        console.log('\n[4c] Corpus coverage (report-only)…');
        coverage = await runCoverageStep(ranAt, stamp);
        console.log(coverage.report.ok
            ? `  ${coverage.report.pct}% of ${coverage.report.total} seeds cached` +
              `${coverage.trend ? ` (${coverage.trend.deltaPct >= 0 ? '+' : ''}${coverage.trend.deltaPct}pt)` : ''}`
            : `  unavailable: ${coverage.report.error}`);
    }

    // The sweep's own exit verdict — computed BEFORE the report is written so
    // the JSON carries the same code systemd will see (flywheel-verdict.ts).
    const warmFacts: WarmFacts | null = warm
        ? { seedCount, resultCount: warm.results.length, okCount: warm.summary.ok }
        : null;
    const verdict = sweepVerdict(gate, warmFacts);

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const jsonPath = path.join(RESULTS_DIR, `flywheel-${stamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify({
        ranAt, base: BASE, days: DAYS, allowFail: ALLOW_FAIL,
        exit: verdict,
        telemetry, warmSummary: warm?.summary ?? null, warmReport: warm?.outPath ?? null,
        diff, gate,
        // Rows live in the dedicated stuck-keys-<ts>.json (triage-batch input);
        // the sweep JSON carries the summary + pointer, like warmReport.
        stuckKeys: {
            ok: stuck.report.ok, error: stuck.report.error,
            count: stuck.report.count, trend: stuck.trend, report: stuck.outPath,
        },
        // Entries live in the dedicated seg-replay-<ts>.json; summary + pointer here.
        segReplay: {
            ok: segReplay.report.ok, error: segReplay.report.error,
            topN: segReplay.report.topN, cachedLines: segReplay.report.cachedLines,
            replayed: segReplay.report.replayed, matches: segReplay.report.matches,
            drifts: segReplay.report.drifts, aiErrors: segReplay.report.aiErrors,
            driftRate: segReplay.report.driftRate,
            trend: segReplay.trend, report: segReplay.outPath,
        },
        // findPreviousCoverage reads this block back out of the previous
        // sweep's JSON — it IS the coverage history, so keep the shape stable.
        coverage: coverage ? { ...coverage.report, trend: coverage.trend } : null,
    }, null, 1));

    const md = buildMarkdown(ranAt, telemetry, warm, seedCount, telemetrySeeds.length, diff, gate, stuck, segReplay, coverage);
    const mdPath = path.join(RESULTS_DIR, `flywheel-${stamp}.md`);
    fs.writeFileSync(mdPath, md);
    console.log(`\nReport: ${mdPath}`);

    if (PUBLISH_DIR) {
        const pub = path.isAbsolute(PUBLISH_DIR) ? PUBLISH_DIR : path.join(REPO_ROOT, PUBLISH_DIR);
        if (fs.existsSync(pub)) {
            fs.copyFileSync(mdPath, path.join(pub, `flywheel-${stamp.slice(0, 10)}.md`));
            fs.copyFileSync(mdPath, path.join(pub, 'flywheel-latest.md'));
            console.log(`Published to ${pub}`);
        } else {
            console.warn(`publish dir missing, skipped: ${pub}`);
        }
    }

    // LOUD, machine-readable failure: one summary line + one reason per line on
    // stderr, and an exit code that reaches systemd (Type=oneshot marks the unit
    // failed on any nonzero). process.exitCode — not process.exit() — so every
    // report above is already flushed and nothing here can truncate it.
    if (verdict.code !== 0) {
        console.error(`\n${verdict.code === 2
            ? '💥 FLYWHEEL INSTRUMENT FAILURE — this sweep has no trustworthy numbers'
            : '❌ FLYWHEEL EVAL GATE FAILED'} (exit ${verdict.code})`);
        for (const r of verdict.reasons) console.error(`  - ${r}`);
        process.exitCode = verdict.code;
    }
}

if (require.main === module) {
    main().catch(err => { console.error(err); process.exit(2); });
}
