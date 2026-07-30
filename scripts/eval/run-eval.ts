/**
 * run-eval.ts — golden-set evaluation of the food mapping system.
 *
 * Hits the LIVE API (manual search + NLP magic log) with the labeled queries
 * in golden-set.json and reports accuracy per category plus latency
 * percentiles. Dependency-free (global fetch + node:fs) so it runs on any
 * machine without touching repo code paths.
 *
 * Run (from repo root):
 *   npx ts-node --transpile-only --compilerOptions '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/eval/run-eval.ts [--base http://192.168.1.133:3000] [--only search|nlp] [--grep s-brand]
 *
 * Results are written to scripts/eval/results/eval-<timestamp>.json for
 * before/after diffing across ranking or ingest changes.
 *
 * NOTE: nlp cases with `item` bypass AI segmentation (deterministic, cheaper);
 * the two `text` cases exercise the full segmentation path and cost AI calls.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    isAbstention,
    driftedKnownIssues,
    evalExitCode,
    mergeBaseline,
    scoreNlpCase,
    scoreSearchCase,
    type BaselineEntry,
} from './assertions';

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
}

const BASE = argValue('--base') ?? process.env.EVAL_API_BASE ?? 'http://192.168.1.133:3000';
const API_KEY = process.env.EVAL_API_KEY ?? 'adminAPI_dev_key_bypass';
const ONLY = argValue('--only');
const GREP = argValue('--grep');
/** Re-record the knownIssue baseline from this run instead of comparing against it. */
const WRITE_BASELINE = args.includes('--write-baseline');

const goldenPath = path.join(__dirname, 'golden-set.json');
const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));

/**
 * What the mapper actually returned, as structured values rather than prose.
 *
 * `detail` already carried these numbers, but only inside a human-readable string,
 * so nothing could compare them across runs. That is what let n-cook-06 slide from
 * kcal100=361 (wrong record) to kcal100=0 (no nutrition at all) while the gate kept
 * reporting "0 real failures" — both are outside the band, both are knownIssue, and
 * a boolean cannot express "still failing, but worse".
 */
interface Observed {
    foodId?: string | null;
    foodName?: string | null;
    source?: string | null;
    grams?: number | null;
    kcal?: number | null;
    kcal100?: number | null;
    confidence?: number | null;
    itemCount?: number;
    abstained?: boolean;
    /** No reading at all — transport error, non-array body, zero items. */
    errored?: boolean;
}

interface CaseResult {
    id: string;
    kind: 'search' | 'nlp';
    category: string;
    query: string;
    pass: boolean;
    ms: number;
    detail: string;
    confidence?: number;
    /** Documented-but-unfixed defect: failure is expected and does NOT fail the suite. */
    knownIssue?: boolean;
    observed?: Observed;
}

const results: CaseResult[] = [];

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, idx)];
}

// ---------------------------------------------------------------------------
// knownIssue baseline
// ---------------------------------------------------------------------------


const baselinePath = path.join(__dirname, 'known-issue-baseline.json');

function loadKnownIssueBaseline(): Record<string, BaselineEntry> {
    try {
        return JSON.parse(fs.readFileSync(baselinePath, 'utf8')).cases ?? {};
    } catch {
        return {};
    }
}

/**
 * Re-record the baseline for the pins THIS RUN observed, preserving every other entry.
 *
 * MERGES rather than replaces, and that is not a nicety. The baseline held 15 pins, 13
 * of them nlp; a `--write-baseline --only search` run knows about 2. Rebuilding the file
 * from `rs` alone deleted the other 13 — and because driftedKnownIssues() skips any case
 * with no baseline entry ("nothing to compare"), those 13 would have gone PERMANENTLY
 * exempt from drift detection, silently, with the run still exiting 0. The same applies
 * to any --grep. A filtered run must be able to refresh its own pins without quietly
 * dropping coverage for the ones it did not execute.
 */
