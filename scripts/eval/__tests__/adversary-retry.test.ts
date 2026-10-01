/**
 * The hard-case loop's one retry (scripts/eval/adversary/retry.ts; Lane A S64, pm110 ROW 0).
 * The 2026-09-30 run died with `box psql failed (exit null): Connection to 100.90.5.18 port 22
 * timed out` after spawnSync's timeout expired across a sleep. These pin that a killed child
 * (status null) and ssh's 255 "timed out" get exactly ONE more try, that nothing else does,
 * and that both callers — psqlJson() and the judge's `claude -p` — are wired to the rule.
 */
jest.mock('child_process', () => ({ spawnSync: jest.fn() }));

import { spawnSync } from 'child_process';
import { isTransientExit, withOneRetry, type SpawnOutcome } from '../adversary/retry';
import { psqlJson } from '../adversary/box';
import { callModel, type JudgeConfig } from '../adversary/judge';

const out = (status: number | null, stdout = '', stderr = ''): SpawnOutcome => ({ status, stdout, stderr });
const SLEPT = 'Connection to 100.90.5.18 port 22 timed out';

describe('isTransientExit', () => {
    it('retries a killed child and ssh 255 "timed out" — the 09-30 shapes', () => {
        expect(isTransientExit(out(null, '', SLEPT))).toBe(true);
        expect(isTransientExit(out(null))).toBe(true);
        expect(isTransientExit(out(255, '', SLEPT))).toBe(true);
    });
    it('does not retry a real failure', () => {
        expect(isTransientExit(out(255, '', 'Permission denied (publickey).'))).toBe(false);
        expect(isTransientExit(out(1, '', 'ERROR:  syntax error at or near "SELEC"'))).toBe(false);
        expect(isTransientExit(out(3, '', 'timed out'))).toBe(false);
        expect(isTransientExit(out(0, '[]'))).toBe(false);
    });
});

describe('withOneRetry', () => {
    it('runs once when the first try is not transient', () => {
        const run = jest.fn(() => out(0, '[]'));
        expect(withOneRetry(run, 0)).toEqual({ result: out(0, '[]'), retried: false });
        expect(run).toHaveBeenCalledTimes(1);
    });
    it('runs exactly twice when the first try is transient, even if the second is too', () => {
        const run = jest.fn(() => out(null, '', SLEPT));
        expect(withOneRetry(run, 0).retried).toBe(true);
        expect(run).toHaveBeenCalledTimes(2);
    });
});

describe('psqlJson', () => {
    it('answers from the retry after a killed first try', () => {
        const run = jest.fn().mockReturnValueOnce(out(null, '', SLEPT)).mockReturnValueOnce(out(0, '["a banana"]'));
        expect(psqlJson<string[]>('SELECT 1;', run, 0)).toEqual(['a banana']);
        expect(run).toHaveBeenCalledTimes(2);
    });
    it('throws after one retry, and says so', () => {
        const run = jest.fn(() => out(null, '', SLEPT));
        expect(() => psqlJson('SELECT 1;', run, 0)).toThrow(`box psql failed after one retry (exit null): ${SLEPT}`);
        expect(run).toHaveBeenCalledTimes(2);
    });
    it('throws a SQL error at once, with no retry', () => {
        const run = jest.fn(() => out(1, '', 'ERROR:  relation "x" does not exist'));
        expect(() => psqlJson('SELECT 1;', run, 0)).toThrow('box psql failed (exit 1): ERROR:  relation "x" does not exist');
        expect(run).toHaveBeenCalledTimes(1);
    });
});

describe("the judge's claude -p call", () => {
    const cfg: JudgeConfig = {
        arm: 'claude-cli', model: 'claude-sonnet-5', claudeBin: '/bin/false', cwd: '/tmp', rowsPerCall: 25, maxCalls: 1,
        budgetPerCallUsd: 0.5, timeoutMs: 1000, retryPauseMs: 0, effort: 'high',
    };
    const ok = JSON.stringify({
        subtype: 'success', is_error: false, structured_output: { verdicts: [] }, usage: { output_tokens: 3 },
        modelUsage: { 'claude-sonnet-5': {} }, duration_ms: 10, total_cost_usd: 0.01,
    });
    const spawn = spawnSync as unknown as jest.Mock;
    beforeEach(() => spawn.mockReset());

    it('retries a call killed by the timeout and reads the second answer', async () => {
        spawn.mockReturnValueOnce(out(null, '', '')).mockReturnValueOnce(out(0, ok));
        const r = await callModel(cfg, 'judge', '/dev/null', {}, 'rows', 1);
        expect(spawn).toHaveBeenCalledTimes(2);
        expect(r.call.error).toBeUndefined();
        expect(r.structured).toEqual({ verdicts: [] });
    });
    it('fails the call after one retry, and says so', async () => {
        spawn.mockReturnValue(out(null, '', ''));
        const r = await callModel(cfg, 'judge', '/dev/null', {}, 'rows', 1);
        expect(spawn).toHaveBeenCalledTimes(2);
        expect(r.structured).toBeNull();
        expect(r.call.error).toMatch(/^claude exited null after one retry/);
    });
    it('does not retry a CLI error reply', async () => {
        spawn.mockReturnValueOnce(out(1, JSON.stringify({ subtype: 'error_max_turns', is_error: true })));
        const r = await callModel(cfg, 'judge', '/dev/null', {}, 'rows', 1);
        expect(spawn).toHaveBeenCalledTimes(1);
        expect(r.call.error).toMatch(/^CLI error_max_turns/);
    });
});
