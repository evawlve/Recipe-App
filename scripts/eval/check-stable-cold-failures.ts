/**
 * check-stable-cold-failures.ts — diff a COLD eval run against the pinned
 * STABLE COLD FAILURES roster (stable-cold-failures.json) and report the two
 * things a human reading a results file keeps getting wrong:
 *
 *   NEW MEMBER   — a HARD case failed cold that is not on the roster and is
 *                  not a documented rotator. Something got worse.
 *   LEFT THE SET — a roster member PASSED. Something got fixed, and the
 *                  roster is now stale by one.
 *
 * WHY THIS FILE EXISTS
 *
 * The cold set was prose. It lived in several documents, they disagreed about
 * its size, and on 2026-08-19 a ten quietly became a nine: n-dens-07 failed
 * six consecutive cold runs, then its band was corrected and it left, and
 * nothing in the repo noticed because "is this a new failure?" was adjudicated
 * by reading. This script makes that a diff.
 *
 * WHAT THIS IS NOT — and the distinction is the point of the whole exercise:
 *
 *  - NOT the nightly's "known issues still failing: N". That number is WARM,
 *    over the 21 cases flagged `knownIssue` in golden-set.json — cases that are
 *    already EXCUSED and whose failure evalExitCode deliberately does not count.
 *    This instrument is COLD, over HARD assertions that are genuinely red. The
 *    two populations are disjoint. They were both being called "ten", on the
 *    same page, which is how the transition above survived. Every line this
 *    script prints therefore says which instrument it speaks for.
 *
 *  - NOT known-issue-baseline{,-cold}.json. Those pin per-case OBSERVED VALUES
 *    for the excused population so run-eval can report 🟠 DRIFT (non-gating,
 *    run-eval.ts:427). This pins MEMBERSHIP for the un-excused population.
 *
 *  - NOT an allowlist. It is read by nobody but itself, it is not wired to
 *    flywheel-sweep's --allow-fail (which defaults EMPTY by design, pinned by
 *    the doc-check claim `flywheel-allow-fail-defaults-empty`), and it cannot
 *    turn a red nightly green. A member leaves this set when someone FIXES it.
 *
 * FAIL-CLOSED (playbook §11 class B — absence encoded as a PASS). "No new
 * members" is the answer a reader wants, so every way of producing it without
 * having measured anything is refused before the comparison runs: no results
 * file, an unparseable one, a file with zero cases, a file from a WARM run
 * (the wrong instrument entirely — warm has no stable cold set), an empty or
 * malformed roster, and a filtered run that executed none of the roster.
 * See __tests__/stable-cold-failures.test.ts.
 *
 * Run (from repo root):
 *   npm run eval:cold-set -- [--results <eval-*.json>] [--roster <file>]
 *
 * With no --results it reads the NEWEST eval-*.json in scripts/eval/results.
 * Exit: 0 = set unchanged · 1 = the set CHANGED · 2 = instrument failure.
 */

import * as fs from 'fs';
import * as path from 'path';

/** The name this instrument answers to. Never print a bare count without it. */
export const INSTRUMENT = 'stable-cold-failures' as const;
export const INSTRUMENT_LABEL = 'stable cold failures';

export interface RosterEntry {
    id: string;
    category?: string;
    reason?: string;
}

/** stable-cold-failures.json, as far as this module cares. */
export interface ColdSetRoster {
    members: RosterEntry[];
    rotators?: RosterEntry[];
    confirmedAgainst?: { buildId?: string | null; date?: string };
}

interface RawCaseResult {
    id?: string;
    query?: string;
    detail?: string;
    pass?: boolean;
    knownIssue?: boolean;
}

/** Everything a run-eval receipt left behind, gathered by readColdRunEvidence. */
export interface ColdRunEvidence {
    /** The results file read, or null when none was found. */
    resultsFile: string | null;
    /** Set when the file existed but would not parse. */
    parseError?: string;
    data?: {
        summary?: { noCache?: boolean; buildId?: string | null; ranAt?: string };
        results?: unknown[];
    } | null;
}