function writeKnownIssueBaseline(rs: CaseResult[]): void {
    const fresh: Record<string, BaselineEntry> = {};
    for (const r of rs) {
        if (!r.knownIssue || !r.observed) continue;
        fresh[r.id] = {
            foodId: r.observed.foodId ?? null,
            foodName: r.observed.foodName ?? null,
            grams: r.observed.grams ?? null,
            kcal100: r.observed.kcal100 ?? null,
            abstained: r.observed.abstained ?? false,
            errored: r.observed.errored ?? false,
            itemCount: r.observed.itemCount,
        };
    }
    const { cases, refreshed, preserved } = mergeBaseline(loadKnownIssueBaseline(), fresh);
    fs.writeFileSync(baselinePath, JSON.stringify({
        _readme: 'Recorded state of each knownIssue case. run-eval compares against this and '
            + 'reports 🟠 DRIFT when a pinned case keeps failing but fails DIFFERENTLY — the '
            + 'signal a pass/fail boolean cannot carry. Refresh with --write-baseline once the '
            + 'new values are understood to be the intended state. Writes MERGE: a filtered '
            + '(--only/--grep) run refreshes only the pins it ran and leaves the rest intact.',
        writtenAt: new Date().toISOString(),
        cases,
    }, null, 2) + '\n');
    // Say what was and was not touched. A refresh that silently covers fewer cases than
    // the reader assumes is the failure this whole file exists to prevent.
    console.log(`baseline written: ${refreshed} pin(s) refreshed from this run, ${preserved} preserved untouched `
        + `(${Object.keys(cases).length} total).`);
    if (ONLY || GREP) {
        console.log(`  NOTE: run was filtered (${ONLY ? `--only ${ONLY}` : ''}${GREP ? ` --grep ${GREP}` : ''}) — `
            + `the preserved entries were NOT re-measured.`);
    }
}

/** Every knownIssue case whose recorded values moved since the baseline was written. */
function compareKnownIssueBaseline(rs: CaseResult[]): Array<{ id: string; what: string }> {
    return driftedKnownIssues(rs, loadKnownIssueBaseline());
}

async function runSearchCase(c: any): Promise<CaseResult> {
    const t0 = Date.now();
    try {
        const res = await fetch(`${BASE}/api/foods/search?s=${encodeURIComponent(c.query)}&local=true`, {
            headers: { 'x-api-key': API_KEY },
        });
        const ms = Date.now() - t0;
        const body: any = await res.json();
        const hits: any[] = Array.isArray(body) ? body : (body.data ?? body.results ?? []);
        const { pass, detail } = scoreSearchCase(c, hits);
        const confidence = hits[0]?.confidence;
        return {
            id: c.id, kind: 'search', category: c.category, query: c.query, pass, ms, detail, confidence,
            knownIssue: c.knownIssue,
            observed: {
                foodId: hits[0]?.id ?? hits[0]?.foodId ?? null,
                foodName: hits[0]?.name ?? null,
                kcal100: hits[0]?.kcal100 ?? null,
                confidence: confidence ?? null,
                itemCount: hits.length,
            },
        };
    } catch (err) {
        // `observed` is recorded even here. Without it a knownIssue case that starts
        // throwing is invisible twice over: the failure is exempted by the pin AND the
        // drift check has nothing to diff, so a pinned case that stopped answering
        // altogether left no trace in any output.
        return {
            id: c.id, kind: 'search', category: c.category, query: c.query, pass: false,
            ms: Date.now() - t0, detail: `ERROR: ${(err as Error).message}`, knownIssue: c.knownIssue,
            observed: { itemCount: 0, errored: true },
        };
    }
}

