/**
 * flywheel-verdict.ts — the flywheel sweep's PURE verdict logic, split out of
 * flywheel-sweep.ts so it can be fail-injection tested offline (no Prisma, no
 * network, no child processes; see __tests__/fail-open-sweep.test.ts).
 *
 * WHY THIS FILE EXISTS (playbook §11 class B — absence encoded as a PASS)
 *
 * run-eval.ts exits 2 when it executed ZERO cases — that is PR #177's
 * `evalExitCode` fix, and it is run-eval's own fail-closed signal. But
 * flywheel-sweep's old `runEvalGate()` never looked at the child's exit code:
 * whenever a results file existed it re-derived pass/fail from
 * `data.results ?? []`, and an empty results array yields zero real failures,
 * which reads as "real failures ⊆ allowlist" — a PASS. run-eval writes its
 * results file BEFORE exiting, including on the zero-case path, so the sweep
 * converted run-eval's own red into a green and exited 0 into systemd.
 * `judgeEvalGate` closes that: the child's exit code is evidence that a
 * results file cannot override.
 *
 * The same audit found three sibling holes, all closed here:
 *   - a warm step whose every request failed ("0 warmed" summarised, exit 0);
 *   - a warm step that recorded zero results because the worker pool never
 *     ran (NaN --concurrency);
 *   - an eval exit code that CONTRADICTS the results file (wrong/stale file
 *     picked up from results/) being resolved in favour of whichever side
 *     looked greener.
 *
 * And one thing deliberately NOT fixed here: the gate is POST-HOC. The warm
 * at step [2/4] has already written to FoodMapping before the gate at [4/4]
 * runs, and nothing is rolled back on failure (playbook §2). This module
 * cannot change that ordering — what it does is say so, loudly, in the
 * failure reasons, so a red gate is never read as "the sweep wrote nothing".
 */

export interface EvalGate {
    /** true only when run-eval produced a receipt this module trusts end-to-end */
    ran: boolean;
    pass: boolean;
    /** number of cases the results file actually contains */
    casesRun: number;
    realFails: { id: string; query: string; detail: string }[];
    /** real failures NOT covered by --allow-fail — these fail the gate */
    unexpectedFails: string[];
    /** real failures absorbed by --allow-fail — reported so a standing red stays visible */
    suppressedFails: string[];
    /** --allow-fail ids that did NOT fail this run — stale entries worth pruning */
    staleAllowFail: string[];
    knownIssues: number;
    knownNowPassing: string[];
    kinds?: Record<string, { pass: number; total: number; p50ms: number; p95ms: number }>;
    /** set when the gate could not produce a trustworthy verdict (instrument failure) */
    error?: string;
}

/** Everything the spawned run-eval.ts left behind, gathered by flywheel-sweep. */
export interface EvalRunEvidence {
    /** spawnSync failed outright (ENOENT, ETIMEDOUT, ...) */
    spawnError?: string;
    /** child exit code; null when the child was killed by a signal */
    status: number | null;
    signal?: string | null;
    /** the new results file the run produced, if one was found */
    resultsFile: string | null;
    /** set when the results file existed but could not be parsed */
    parseError?: string;
    data?: { summary?: { kinds?: EvalGate['kinds'] }; results?: unknown[] } | null;
}

interface RawCaseResult {
    id?: string;
    query?: string;
    detail?: string;
    pass?: boolean;
    knownIssue?: boolean;
}

function failedGate(error: string): EvalGate {
    return {
        ran: false, pass: false, casesRun: 0, realFails: [], unexpectedFails: [],
        suppressedFails: [], staleAllowFail: [], knownIssues: 0, knownNowPassing: [],
        error,
    };
}

/**
 * Turn the evidence of one run-eval invocation into a gate verdict.
 *
 * Ordering of the refusals matters: the child's own exit code is judged BEFORE
 * the results file's contents, because run-eval exiting 2 is its fail-closed
 * signal (evalExitCode, PR #177) and a results file — which run-eval writes
 * even on the zero-case path — must never override it.
 */