export interface ColdSetVerdict {
    /** Self-identifying: which instrument produced this verdict. */
    instrument: typeof INSTRUMENT;
    label: string;
    /** True only when the evidence was trusted end-to-end and a comparison ran. */
    ran: boolean;
    /** True only when the observed set is exactly the roster (rotators aside). */
    ok: boolean;
    casesRun: number;
    buildId: string | null;
    resultsFile: string | null;
    /** Roster members that failed cold, as pinned. */
    confirmed: string[];
    /** HARD cold failures that are neither roster members nor rotators. */
    newMembers: Array<{ id: string; query: string; detail: string }>;
    /** Roster members this run PASSED — the roster is stale by these. */
    leftTheSet: string[];
    /** Documented rotators that failed this run. Expected; not new members. */
    rotatorsPresent: string[];
    /** Roster members the results file does not contain — filtered run, not judged. */
    notRun: string[];
    /** True when notRun is non-empty: this run cannot clear the whole roster. */
    partial: boolean;
    /** Set when no trustworthy verdict could be produced. Numbers are void. */
    error?: string;
}

function voidVerdict(error: string, over: Partial<ColdSetVerdict> = {}): ColdSetVerdict {
    return {
        instrument: INSTRUMENT,
        label: INSTRUMENT_LABEL,
        ran: false,
        ok: false,
        casesRun: 0,
        buildId: null,
        resultsFile: null,
        confirmed: [],
        newMembers: [],
        leftTheSet: [],
        rotatorsPresent: [],
        notRun: [],
        partial: false,
        error,
        ...over,
    };
}

/**
 * Compare one cold run against the roster.
 *
 * Ordering of the refusals matters. The ROSTER is judged first, because it is
 * this instrument's own calibration: an empty or malformed roster reports "no
 * new members" about nothing at all, and would do so for every run forever.
 * The run's COLDNESS is judged before its contents, because a warm receipt is
 * not a weaker cold receipt — it is a different measurement, and the set it
 * would be compared against does not exist warm.
 */
