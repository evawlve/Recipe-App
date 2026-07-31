/**
 * doc-check-core.ts — pure verdict logic for the doc-claims checker.
 *
 * WHY THIS EXISTS
 * Documentation was the last unguarded artifact in this project (doc-drift report
 * 2026-07-30, mobile repo sync-docs/reports/). Eight doc defects surfaced in one
 * session, in docs that had all been "recently cleaned"; two tidy-up passes did not
 * stop the rot. The durable intervention is the same one that made the golden eval,
 * the mutation harness and winner-gate work: an executable gate. Every checkable doc
 * claim gets a registry entry — the claim, the doc that owns it, the command that
 * re-derives it, the expected value, the date last verified — and this module turns
 * command output into a verdict.
 *
 * Extracted from run-doc-check.ts for the same reason assertions.ts was extracted
 * from run-eval.ts: the runner shells out and calls main() at module scope, so the
 * verdict logic must live where a test can import it without executing a run.
 *
 * FAIL-CLOSED CONTRACT (same as scoreNlpCase / evalExitCode):
 *   - a command that could not run is a FAILURE of that claim, never a skip;
 *   - an empty registry, a filter matching nothing, or a file that fails to parse
 *     is exit 2 ("the run is not a result"), byte-distinguishable from green;
 *   - no input may produce a passing verdict by ACCIDENT — empty output only
 *     passes a claim that explicitly expects emptiness (kind 'equals', value '').
 */

/** Where a claim's command runs. The runner maps each to a cwd or an ssh wrapper. */
/**
 * Where a claim's command must run.
 *
 * `devmachine` is deliberately distinct from `mobile`: both live in the mobile
 * repo, but a devmachine claim also needs an installed toolchain (node_modules,
 * a working `npx tsc`). Syncthing does not carry node_modules, so the box has
 * the mobile FILES but not the mobile TOOLCHAIN. Splitting the context is not a
 * way to skip a check — it names WHY a host cannot run it, so the runner can
 * report it as out of scope rather than either failing nightly forever or,
 * worse, being silently dropped.
 */
export type ClaimContext = 'backend' | 'mobile' | 'box' | 'devmachine';

export interface ExpectSpec {
    /**
     * 'equals'  — trimmed stdout must equal `value` exactly.
     * 'matches' — `value` is a regex tested against full stdout.
     * 'count'   — trimmed stdout parsed as an integer must equal numeric `value`.
     * 'min'     — parsed integer must be >= numeric `value`.
     * 'max'     — parsed integer must be <= numeric `value`.
     */
    kind: 'equals' | 'matches' | 'count' | 'min' | 'max';
    value: string;
}

export interface DocClaim {
    /** Stable slug, unique across the registry. Failing output cites it. */
    id: string;
    /** The prose claim as the owner doc states it. */
    claim: string;
    /** `repo:path#anchor` of the ONE doc that owns this fact (ownership rule: one owner per fact). */
    ownerDoc: string;
    where: ClaimContext;
    /** Shell command whose output re-derives the claim. Runs with `sh -c` in the context's cwd. */
    command: string;
    expect: ExpectSpec;
    /** ISO date the expected value was last measured against the real system. */
    verified: string;
    /** Optional per-claim timeout; the runner's default applies otherwise. */
    timeoutMs?: number;
}

export interface CommandOutcome {
    /** null exitCode / ran=false == the command could not be executed at all. */
    ran: boolean;
    stdout: string;
    exitCode: number | null;
    /** Spawn/ssh/timeout error text when ran=false. */
    error?: string;
}

export interface ClaimResult {
    id: string;
    ownerDoc: string;
    pass: boolean;
    detail: string;
}

/**
 * Parse + validate the registry file content. Throws on anything malformed —
 * a registry that half-parses must never yield a shorter, greener run.
 *
 * The empty-expected-value ban is deliberate: 'equals ""' would let a command
 * that produced NO output (dead ssh, missing file, grep with a typo'd path)
 * read as a pass. Emptiness must be asserted via an explicit count/matches
 * ('count 0' on a `wc -l`, or 'matches ^$'), where the command's own shape
 * proves it ran.
 */