async function runNlpCase(c: any): Promise<CaseResult> {
    const t0 = Date.now();
    const query = c.item?.name ?? c.text;
    try {
        const body = c.item ? { items: [c.item] } : { text: c.text };
        const res = await fetch(`${BASE}/api/nlp/parse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
            body: JSON.stringify(body),
        });
        const ms = Date.now() - t0;
        const items: any[] = await res.json();
        if (!Array.isArray(items) || items.length === 0) {
            // Carries knownIssue for consistency with the catch branch below — otherwise a
            // transport hiccup on a pinned case reads as a REAL failure while an exception
            // on the same case is absorbed. The drift check still surfaces it, because
            // itemCount 1 -> 0 is a recorded change.
            return {
                id: c.id, kind: 'nlp', category: c.category, query, pass: false, ms,
                detail: `TRANSPORT: no items returned (HTTP ${res.status})`,
                knownIssue: c.knownIssue,
                observed: { itemCount: 0, errored: true },
            };
        }

        const failures = scoreNlpCase(c, items);

        const confidence = items[0]?.matchConfidence;
        return {
            id: c.id, kind: 'nlp', category: c.category, query,
            pass: failures.length === 0, ms,
            detail: failures.length ? failures.join('; ') : `mapped: "${items[0]?.foodName}" grams=${items[0]?.grams} conf=${confidence?.toFixed(2)}`,
            confidence, knownIssue: c.knownIssue,
            observed: {
                foodId: items[0]?.foodId ?? null,
                foodName: items[0]?.foodName ?? null,
                source: items[0]?.source ?? null,
                grams: items[0]?.grams ?? null,
                kcal: items[0]?.nutrition?.calories ?? null,
                kcal100: items[0]?.nutritionPer100g?.kcal100 ?? null,
                confidence: confidence ?? null,
                itemCount: items.length,
                abstained: isAbstention(items[0]),
            },
        };
    } catch (err) {
        // See runSearchCase: `observed` is recorded on the error path too, so a pinned
        // case that stops answering drifts instead of disappearing entirely.
        return {
            id: c.id, kind: 'nlp', category: c.category, query, pass: false,
            ms: Date.now() - t0, detail: `ERROR: ${(err as Error).message}`, knownIssue: c.knownIssue,
            observed: { itemCount: 0, errored: true },
        };
    }
}

async function main() {
    const searchCases = (ONLY && ONLY !== 'search') ? [] : golden.search.filter((c: any) => !GREP || c.id.includes(GREP));
    const nlpCases = (ONLY && ONLY !== 'nlp') ? [] : golden.nlp.filter((c: any) => !GREP || c.id.includes(GREP));

    console.log(`Eval against ${BASE} — ${searchCases.length} search + ${nlpCases.length} nlp cases\n`);

    // Warm the API (dev-mode compile, embedding model) so case 1 isn't penalized.
    await fetch(`${BASE}/api/foods/search?s=warmup&local=true`, { headers: { 'x-api-key': API_KEY } }).catch(() => {});

    const mark = (r: CaseResult) =>
        r.pass ? (r.knownIssue ? '🟢' : '✅') : (r.knownIssue ? '🟡' : '❌');
    const line = (r: CaseResult) => {
        const nowPassing = r.pass && r.knownIssue ? ' (known-issue NOW PASSING — promote it)' : '';
        console.log(`${mark(r)} [${r.id}] "${r.query}" (${r.ms}ms) ${r.pass ? '' : '— ' + r.detail}${nowPassing}`);
    };

    for (const c of searchCases) {
        const r = await runSearchCase(c);
        results.push(r);
        line(r);
    }
    for (const c of nlpCases) {
        const r = await runNlpCase(c);
        results.push(r);
        line(r);
    }

    // ---- Summary ----
    const byKind = (kind: string) => results.filter(r => r.kind === kind);
    const summary: any = { base: BASE, ranAt: new Date().toISOString(), kinds: {}, categories: {} };

    for (const kind of ['search', 'nlp']) {
        const rs = byKind(kind);
        if (!rs.length) continue;
        const passed = rs.filter(r => r.pass).length;
        const lat = rs.map(r => r.ms).sort((a, b) => a - b);
        summary.kinds[kind] = {
            pass: passed, total: rs.length,
            p50ms: percentile(lat, 50), p95ms: percentile(lat, 95), p99ms: percentile(lat, 99), maxMs: lat[lat.length - 1],
        };
    }
    for (const r of results) {
        const key = `${r.kind}/${r.category}`;
        summary.categories[key] = summary.categories[key] ?? { pass: 0, total: 0 };
        summary.categories[key].total++;
        if (r.pass) summary.categories[key].pass++;
    }

    const realFails = results.filter(r => !r.pass && !r.knownIssue);
    const knownFails = results.filter(r => !r.pass && r.knownIssue);
    const knownNowPassing = results.filter(r => r.pass && r.knownIssue);
    summary.realFailures = realFails.length;
    summary.knownIssues = knownFails.length;

    console.log('\n================ SUMMARY ================');
    for (const [kind, s] of Object.entries(summary.kinds) as [string, any][]) {
        console.log(`${kind.padEnd(7)} ${s.pass}/${s.total} pass  |  p50 ${s.p50ms}ms  p95 ${s.p95ms}ms  p99 ${s.p99ms}ms  max ${s.maxMs}ms`);
    }
    console.log('---- by category ----');
    for (const [cat, s] of Object.entries(summary.categories) as [string, any][]) {
        const flag = s.pass === s.total ? '  ' : '⚠️ ';
        console.log(`${flag}${cat.padEnd(28)} ${s.pass}/${s.total}`);
    }

    if (knownFails.length) {
        console.log(`\n---- 🟡 known issues (${knownFails.length}, documented, NOT blocking) ----`);
        for (const r of knownFails) console.log(`   [${r.id}] "${r.query}" — ${r.detail}`);
    }
    if (knownNowPassing.length) {
        console.log(`\n---- 🟢 known issues NOW PASSING (${knownNowPassing.length} — promote to hard assertions) ----`);
        for (const r of knownNowPassing) console.log(`   [${r.id}] "${r.query}"`);
    }

    // ---- knownIssue DRIFT ----
    // knownIssue is a whole-case, all-reasons, unbounded exemption: a pinned case can
    // move from "wrong record, right ballpark" to "0 kcal" or "no record at all" and the
    // gate still says "0 real failures", because a boolean cannot express "still failing,
    // but differently". n-cook-06 did exactly that (kcal100 361 -> 0). Comparing the
    // recorded values catches it.
    const drifts = compareKnownIssueBaseline(results);
    if (drifts.length) {
        console.log(`\n---- 🟠 knownIssue DRIFT (${drifts.length}) — still failing, but the failure CHANGED ----`);
        for (const d of drifts) console.log(`   [${d.id}] ${d.what}`);
        console.log(`   (non-gating. If the new values are the intended state, refresh with --write-baseline.)`);
    }
    summary.knownIssueDrift = drifts.length;

    if (WRITE_BASELINE) {
        // The per-pin accounting (refreshed vs preserved) is printed inside the writer —
        // this count is only the pins THIS run saw, which on a filtered run is not the
        // size of the file and must not be reported as though it were.
        console.log(`\nBaseline written to ${path.relative(process.cwd(), baselinePath)}:`);
        writeKnownIssueBaseline(results);
    }

    const outDir = path.join(__dirname, 'results');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2));
    console.log(`\nResults written to ${path.relative(process.cwd(), outPath)}`);
    if (results.length === 0) {
        console.error('\n❗ ZERO cases ran. Check --only / --grep and the golden-set file. '
            + 'A run that executed nothing is not a green run — exiting 2.');
    } else {
        console.log(`\n${realFails.length ? '❌' : '✅'} ${realFails.length} real failures, 🟡 ${knownFails.length} known issues (expected).`);
    }

    // Only genuine (non-known-issue) failures fail the suite — but zero cases is a 2.
    process.exit(evalExitCode(results));
}

main().catch(err => { console.error(err); process.exit(2); });
