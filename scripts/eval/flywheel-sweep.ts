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
 *      --allow-fail (default n-mq-10). Gate failure → exit 1.
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
 *     [--days 7] [--top 100] [--concurrency 4] [--allow-fail n-mq-10] \
 *     [--skip-warm] [--skip-eval] [--publish-dir sync-docs]
 *
 * --stuck-keys-only runs JUST the stuck-key report (read-only against the DB,
 * writes only results/stuck-keys-<ts>.json) — no warm, no eval, no publish.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { assembleSeeds, runWarm, WarmResult, WarmRunReport } from './warm-cache';
import {
    collectStuckKeys, computeStuckTrend, findPreviousStuckReport, formatStuckKeysSection,
    StuckKeysReport, StuckTrend,
} from '../../src/lib/ops/stuck-keys';

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
}

const BASE = argValue('--base') ?? process.env.EVAL_API_BASE ?? 'http://localhost:3000';
const DAYS = Number(argValue('--days') ?? 7);
const TOP = Number(argValue('--top') ?? 100);
const CONCURRENCY = Number(argValue('--concurrency') ?? 4);
const ALLOW_FAIL = (argValue('--allow-fail') ?? 'n-mq-10').split(',').map(s => s.trim()).filter(Boolean);
const SKIP_WARM = args.includes('--skip-warm');
const SKIP_EVAL = args.includes('--skip-eval');
const STUCK_ONLY = args.includes('--stuck-keys-only');
const PUBLISH_DIR = argValue('--publish-dir');

const RESULTS_DIR = path.join(__dirname, 'results');
const REPO_ROOT = path.join(__dirname, '..', '..');

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

interface EvalGate {
    ran: boolean;
    pass: boolean;
    realFails: { id: string; query: string; detail: string }[];
    unexpectedFails: string[];
    knownIssues: number;
    knownNowPassing: string[];
    kinds?: Record<string, { pass: number; total: number; p50ms: number; p95ms: number }>;
    error?: string;
}

function runEvalGate(): EvalGate {
    const gate: EvalGate = { ran: false, pass: true, realFails: [], unexpectedFails: [], knownIssues: 0, knownNowPassing: [] };
    const before = new Set(
        fs.existsSync(RESULTS_DIR) ? fs.readdirSync(RESULTS_DIR).filter(f => f.startsWith('eval-')) : []);

    const proc = spawnSync('npx', [
        'ts-node', '--transpile-only',
        '--compilerOptions', '{"module":"commonjs","moduleResolution":"node"}',
        path.join(__dirname, 'run-eval.ts'), '--base', BASE,
    ], { cwd: REPO_ROOT, stdio: 'inherit', timeout: 30 * 60 * 1000 });

    if (proc.error) {
        return { ...gate, pass: false, error: `run-eval spawn failed: ${proc.error.message}` };
    }
    const evalFile = fs.readdirSync(RESULTS_DIR)
        .filter(f => f.startsWith('eval-') && !before.has(f))
        .map(f => path.join(RESULTS_DIR, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    if (!evalFile) {
        return { ...gate, pass: false, error: `run-eval produced no results file (exit ${proc.status})` };
    }

    const data = JSON.parse(fs.readFileSync(evalFile, 'utf8'));
    const results: any[] = data.results ?? [];
    gate.ran = true;
    gate.realFails = results.filter(r => !r.pass && !r.knownIssue)
        .map(r => ({ id: r.id, query: r.query, detail: r.detail }));
    gate.unexpectedFails = gate.realFails.map(r => r.id).filter(id => !ALLOW_FAIL.includes(id));
    gate.knownIssues = results.filter(r => !r.pass && r.knownIssue).length;
    gate.knownNowPassing = results.filter(r => r.pass && r.knownIssue).map(r => r.id);
    gate.kinds = data.summary?.kinds;
    gate.pass = gate.unexpectedFails.length === 0;
    return gate;
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

function buildMarkdown(ranAt: string, telemetry: Telemetry, warm: WarmRunReport | null,
    seedCount: number, telemetrySeedCount: number, diff: WarmDiff | null, gate: EvalGate | null,
    stuck: StuckKeysRun | null): string {
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
        lines.push(`❌ **ERROR**: ${gate.error}`);
    } else {
        lines.push(gate.pass
            ? `✅ **PASS** — real failures ⊆ allowlist [${ALLOW_FAIL.join(', ')}]`
            : `❌ **FAIL** — unexpected real failures: ${gate.unexpectedFails.join(', ')}`);
        for (const f of gate.realFails) lines.push(`- [${f.id}] "${f.query}" — ${f.detail}`);
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

    lines.push('## Warm run');
    if (!warm) {
        lines.push('_skipped (--skip-warm)_');
    } else {
        const s = warm.summary;
        lines.push(`ok ${s.ok} · errors ${s.errors} · low-conf (not cached) ${s.lowConf} · sources ${JSON.stringify(s.bySource)}`);
    }
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
    return lines.join('\n');
}

// ---------------------------------------------------------------------------

async function main() {
    const ranAt = new Date().toISOString();
    const stamp = ranAt.replace(/[:.]/g, '-');

    if (STUCK_ONLY) {
        console.log(`Stuck-keys-only report @ ${ranAt} (window ${DAYS}d)`);
        const stuck = await runStuckKeysReport(ranAt, stamp);
        console.log('');
        console.log(formatStuckKeysSection(stuck.report, stuck.trend).join('\n'));
        if (stuck.outPath) console.log(`\nJSON: ${stuck.outPath}`);
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
            ? `  ERROR: ${gate.error}`
            : `  ${gate.pass ? 'PASS' : 'FAIL'} (real fails: ${gate.realFails.map(f => f.id).join(', ') || 'none'})`);
    }

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const jsonPath = path.join(RESULTS_DIR, `flywheel-${stamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify({
        ranAt, base: BASE, days: DAYS, allowFail: ALLOW_FAIL,
        telemetry, warmSummary: warm?.summary ?? null, warmReport: warm?.outPath ?? null,
        diff, gate,
        // Rows live in the dedicated stuck-keys-<ts>.json (triage-batch input);
        // the sweep JSON carries the summary + pointer, like warmReport.
        stuckKeys: {
            ok: stuck.report.ok, error: stuck.report.error,
            count: stuck.report.count, trend: stuck.trend, report: stuck.outPath,
        },
    }, null, 1));

    const md = buildMarkdown(ranAt, telemetry, warm, seedCount, telemetrySeeds.length, diff, gate, stuck);
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

    if (gate && !gate.pass) {
        console.error('\nEval gate FAILED');
        process.exit(1);
    }
}

main().catch(err => { console.error(err); process.exit(2); });
