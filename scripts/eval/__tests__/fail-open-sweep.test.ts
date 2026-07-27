/**
 * fail-open-sweep.test.ts — FAIL INJECTION for the instruments PR #177 did not
 * reach: the flywheel sweep + warm runner (one unit — flywheel imports
 * runWarm), the cache-parity sweep, the stress runner, and the two
 * detect-corrupt-* scans.
 *
 * Same contract as fail-closed.test.ts: every block FORCES the underlying
 * signal to be absent (dead HTTP, empty result set, a child exit code the
 * caller used to ignore) and asserts the verdict is NOT the passing one; and
 * every block carries a POSITIVE CONTROL, because "never green" is satisfiable
 * by an instrument that never passes anything (playbook §5).
 *
 * The headline hole (found writing these): flywheel-sweep's old runEvalGate
 * ignored run-eval's exit code whenever a results file existed. run-eval
 * writes its results file BEFORE exiting — including on the zero-case path
 * where evalExitCode (PR #177) makes it exit 2 — so `results: []` re-derived
 * as "no unexpected failures" and the sweep turned run-eval's own fail-closed
 * red into a green exit 0 for systemd. PR #177's fix was being defeated by
 * PR #177's most important consumer.
 *
 * NO NETWORK, NO DATABASE: fetch is replaced per-test, the detect scans get a
 * stub db, and everything else under test is pure.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
    EvalRunEvidence, judgeEvalGate, sweepVerdict,
} from '../flywheel-verdict';
import { runWarm, warmExitCode, WarmResult } from '../warm-cache';
import { parityExitCode, summarizeParity } from '../cache-parity-sweep';
import { Sample, stressExitCode } from '../stress-latency';
import {
    runScan as runNutritionScan, ScanDb as NutritionScanDb, Row as NutritionRow,
} from '../detect-corrupt-nutrition';
import {
    runScan as runPanelScan, ScanDb as PanelScanDb, Row as PanelRow,
} from '../detect-corrupt-panel';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fail-open-sweep-'));

// ===========================================================================
// 1. flywheel eval gate — the child's exit code is evidence, not decoration
// ===========================================================================

describe('judgeEvalGate: run-eval exit 2 can never be re-derived into a PASS', () => {
    const passCase = (id: string) => ({ id, query: id, detail: '', pass: true });
    const failCase = (id: string) => ({ id, query: id, detail: 'boom', pass: false });

    const evidence = (over: Partial<EvalRunEvidence> = {}): EvalRunEvidence => ({
        status: 0,
        signal: null,
        resultsFile: '/x/results/eval-2026.json',
        data: { results: [passCase('n-a-01'), passCase('n-a-02')] },
        ...over,
    });

    it('THE DEFEAT CASE: exit 2 + a results file with ZERO cases is an instrument failure, not a pass', () => {
        // Exactly what a zero-case run-eval leaves behind: it writes the file,
        // THEN exits 2. The old gate read the empty results array, computed
        // zero unexpected failures, and passed the sweep.
        const gate = judgeEvalGate(evidence({ status: 2, data: { results: [] } }), ['n-mq-10']);
        expect(gate.pass).toBe(false);
        expect(gate.ran).toBe(false);
        expect(gate.error).toContain('exited 2');
        expect(gate.error).toContain('does not override');
    });

    it('exit 2 is refused even when the results file is FULL of passing cases', () => {
        const gate = judgeEvalGate(evidence({ status: 2 }), []);
        expect(gate.pass).toBe(false);
        expect(gate.error).toContain('exited 2');
    });

    it('a KILLED child (signal, no status) has no receipt to trust', () => {
        const gate = judgeEvalGate(evidence({ status: null, signal: 'SIGTERM' }), []);
        expect(gate.pass).toBe(false);
        expect(gate.error).toContain('KILLED');
    });

    it('spawn failure, missing results file, unreadable results file — all refuse', () => {
        expect(judgeEvalGate(evidence({ spawnError: 'ETIMEDOUT' }), []).error).toContain('spawn failed');
        expect(judgeEvalGate(evidence({ resultsFile: null, data: null }), []).error).toContain('no results file');
        expect(judgeEvalGate(evidence({ parseError: 'Unexpected end of JSON input', data: null }), []).error)
            .toContain('unreadable');
    });

    it('exit 0 over a results file with ZERO cases is still not a pass', () => {
        const gate = judgeEvalGate(evidence({ data: { results: [] } }), []);
        expect(gate.pass).toBe(false);
        expect(gate.error).toContain('ZERO cases');
    });

    it('an exit code that CONTRADICTS the file means the wrong file was read — refuse both ways', () => {
        // exit 1 (real failures) but the file shows none: stale file picked up.
        const staleGreen = judgeEvalGate(evidence({ status: 1 }), []);
        expect(staleGreen.pass).toBe(false);
        expect(staleGreen.error).toContain('wrong or stale');
        // exit 0 but the file shows a real failure: same defect, other polarity.
        const staleRed = judgeEvalGate(
            evidence({ status: 0, data: { results: [failCase('n-x-01')] } }), []);
        expect(staleRed.pass).toBe(false);
        expect(staleRed.error).toContain('wrong or stale');
    });

    it('an unrecognised exit code is refused, not defaulted', () => {
        const gate = judgeEvalGate(evidence({ status: 3 }), []);
        expect(gate.pass).toBe(false);
        expect(gate.error).toContain('unrecognised');
    });

    it('POSITIVE CONTROL — a clean exit-0 receipt passes', () => {
        const gate = judgeEvalGate(evidence(), ['n-mq-10']);
        expect(gate.error).toBeUndefined();
        expect(gate.ran).toBe(true);
        expect(gate.pass).toBe(true);
        expect(gate.casesRun).toBe(2);
    });

    it('POSITIVE CONTROL — allow-fail absorbs exactly its ids, visibly, and stale entries are named', () => {
        const gate = judgeEvalGate(
            evidence({ status: 1, data: { results: [passCase('n-a-01'), failCase('n-mq-10')] } }),
            ['n-mq-10', 'n-old-99']);
        expect(gate.pass).toBe(true);
        // The suppression is REPORTED — a standing red must stay visible.
        expect(gate.suppressedFails).toEqual(['n-mq-10']);
        // ...and the entry that no longer fails is flagged for pruning.
        expect(gate.staleAllowFail).toEqual(['n-old-99']);
    });

    it('an UNLISTED real failure fails the gate', () => {
        const gate = judgeEvalGate(
            evidence({ status: 1, data: { results: [failCase('n-supp-23')] } }), ['n-mq-10']);
        expect(gate.error).toBeUndefined();
        expect(gate.pass).toBe(false);
        expect(gate.unexpectedFails).toEqual(['n-supp-23']);
    });

    it('knownIssue failures do not count as real failures (matches evalExitCode semantics)', () => {
        const gate = judgeEvalGate(
            evidence({ data: { results: [passCase('n-a-01'), { id: 'n-k-01', pass: false, knownIssue: true }] } }),
            []);
        expect(gate.pass).toBe(true);
        expect(gate.knownIssues).toBe(1);
    });
});

describe('sweepVerdict: the sweep exit code systemd sees', () => {
    const goodGate = () => judgeEvalGate({
        status: 0, signal: null, resultsFile: '/x/eval.json',
        data: { results: [{ id: 'a', pass: true }] },
    }, []);
    const brokenGate = () => judgeEvalGate({
        status: 2, signal: null, resultsFile: '/x/eval.json', data: { results: [] },
    }, []);
    const failedGate = () => judgeEvalGate({
        status: 1, signal: null, resultsFile: '/x/eval.json',
        data: { results: [{ id: 'n-x-01', query: 'x', detail: 'd', pass: false }] },
    }, []);
    const warmOk = { seedCount: 100, resultCount: 100, okCount: 97 };

    it('an instrument failure is exit 2 and says the numbers are void', () => {
        const v = sweepVerdict(brokenGate(), warmOk);
        expect(v.code).toBe(2);
        expect(v.reasons.join(' ')).toContain('INSTRUMENT');
    });

    it('a genuine gate failure is exit 1 and NAMES the post-hoc writes', () => {
        const v = sweepVerdict(failedGate(), warmOk);
        expect(v.code).toBe(1);
        expect(v.reasons.join(' ')).toContain('EVAL GATE FAILED');
        // The gate runs AFTER the warm has written (playbook §2) — a red exit
        // must never read as "nothing happened".
        expect(v.reasons.join(' ')).toContain('NOT rolled back');
    });

    it('a warm that reached NOTHING is exit 2 even when the gate was skipped', () => {
        expect(sweepVerdict(null, { seedCount: 100, resultCount: 100, okCount: 0 }).code).toBe(2);
        expect(sweepVerdict(null, { seedCount: 100, resultCount: 0, okCount: 0 }).code).toBe(2);
        expect(sweepVerdict(null, { seedCount: 0, resultCount: 0, okCount: 0 }).code).toBe(2);
    });

    it('instrument failure (2) outranks gate failure (1) when both fire', () => {
        expect(sweepVerdict(failedGate(), { seedCount: 100, resultCount: 100, okCount: 0 }).code).toBe(2);
    });

    it('POSITIVE CONTROLS — clean runs exit 0, skipped steps contribute nothing', () => {
        expect(sweepVerdict(goodGate(), warmOk).code).toBe(0);
        expect(sweepVerdict(goodGate(), null).code).toBe(0);   // --skip-warm
        expect(sweepVerdict(null, warmOk).code).toBe(0);       // --skip-eval
        expect(sweepVerdict(null, null).code).toBe(0);
    });
});

// ===========================================================================
// 2. warm-cache — "0 warmed" is an outage report, not a warm report
// ===========================================================================

describe('warm-cache: a warm run that warmed nothing is RED', () => {
    const err = (seed: string): WarmResult => ({ seed, ok: false, ms: 1, error: 'fetch failed' });
    const ok = (seed: string): WarmResult => ({ seed, ok: true, ms: 1, foodId: 'off_1' });

    it('warmExitCode fails closed on all three nothing-shapes', () => {
        expect(warmExitCode(0, []).code).toBe(2);                    // zero seeds assembled
        expect(warmExitCode(5, []).code).toBe(2);                    // pool never ran
        expect(warmExitCode(2, [err('a'), err('b')]).code).toBe(2);  // total request failure
        expect(warmExitCode(2, [err('a'), err('b')]).reason).toContain('TOTAL failure');
    });

    it('POSITIVE CONTROL — partial errors are not a void run', () => {
        expect(warmExitCode(2, [ok('a'), err('b')]).code).toBe(0);
    });

    it('a TOTAL HTTP outage produces per-seed errors and a code-2 verdict (fetch mocked dead)', async () => {
        const spy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
        try {
            const out = tmpDir();
            const report = await runWarm(['apple', 'banana'], {
                base: 'http://api.invalid', concurrency: 2, timeoutMs: 50, quiet: true, outDir: out,
            });
            expect(report.results).toHaveLength(2);
            expect(report.results.every(r => !r.ok)).toBe(true);
            expect(report.summary.ok).toBe(0);
            expect(warmExitCode(2, report.results).code).toBe(2);
            // The report file IS written — a record of the failure is fine; the
            // exit code is what must refuse to be green.
            expect(fs.readdirSync(out).filter(f => f.startsWith('warm-'))).toHaveLength(1);
        } finally { spy.mockRestore(); }
    }, 20000);

    it('a NaN --concurrency cannot silently build ZERO workers and skip the corpus', async () => {
        const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ([{
                foodId: 'off_1', foodName: 'Apple', source: 'openfoodfacts', grams: 100,
                matchConfidence: 0.95, nutritionPer100g: { kcal100: 52 },
            }]),
        } as unknown as Response);
        try {
            const report = await runWarm(['apple', 'banana'], {
                base: 'http://api.invalid', concurrency: Number('abc'), timeoutMs: 1000, quiet: true, outDir: tmpDir(),
            });
            // Array.from({length: NaN}) is [] — before the floor, this recorded
            // zero results and summarised "ok 0 · errors 0" as if clean.
            expect(report.results).toHaveLength(2);
            expect(report.summary.ok).toBe(2);
            expect(warmExitCode(2, report.results).code).toBe(0);   // POSITIVE CONTROL
        } finally { spy.mockRestore(); }
    }, 20000);
});

// ===========================================================================
// 3. cache-parity-sweep — total HTTP failure vs verified-clean cache
// ===========================================================================

describe('cache-parity-sweep: "0 changed records" needs rows that actually came back', () => {
    const before = (key: string, over: Record<string, unknown> = {}) => ({
        normalizedForm: key, foodName: 'Almonds', brandName: null, source: 'openfoodfacts',
        offBarcode: '123', fdcId: null, fsId: null, aiConfidence: 0.9, usedCount: 3, ...over,
    });
    const row = (key: string, cold: Record<string, unknown>, b: Record<string, unknown> = before(key)) =>
        ({ key, queriedAs: key, before: b, cold, ms: 5 });

    it('TOTAL HTTP FAILURE: every replay errored → 0 changed, 0 verified, exit 2 with an explicit reason', () => {
        const rows = ['a', 'b', 'c'].map(k => row(k, { error: 'AbortError: This operation was aborted' }));
        const { counts } = summarizeParity(rows);
        expect(counts.changedRecord).toBe(0);          // the OLD headline number...
        expect(counts.errors).toBe(3);
        expect(counts.verifiedReachable).toBe(0);      // ...now paired with what it was verified against
        const verdict = parityExitCode(counts);
        expect(verdict.code).toBe(2);
        expect(verdict.reason).toContain('NOTHING REACHABLE');
        expect(verdict.reason).toContain('VOID');
    });

    it('an EMPTY --before file is a void run, not a clean one', () => {
        const { counts } = summarizeParity([]);
        const verdict = parityExitCode(counts);
        expect(verdict.code).toBe(2);
        expect(verdict.reason).toContain('ZERO rows');
    });

    it('partial transport failure exits 1 — the errored rows were verified by nothing', () => {
        const rows = [
            row('a', { foodId: 'off_123' }),
            row('b', { error: 'http 502' }),
            row('c', { foodId: 'off_123' }),
        ];
        const { counts } = summarizeParity(rows);
        expect(counts.verifiedReachable).toBe(2);
        const verdict = parityExitCode(counts);
        expect(verdict.code).toBe(1);
        expect(verdict.reason).toContain('verified by NOTHING');
    });

    it('POSITIVE CONTROL — a fully reachable, unchanged sweep is exit 0', () => {
        const rows = [row('a', { foodId: 'off_123' }), row('b', { foodId: 'off_123' })];
        const { counts } = summarizeParity(rows);
        expect(counts).toMatchObject({ sameRecord: 2, changedRecord: 0, errors: 0, verifiedReachable: 2 });
        expect(parityExitCode(counts).code).toBe(0);
    });

    it('POSITIVE CONTROL — a genuine record change is still counted and reported', () => {
        const { counts, changes } = summarizeParity([row('a', { foodId: 'off_999', foodName: 'Other', source: 'openfoodfacts' })]);
        expect(counts.changedRecord).toBe(1);
        expect(changes[0].was).toContain('off_123');
        expect(changes[0].now).toContain('off_999');
    });

    it('fatsecret incumbents resolve through fsId instead of reading as changes', () => {
        const fsRow = row('fs key', { foodId: 'fs_1646' }, before('fs key', { offBarcode: null, fsId: '1646' }));
        expect(summarizeParity([fsRow]).counts.sameRecord).toBe(1);
    });

    it('an incumbent with NO reconstructable id is unresolvable, never a change', () => {
        const bare = row('a', { foodId: 'off_999' }, before('a', { offBarcode: null, fdcId: null, fsId: null }));
        const { counts } = summarizeParity([bare]);
        expect(counts.changedRecord).toBe(0);
        expect(counts.unresolvableBefore).toBe(1);
    });
});

// ===========================================================================
// 4. stress-latency — a run that measured nothing, and a dead index
// ===========================================================================

describe('stress-latency: zero requests and HTTP-200-over-nothing are not green', () => {
    const sample = (over: Partial<Sample> = {}): Sample => ({
        kind: 'search', q: 'apple', ms: 20, ok: true, empty: false, nullNut: false,
        status: 200, expectHits: true, ...over,
    });

    it('ZERO samples (e.g. --n 0 or NaN built an empty task list) exits 2', () => {
        const v = stressExitCode([]);
        expect(v.code).toBe(2);
        expect(v.reasons.join(' ')).toContain('ZERO requests');
    });

    it('request errors and null-nutrition leaks stay hard failures', () => {
        expect(stressExitCode([sample(), sample({ ok: false, status: 0 })]).code).toBe(1);
        expect(stressExitCode([sample(), sample({ nullNut: true })]).code).toBe(1);
    });

    it('EVERY should-hit search empty = dead index = exit 1, even with zero HTTP errors', () => {
        const v = stressExitCode([
            sample({ q: 'apple', empty: true }),
            sample({ q: 'banana', empty: true }),
            // a typo probe that is ALLOWED to be empty must not mask the signal
            sample({ q: 'bananna', empty: true, expectHits: false }),
        ]);
        expect(v.code).toBe(1);
        expect(v.reasons.join(' ')).toContain('EMPTY');
    });

    it('POSITIVE CONTROL — one real hit defuses the dead-index rule; a healthy run is 0', () => {
        expect(stressExitCode([sample({ empty: true }), sample({ q: 'banana' })]).code).toBe(0);
        expect(stressExitCode([sample(), sample({ kind: 'nlp', expectHits: undefined })]).code).toBe(0);
    });
});

// ===========================================================================
// 5. detect-corrupt-* — a scan that saw nothing must not write a clean report
// ===========================================================================

describe('detect-corrupt scans: zero rows scanned is a broken instrument, not a clean corpus', () => {
    let logSpy: jest.SpyInstance;
    let errSpy: jest.SpyInstance;
    beforeEach(() => {
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => { logSpy.mockRestore(); errSpy.mockRestore(); });

    /** findMany stub: first (cursor-less) page returns `rows`, pagination then ends. */
    const pagedFindMany = <T,>(rows: T[]) =>
        async (q: unknown) => ((q as { cursor?: unknown })?.cursor ? [] : rows);

    describe('detect-corrupt-nutrition', () => {
        it('an EMPTY result set (wrong DB, filter typo) returns 2 and writes NO report', async () => {
            const out = tmpDir();
            const db: NutritionScanDb = { offFood: { findMany: pagedFindMany<NutritionRow>([]) } };
            const code = await runNutritionScan(db, { outDir: out });
            expect(code).toBe(2);
            expect(errSpy.mock.calls.flat().join(' ')).toContain('ZERO rows');
            // No report: a failed scan must not fake an empty population for
            // mark-corrupt-off.ts to consume.
            expect(fs.readdirSync(out)).toHaveLength(0);
        });

        it('POSITIVE CONTROL — one impossible row is scanned, flagged and reported (exit 0)', async () => {
            const out = tmpDir();
            const rows: NutritionRow[] = [{
                barcode: '0001', name: 'Mystery Jerky', brandName: null,
                servingGrams: null, nutrientsPer100g: { calories: 81818 },
            }];
            const db: NutritionScanDb = { offFood: { findMany: pagedFindMany(rows) } };
            const code = await runNutritionScan(db, { outDir: out });
            expect(code).toBe(0);
            const files = fs.readdirSync(out).filter(f => f.startsWith('corrupt-nutrition-scan-'));
            expect(files).toHaveLength(1);
            const report = JSON.parse(fs.readFileSync(path.join(out, files[0]), 'utf8'));
            expect(report.summary.scanned).toBe(1);
            expect(report.summary.flagged).toBe(1);
            expect(report.summary.byDirection['kcal-impossible']).toBe(1);
        });
    });

    describe('detect-corrupt-panel', () => {
        const panelDb = (rows: PanelRow[]): PanelScanDb => ({
            offFood: {
                findMany: pagedFindMany(rows),
                findUnique: async () => null,   // triage cross-check misses offline
            },
        });

        it('an EMPTY result set returns 2 and writes NO report', async () => {
            const out = tmpDir();
            const code = await runPanelScan(panelDb([]), { outDir: out });
            expect(code).toBe(2);
            expect(errSpy.mock.calls.flat().join(' ')).toContain('ZERO rows');
            expect(fs.readdirSync(out)).toHaveLength(0);
        });

        it('POSITIVE CONTROL — the oreo-shaped panel-as-100g signature is still caught (exit 0)', async () => {
            const out = tmpDir();
            const mk = (barcode: string, kcal: number, servingGrams: number): PanelRow => ({
                barcode, name: 'Oreo Chocolate Sandwich Cookies', brandName: 'Nabisco',
                servingGrams, nutrientsPer100g: { calories: kcal },
            });
            const rows = [
                mk('b1', 480, 100), mk('b2', 500, 100), mk('b3', 510, 100), mk('b4', 520, 100),
                // the corrupt row: the 2-cookie serving panel stored as per-100g
                mk('corrupt1', 143, 29),
            ];
            const code = await runPanelScan(panelDb(rows), { outDir: out });
            expect(code).toBe(0);
            const files = fs.readdirSync(out).filter(f => f.startsWith('corrupt-panel-scan-'));
            expect(files).toHaveLength(1);
            const report = JSON.parse(fs.readFileSync(path.join(out, files[0]), 'utf8'));
            expect(report.summary.scanned).toBe(5);
            expect(report.flagged).toHaveLength(1);
            expect(report.flagged[0]).toMatchObject({ barcode: 'corrupt1', direction: 'panel-low' });
        });
    });
});
