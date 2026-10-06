/**
 * retry.ts — the ONE retry the loop allows a child process (Lane A S64, pm110 ROW 0).
 *
 * WHY. The 2026-09-30 run began at 08:32:17 in a battery dark wake, and the Mac slept again
 * 5 s later (`pmset -g log`). `caffeinate -i` did not hold it: an idle-sleep assertion does
 * not keep a dark wake up on battery. The run froze for ~14 minutes. On wake, spawnSync's
 * 120 s timeout had expired ACROSS the sleep, so it killed the second psql
 * (fetchSweepStrings(); fetchMelWindow()'s had passed): `box psql failed (exit null):
 * Connection to 100.90.5.18 port 22 timed out`. ops/mac/adversary.sh now skips a run that
 * starts on battery or in a dark wake; this is the second guard, for a sleep that begins
 * mid-run (a lid closed, say).
 *
 * The rule, for ssh and `claude -p` alike: retry ONCE when
 *   - `status === null`: the child was killed, here by spawnSync's own timeout; or
 *   - `status === 255` and stderr says "timed out": ssh's own ConnectTimeout.
 * Anything else (a SQL error, a refused key, a CLI error reply) is not transient and fails
 * at once, as before.
 */

/** The parts of a spawnSync result the rule reads. */
export interface SpawnOutcome { status: number | null; stdout: string; stderr: string; error?: Error }

export function isTransientExit(r: Pick<SpawnOutcome, 'status' | 'stderr'>): boolean {
    if (r.status === null) return true;
    return r.status === 255 && /timed out/i.test(r.stderr ?? '');
}

/** Long enough for the network to come back after a wake. */
export const RETRY_PAUSE_MS = 15_000;

/** A synchronous pause: the callers are synchronous spawnSync wrappers. */
export function pauseSync(ms: number): void {
    if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Run once; on a transient exit, pause and run ONCE more. `retried` says which attempt answered. */
export function withOneRetry<R extends Pick<SpawnOutcome, 'status' | 'stderr'>>(
    run: () => R, pauseMs = RETRY_PAUSE_MS,
): { result: R; retried: boolean } {
    const first = run();
    if (!isTransientExit(first)) return { result: first, retried: false };
    pauseSync(pauseMs);
    return { result: run(), retried: true };
}