export function parseRegistry(raw: string): DocClaim[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error(`registry is not valid JSON: ${(e as Error).message}`);
    }
    const claims = (parsed as { claims?: unknown })?.claims;
    if (!Array.isArray(claims)) throw new Error('registry has no claims[] array');
    const seen = new Set<string>();
    const KINDS = new Set(['equals', 'matches', 'count', 'min', 'max']);
    const CONTEXTS = new Set(['backend', 'mobile', 'box', 'devmachine']);
    for (const c of claims as DocClaim[]) {
        for (const field of ['id', 'claim', 'ownerDoc', 'where', 'command', 'verified'] as const) {
            if (typeof c?.[field] !== 'string' || c[field].trim() === '') {
                throw new Error(`claim ${c?.id ?? '<no id>'}: missing/empty ${field}`);
            }
        }
        if (seen.has(c.id)) throw new Error(`duplicate claim id: ${c.id}`);
        seen.add(c.id);
        if (!CONTEXTS.has(c.where)) throw new Error(`claim ${c.id}: unknown context "${c.where}"`);
        if (!KINDS.has(c.expect?.kind)) throw new Error(`claim ${c.id}: unknown expect.kind`);
        if (typeof c.expect.value !== 'string' || c.expect.value === '') {
            throw new Error(`claim ${c.id}: expect.value must be a non-empty string (assert emptiness via count/matches, never equals "")`);
        }
        if (['count', 'min', 'max'].includes(c.expect.kind) && !/^-?\d+$/.test(c.expect.value)) {
            throw new Error(`claim ${c.id}: expect.kind ${c.expect.kind} needs an integer value`);
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(c.verified)) {
            throw new Error(`claim ${c.id}: verified must be an ISO date, got "${c.verified}"`);
        }
    }
    return claims as DocClaim[];
}

/**
 * Verdict for one claim given what its command actually did.
 *
 * A command that did not run FAILS the claim. The four instrument incidents in
 * fail-closed.test.ts all share the shape "absence of signal encoded as the passing
 * verdict"; a doc checker whose ssh leg silently skipped box claims would report
 * green precisely when the box is unreachable — the moment its claims are least
 * verified.
 */
export function evaluateClaim(claim: DocClaim, outcome: CommandOutcome): ClaimResult {
    const base = { id: claim.id, ownerDoc: claim.ownerDoc };
    if (!outcome.ran) {
        return { ...base, pass: false, detail: `COULD NOT RUN: ${outcome.error ?? 'unknown spawn failure'}` };
    }
    const trimmed = outcome.stdout.trim();
    const { kind, value } = claim.expect;
    if (kind === 'equals') {
        return trimmed === value
            ? { ...base, pass: true, detail: `= "${value}"` }
            : { ...base, pass: false, detail: `expected "${value}", got "${clip(trimmed)}"` };
    }
    if (kind === 'matches') {
        let re: RegExp;
        try {
            re = new RegExp(value, 'm');
        } catch {
            // A regex that cannot compile is a registry defect, not a pass.
            return { ...base, pass: false, detail: `BAD REGEX in registry: ${value}` };
        }
        return re.test(outcome.stdout)
            ? { ...base, pass: true, detail: `matches /${value}/` }
            : { ...base, pass: false, detail: `no match for /${value}/ in "${clip(trimmed)}"` };
    }
    // count / min / max — the output must BE an integer. "grep -c" style commands
    // satisfy this; anything else (error text, empty output) fails rather than
    // coercing to NaN or 0. parseInt('') is NaN and NaN comparisons are false, but
    // we make the failure explicit instead of relying on that.
    if (!/^-?\d+$/.test(trimmed)) {
        return { ...base, pass: false, detail: `expected integer output, got "${clip(trimmed)}"` };
    }
    const n = parseInt(trimmed, 10);
    const v = parseInt(value, 10);
    const ok = kind === 'count' ? n === v : kind === 'min' ? n >= v : n <= v;
    return ok
        ? { ...base, pass: true, detail: `${n} ${kind === 'count' ? '==' : kind === 'min' ? '>=' : '<='} ${v}` }
        : { ...base, pass: false, detail: `${kind} ${v} violated: measured ${n}` };
}

/**
 * Process exit code. Same contract as evalExitCode in scripts/eval/assertions.ts:
 * 0 = every claim passed, 1 = at least one claim is now false (or could not run),
 * 2 = the run is not a result. Zero claims executed — empty registry, --grep that
 * matched nothing, unreadable registry file — must never print as green.
 */
export function checkerExitCode(results: ClaimResult[]): 0 | 1 | 2 {
    if (results.length === 0) return 2;
    return results.some(r => !r.pass) ? 1 : 0;
}

function clip(s: string): string {
    return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}