export function judgeColdFailureSet(run: ColdRunEvidence, roster: ColdSetRoster | null): ColdSetVerdict {
    if (!roster || !Array.isArray(roster.members)) {
        return voidVerdict(`the ${INSTRUMENT_LABEL} roster is missing or malformed — `
            + 'without it every run reports "no new members" about nothing');
    }
    const members = roster.members.map(m => m?.id).filter((s): s is string => typeof s === 'string' && s.length > 0);
    if (members.length === 0) {
        return voidVerdict(`the ${INSTRUMENT_LABEL} roster lists ZERO members — an empty roster `
            + 'cannot distinguish a clean run from a total regression; refusing to compare');
    }
    const rotators = (roster.rotators ?? []).map(r => r?.id).filter((s): s is string => typeof s === 'string' && s.length > 0);

    if (!run.resultsFile) {
        return voidVerdict('no cold results file was found — there is nothing to compare the roster against');
    }
    if (run.parseError) {
        return voidVerdict(`the results file is unreadable: ${run.parseError}`, { resultsFile: run.resultsFile });
    }
    const summary = run.data?.summary;
    if (!summary || typeof summary !== 'object') {
        return voidVerdict('the results file carries no summary — WARM and COLD are indistinguishable in it, '
            + 'and this set exists only cold', { resultsFile: run.resultsFile });
    }
    if (summary.noCache !== true) {
        // The single most likely misuse: pointing this at the nightly's receipt.
        // A warm run resolves ~85% of nlp cases from FoodMapping, so its failures
        // are a statement about the cache, not about the pipeline. Comparing them
        // to a cold roster would read as mass regression AND mass recovery at once.
        return voidVerdict(`WRONG INSTRUMENT: this results file is from a WARM run (summary.noCache=`
            + `${JSON.stringify(summary.noCache)}). ${INSTRUMENT_LABEL} are defined only on a COLD run `
            + '(run-eval --nocache); a warm receipt cannot confirm or refute a single member',
        { resultsFile: run.resultsFile, buildId: summary.buildId ?? null });
    }

    const results = (run.data?.results ?? []) as RawCaseResult[];
    if (results.length === 0) {
        return voidVerdict('the results file contains ZERO cases — a run that evaluated nothing '
            + 'cannot report "no new members"', { resultsFile: run.resultsFile, buildId: summary.buildId ?? null });
    }

    const ran = new Map<string, RawCaseResult>();
    for (const r of results) if (typeof r?.id === 'string') ran.set(r.id, r);

    const notRun = members.filter(id => !ran.has(id));
    if (notRun.length === members.length) {
        return voidVerdict(`this run executed NONE of the ${members.length} roster member(s) `
            + `(${results.length} case(s) ran — a --only/--grep filter?). It carries no information `
            + `about the ${INSTRUMENT_LABEL} set`,
        { resultsFile: run.resultsFile, buildId: summary.buildId ?? null, casesRun: results.length, notRun });
    }

    // A HARD failure is a failing case that is NOT knownIssue — run-eval's own
    // definition (evalExitCode counts exactly these), and the population this
    // roster is drawn from. knownIssue failures belong to the OTHER instrument.
    const hardFails = results.filter(r => !r.pass && !r.knownIssue);

    const confirmed = members.filter(id => { const r = ran.get(id); return !!r && !r.pass; });
    // Only a member the run actually EXECUTED and that PASSED has left the set.
    // Absent is not passing: a filtered run must never retire a case it skipped.
    const leftTheSet = members.filter(id => { const r = ran.get(id); return !!r && r.pass === true; });
    const rotatorsPresent = rotators.filter(id => hardFails.some(r => r.id === id));
    const newMembers = hardFails
        .filter(r => !members.includes(r.id as string) && !rotators.includes(r.id as string))
        .map(r => ({ id: String(r.id ?? '?'), query: String(r.query ?? ''), detail: String(r.detail ?? '') }));

    return {
        instrument: INSTRUMENT,
        label: INSTRUMENT_LABEL,
        ran: true,
        ok: newMembers.length === 0 && leftTheSet.length === 0,
        casesRun: results.length,
        buildId: summary.buildId ?? null,
        resultsFile: run.resultsFile,
        confirmed,
        newMembers,
        leftTheSet,
        rotatorsPresent,
        notRun,
        partial: notRun.length > 0,
    };
}

/**
 * 0 = the set is exactly as pinned · 1 = the set CHANGED · 2 = instrument failure.
 *
 * 2 beats 1, same dialect as sweepVerdict: "could not measure" and "measured a
 * change" are different states and a caller should be able to tell them apart.
 */
export function coldSetExitCode(v: ColdSetVerdict): 0 | 1 | 2 {
    if (v.error || !v.ran) return 2;
    return v.ok ? 0 : 1;
}