export function judgeEvalGate(run: EvalRunEvidence, allowFail: string[]): EvalGate {
    if (run.spawnError) {
        return failedGate(`run-eval spawn failed: ${run.spawnError}`);
    }
    if (run.status === null) {
        return failedGate(`run-eval was KILLED (signal ${run.signal ?? 'unknown'}) — there is no receipt to trust`);
    }
    if (!run.resultsFile) {
        return failedGate(`run-eval produced no results file (exit ${run.status})`);
    }
    if (run.parseError) {
        return failedGate(`run-eval results file is unreadable: ${run.parseError}`);
    }

    const results = (run.data?.results ?? []) as RawCaseResult[];

    if (run.status === 2) {
        // run-eval's OWN fail-closed verdict (zero cases executed, or an internal
        // crash after main started). It writes the results file before exiting,
        // so "the file exists and lists no failures" is exactly the shape this
        // branch must refuse to read as a pass.
        return {
            ...failedGate(`run-eval exited 2 — its own fail-closed signal (zero cases or internal failure). `
                + `A results file listing ${results.length} case(s) does not override the exit code.`),
            casesRun: results.length,
        };
    }
    if (run.status !== 0 && run.status !== 1) {
        return failedGate(`run-eval exited ${run.status} — unrecognised code, refusing to read it as any verdict`);
    }
    if (results.length === 0) {
        return failedGate('run-eval results file contains ZERO cases — a gate that evaluated nothing cannot pass');
    }

    const realFails = results
        .filter(r => !r.pass && !r.knownIssue)
        .map(r => ({ id: String(r.id ?? '?'), query: String(r.query ?? ''), detail: String(r.detail ?? '') }));

    // Exit code and file must AGREE, or we are reading the wrong file — e.g. a
    // stale results/ entry picked up because the child died before writing its
    // own. evalExitCode returns 1 iff a non-knownIssue case failed, so any
    // disagreement means the receipt does not belong to this run.
    if (run.status === 1 && realFails.length === 0) {
        return failedGate('run-eval exited 1 (real failures) but the results file shows none — '
            + 'wrong or stale file; refusing to pass on it');
    }
    if (run.status === 0 && realFails.length > 0) {
        return failedGate(`run-eval exited 0 but the results file shows ${realFails.length} real failure(s) — `
            + 'wrong or stale file; refusing to judge from it');
    }

    const failIds = realFails.map(f => f.id);
    const gate: EvalGate = {
        ran: true,
        pass: false,
        casesRun: results.length,
        realFails,
        unexpectedFails: failIds.filter(id => !allowFail.includes(id)),
        suppressedFails: failIds.filter(id => allowFail.includes(id)),
        staleAllowFail: allowFail.filter(id => !failIds.includes(id)),
        knownIssues: results.filter(r => !r.pass && r.knownIssue).length,
        knownNowPassing: results.filter(r => r.pass && r.knownIssue).map(r => String(r.id ?? '?')),
        kinds: run.data?.summary?.kinds,
    };
    gate.pass = gate.unexpectedFails.length === 0;
    return gate;
}

/** The warm step's outcome, reduced to what the sweep verdict needs. */
export interface WarmFacts {
    seedCount: number;
    resultCount: number;
    okCount: number;
}

export interface SweepVerdict {
    /** 0 = clean · 1 = the gate ran and FAILED · 2 = an instrument failed (numbers are void) */
    code: 0 | 1 | 2;
    reasons: string[];
}

/**
 * The sweep's process exit code, from the gate verdict and the warm facts.
 * Pass null for a step that was skipped (--skip-warm / --skip-eval).
 *
 * 2 beats 1: "the sweep could not measure" and "the sweep measured a failure"
 * are different states and systemd should be able to tell them apart.
 */
export function sweepVerdict(gate: EvalGate | null, warm: WarmFacts | null): SweepVerdict {
    const reasons: string[] = [];
    let code: 0 | 1 | 2 = 0;

    if (warm) {
        if (warm.seedCount === 0) {
            code = 2;
            reasons.push('INSTRUMENT: the warm step assembled ZERO seeds — corpus files missing or empty; nothing was warmed');
        } else if (warm.resultCount === 0) {
            code = 2;
            reasons.push(`INSTRUMENT: the warm step attempted ${warm.seedCount} seeds but recorded ZERO results — the worker pool never ran`);
        } else if (warm.okCount === 0) {
            code = 2;
            reasons.push(`INSTRUMENT: warm TOTAL failure — 0 of ${warm.resultCount} seeds resolved; nothing was reachable, `
                + 'so every downstream number in this sweep is void');
        }
    }

    if (gate) {
        if (gate.error) {
            code = 2;
            reasons.push(`INSTRUMENT: the eval gate could not produce a verdict — ${gate.error}`);
        } else if (!gate.pass) {
            if (code < 1) code = 1;
            reasons.push(`EVAL GATE FAILED: unexpected real failures [${gate.unexpectedFails.join(', ')}]`);
            if (warm && warm.okCount > 0) {
                // The gate is post-hoc (playbook §2): make the write-before-gate
                // ordering explicit so a red exit is never read as "nothing happened".
                reasons.push(`POST-HOC GATE: the warm step already ran (${warm.okCount}/${warm.seedCount} ok) `
                    + 'BEFORE this gate failed — its writes to FoodMapping are NOT rolled back');
            }
        }
    }

    return { code, reasons };
}