/** Human-readable report. Every line names the instrument — see the header comment. */
export function formatColdSetReport(v: ColdSetVerdict): string[] {
    const tag = `[${INSTRUMENT_LABEL}]`;
    const out: string[] = [];
    out.push(`================ STABLE COLD FAILURES ================`);
    out.push(`instrument: ${INSTRUMENT} — COLD (--nocache) run, HARD assertions only.`);
    out.push(`NOT the nightly's "known issues still failing" line: that is a WARM count over the`);
    out.push(`knownIssue population, a disjoint set of already-excused cases. Do not compare the two numbers.`);
    if (v.resultsFile) out.push(`results: ${v.resultsFile}${v.buildId ? `  (build ${v.buildId})` : ''}`);

    if (v.error) {
        out.push(`💥 ${tag} INSTRUMENT FAILURE — this check has no trustworthy verdict: ${v.error}`);
        return out;
    }

    out.push(`${tag} ${v.confirmed.length} of ${v.confirmed.length + v.leftTheSet.length + v.notRun.length} `
        + `roster member(s) confirmed still failing cold, out of ${v.casesRun} case(s) run.`);
    if (v.rotatorsPresent.length) {
        out.push(`   🔁 ${tag} documented rotators failing this run (expected to flap, NOT new members): `
            + v.rotatorsPresent.join(', '));
    }
    if (v.notRun.length) {
        out.push(`   ⚠️  ${tag} PARTIAL — ${v.notRun.length} roster member(s) were not executed by this run `
            + `(filtered?), so they are neither confirmed nor retired: ${v.notRun.join(', ')}`);
    }
    if (v.newMembers.length) {
        out.push(`   ❌ ${tag} NEW MEMBER (${v.newMembers.length}) — hard case(s) failing cold that the roster does not list:`);
        for (const m of v.newMembers) out.push(`      [${m.id}] "${m.query}" — ${m.detail}`);
        out.push(`      → triage them, then either fix them or add them to stable-cold-failures.json with a reason.`);
    }
    if (v.leftTheSet.length) {
        out.push(`   ✅ ${tag} LEFT THE SET (${v.leftTheSet.length}) — roster member(s) that PASSED this run: `
            + v.leftTheSet.join(', '));
        out.push(`      → confirm over 2-3 cold runs, then REMOVE them from stable-cold-failures.json. This is`);
        out.push(`         the transition that went unnoticed on 2026-08-19 (n-dens-07) and made ten read as nine.`);
    }
    out.push(v.ok
        ? `✅ ${tag} unchanged${v.partial ? ' (for the members this run executed)' : ''}.`
        : `❗ ${tag} THE SET CHANGED — stable-cold-failures.json is now out of date.`);
    return out;
}

// ---------------------------------------------------------------------------
// IO — thin, and kept out of the verdict above so the verdict is testable offline
// ---------------------------------------------------------------------------

export const ROSTER_PATH = path.join(__dirname, 'stable-cold-failures.json');
export const RESULTS_DIR = path.join(__dirname, 'results');

export function loadRoster(file: string = ROSTER_PATH): ColdSetRoster | null {
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed as ColdSetRoster : null;
    } catch {
        // A missing or corrupt roster is not "no members" — judgeColdFailureSet
        // voids on null, which is the whole point of returning it.
        return null;
    }
}

/**
 * Gather the receipt. Same locator idiom as flywheel-sweep's runEvalGate:
 * eval-*.json in the results dir, newest by mtime.
 */
export function readColdRunEvidence(file?: string, resultsDir: string = RESULTS_DIR): ColdRunEvidence {
    let target = file ?? null;
    if (!target) {
        target = (fs.existsSync(resultsDir) ? fs.readdirSync(resultsDir) : [])
            .filter(f => f.startsWith('eval-') && f.endsWith('.json'))
            .map(f => path.join(resultsDir, f))
            .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null;
    }
    if (!target || !fs.existsSync(target)) return { resultsFile: null };
    try {
        return { resultsFile: target, data: JSON.parse(fs.readFileSync(target, 'utf8')) };
    } catch (err) {
        return { resultsFile: target, parseError: (err as Error).message };
    }
}

function main(): number {
    const args = process.argv.slice(2);
    const argValue = (flag: string): string | undefined => {
        const i = args.indexOf(flag);
        return i >= 0 ? args[i + 1] : undefined;
    };
    const verdict = judgeColdFailureSet(
        readColdRunEvidence(argValue('--results'), argValue('--results-dir') ?? RESULTS_DIR),
        loadRoster(argValue('--roster') ?? ROSTER_PATH),
    );
    for (const l of formatColdSetReport(verdict)) console.log(l);
    return coldSetExitCode(verdict);
}

if (require.main === module) {
    const code = main();
    if (code !== 0) process.exitCode = code;
}
