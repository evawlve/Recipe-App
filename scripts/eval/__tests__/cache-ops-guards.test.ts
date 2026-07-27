/**
 * cache-ops-guards.test.ts — FAIL INJECTION for the cache eviction/restore pair.
 *
 * WHY THIS FILE EXISTS (playbook §11 class B — absence encoded as a PASS)
 *
 * `_evict_rows.ts`'s original population guard compared FoodMapping's row COUNT
 * to the snapshot and nothing else. Proven fail-open on 2026-07-27: the 04:35
 * flywheel-sweep updated 305 rows IN PLACE — count unchanged, guard green —
 * while the evict-set key "and ben jerry" had been fully re-resolved to a
 * DIFFERENT food. The screen's verdict described the old row; deleting the new
 * one would have destroyed a row no instrument had condemned. The guard now
 * content-checks every evict-list key and REFUSES THE ENTIRE RUN on any
 * mismatch (the operator re-cuts the list; the script never skips-and-continues).
 *
 * `_restore_rows.ts`'s createMany({skipDuplicates}) correctly never clobbers a
 * re-resolved row — but that is the LIMIT on reversibility, and a silent skip
 * is the same class-B hole: "restore complete" with rows missing. Skips are now
 * counted, printed key-by-key, and surfaced as a DISTINCT exit code (3).
 *
 * Every fail-injection block carries a POSITIVE CONTROL, per the pattern in
 * fail-closed.test.ts: without one, "the guard refuses" is satisfiable by a
 * guard that refuses everything, which is a tautology, not a test.
 *
 * NO NETWORK, NO DATABASE. Only the pure guard functions are exercised; the
 * scripts construct their PrismaClient inside main(), which never runs here.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    evictGuard,
    identityOf,
    loadSnapshot,
    parseKeysText,
    parseSnapshotText,
    type Snapshot,
    type SnapshotRow,
} from '../_evict_rows';
import {
    partitionRestore,
    raceSkips,
    restoreExitCode,
    selectRestoreRows,
    skipReportLines,
} from '../_restore_rows';

const FIXTURES = path.join(__dirname, 'fixtures', 'cache-ops');
const MINI = path.join(FIXTURES, 'snapshot-mini.json');
const TRUNCATED = path.join(FIXTURES, 'snapshot-truncated.json');
const EMPTY = path.join(FIXTURES, 'snapshot-empty.json');

function mini(): Snapshot {
    const parsed = parseSnapshotText(fs.readFileSync(MINI, 'utf8'));
    if (!parsed.ok) throw new Error(`fixture must parse: ${parsed.reason}`);
    return parsed.snap;
}

/** A live population identical to the snapshot (deep-cloned so tests can mutate). */
function liveFrom(snap: Snapshot): Map<string, Record<string, unknown>> {
    return new Map(snap.rows.map(r => [r.normalizedForm, JSON.parse(JSON.stringify(r)) as SnapshotRow]));
}

function refusal(v: ReturnType<typeof evictGuard>): { reasons: string[]; movedKeys: { key: string; diffs: string[] }[] } {
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error('unreachable');
    return v;
}

// ===========================================================================
// 1. The evict population guard — a moved ROW must refuse, not just a moved count
// ===========================================================================

describe('_evict_rows guard: a row updated IN PLACE (count unchanged) refuses', () => {
    it('the 2026-07-27 incident shape: "and ben jerry" re-resolved, count identical', () => {
        const snap = mini();
        const live = liveFrom(snap);
        // The flywheel re-resolved the key to a different product: same key, new
        // record pointer, new name. The COUNT is untouched — the old guard passed.
        const row = live.get('and ben jerry')!;
        row.foodName = 'Cherry Garcia Ice Cream';
        row.offBarcode = '0076840199999';

        // Precondition making the fail-open explicit: the count check ALONE sees nothing.
        expect(live.size).toBe(snap.count);

        const v = refusal(evictGuard(['and ben jerry', 'food test'], snap, snap.count, live));
        expect(v.movedKeys.map(m => m.key)).toEqual(['and ben jerry']);
        expect(v.movedKeys[0].diffs.join(' ')).toContain('offBarcode');
        expect(v.movedKeys[0].diffs.join(' ')).toContain('foodName');
        expect(v.reasons.join(' ')).toContain('MOVED');
    });

    it('a full re-resolution across sources (openfoodfacts -> fatsecret) names every changed field', () => {
        const snap = mini();
        const live = liveFrom(snap);
        const row = live.get('and ben jerry')!;
        row.source = 'fatsecret';
        row.offBarcode = null;
        row.fsId = 'fs_777';

        const v = refusal(evictGuard(['and ben jerry'], snap, snap.count, live));
        const diffs = v.movedKeys[0].diffs.join(' ');
        expect(diffs).toContain('source');
        expect(diffs).toContain('offBarcode');
        expect(diffs).toContain('fsId');
    });

    it('a validatedBy flip ALONE refuses — human validation is identity content', () => {
        const snap = mini();
        const live = liveFrom(snap);
        live.get('chili powder spice')!.validatedBy = 'human';

        const v = refusal(evictGuard(['chili powder spice'], snap, snap.count, live));
        expect(v.movedKeys[0].diffs.join(' ')).toContain('validatedBy');
    });

    it('an evict key DELETED live refuses even when the total count is unchanged', () => {
        // delete + an unrelated insert elsewhere keeps the count identical; the
        // count guard is structurally blind to it.
        const snap = mini();
        const live = liveFrom(snap);
        live.delete('food test');

        const v = refusal(evictGuard(['food test'], snap, snap.count, live));
        expect(v.movedKeys[0].key).toBe('food test');
        expect(v.movedKeys[0].diffs.join(' ')).toContain('no longer exists');
    });

    it('ONE moved key refuses the ENTIRE run — no skip-and-continue', () => {
        const snap = mini();
        const live = liveFrom(snap);
        live.get('propel water')!.fsId = 'fs_moved';

        // 'red wine' is pristine, but the run as a whole must still refuse: a
        // partial eviction against a moved population is an unaudited eviction.
        const v = refusal(evictGuard(['propel water', 'red wine'], snap, snap.count, live));
        expect(v.movedKeys.map(m => m.key)).toEqual(['propel water']);
    });
});

describe('_evict_rows guard: the pre-existing refusals still hold', () => {
    it('a key absent from the SNAPSHOT refuses (unrestorable delete = data loss)', () => {
        const snap = mini();
        const v = refusal(evictGuard(['never snapshotted key'], snap, snap.count, liveFrom(snap)));
        expect(v.reasons.join(' ')).toContain('not in the snapshot');
    });

    it('a moved COUNT refuses', () => {
        const snap = mini();
        const v = refusal(evictGuard(['red wine'], snap, snap.count - 1, liveFrom(snap)));
        expect(v.reasons.join(' ')).toContain('Re-snapshot');
    });
});

describe('_evict_rows guard: POSITIVE CONTROLS — it can still say yes', () => {
    it('an untouched population passes for every key in the snapshot', () => {
        const snap = mini();
        const keys = snap.rows.map(r => r.normalizedForm);
        expect(evictGuard(keys, snap, snap.count, liveFrom(snap)).ok).toBe(true);
    });

    it('rows OUTSIDE the evict list may move in place without refusing', () => {
        // The flywheel touches rows daily. A guard that refuses on ANY movement
        // anywhere in a live cache is a guard that can never be run at all. Only
        // the keys whose verdicts are being ACTED ON are content-checked.
        const snap = mini();
        const live = liveFrom(snap);
        live.get('almond great value')!.offBarcode = '0000000000000';

        expect(evictGuard(['red wine', 'food test'], snap, snap.count, live).ok).toBe(true);
    });

    it('heartbeat fields (usedCount / lastUsedAt / aiConfidence) do not refuse', () => {
        const snap = mini();
        const live = liveFrom(snap);
        const row = live.get('red wine')!;
        row.usedCount = 999;
        row.lastUsedAt = '2026-07-27T09:00:00.000Z';
        row.aiConfidence = 0.5;

        expect(evictGuard(['red wine'], snap, snap.count, live).ok).toBe(true);
    });

    it('identityOf: undefined and null are the same absence (a select{} row vs a JSON dump)', () => {
        expect(identityOf({ brandName: null }).brandName).toBeNull();
        expect(identityOf({}).brandName).toBeNull();
    });
});

// ===========================================================================
// 2. The snapshot file itself — unreadable / empty / truncated must REFUSE
// ===========================================================================

describe('snapshot parsing: a rollback path that parses to nothing is a refusal', () => {
    it('an EMPTY file refuses', () => {
        const v = loadSnapshot(EMPTY);
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.reason).toContain('EMPTY');
    });

    it('a TRUNCATED file (partial write, half-synced disk) refuses', () => {
        const v = loadSnapshot(TRUNCATED);
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.reason).toContain('not parseable');
    });

    it('a MISSING file refuses instead of crashing with a raw ENOENT', () => {
        const v = loadSnapshot(path.join(FIXTURES, 'does-not-exist.json'));
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.reason).toContain('cannot read');
    });

    it('valid JSON whose count disagrees with rows.length refuses (silent partial dump)', () => {
        const raw = JSON.parse(fs.readFileSync(MINI, 'utf8'));
        raw.rows.pop(); // count still says 6
        const v = parseSnapshotText(JSON.stringify(raw));
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.reason).toContain('internally inconsistent');
    });

    it('a ZERO-row snapshot refuses — "nothing to compare against" is not a pass', () => {
        const v = parseSnapshotText(JSON.stringify({ count: 0, takenAt: 'x', rows: [] }));
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.reason).toContain('ZERO rows');
    });

    it('rows without normalizedForm refuse', () => {
        const v = parseSnapshotText(JSON.stringify({ count: 1, takenAt: 'x', rows: [{ foodName: 'orphan' }] }));
        expect(v.ok).toBe(false);
    });

    it('wrong top-level shapes refuse', () => {
        for (const bad of ['[]', '"snapshot"', '42', '{"rows": "not an array", "count": 1}']) {
            expect(parseSnapshotText(bad).ok).toBe(false);
        }
    });

    it('POSITIVE CONTROL — the intact fixture parses to exactly 6 rows', () => {
        const v = loadSnapshot(MINI);
        expect(v.ok).toBe(true);
        if (v.ok) {
            expect(v.snap.count).toBe(6);
            expect(v.snap.rows.map(r => r.normalizedForm)).toContain('and ben jerry');
        }
    });
});

describe('keys-file parsing: a broken list must not become "evict nothing"', () => {
    it('empty / truncated / wrong-shape keys files refuse', () => {
        for (const bad of ['', '   ', '[]', '["and ben jerry"', '{"keys": []}', '["a", 3]', '["a", ""]']) {
            expect(parseKeysText(bad).ok).toBe(false);
        }
    });

    it('POSITIVE CONTROL — a real key list parses', () => {
        const v = parseKeysText('["and ben jerry", "food test"]');
        expect(v.ok).toBe(true);
        if (v.ok) expect(v.keys).toHaveLength(2);
    });
});

// ===========================================================================
// 3. Restore — every skip counted, printed, and surfaced in the exit code
// ===========================================================================

describe('_restore_rows: a silent skip is the limit on reversibility, so it is never silent', () => {
    const rows = (...keys: string[]) => keys.map(k => ({ normalizedForm: k }));

    it('partitions re-resolved (live) keys away from restorable ones', () => {
        const { missing, skipped } = partitionRestore(
            rows('a', 'b', 'c'),
            new Set(['b']),
        );
        expect(missing.map(r => r.normalizedForm)).toEqual(['a', 'c']);
        expect(skipped.map(r => r.normalizedForm)).toEqual(['b']);
    });

    it('EVERY skipped key is printed — the list is a worklist, not a sample', () => {
        const keys = Array.from({ length: 12 }, (_, i) => `skipped key ${i}`);
        const lines = skipReportLines(keys);
        expect(lines[0]).toContain('12 key(s)');
        for (const k of keys) {
            expect(lines.some(l => l.includes(JSON.stringify(k)))).toBe(true);
        }
    });

    it('skips force exit code 3 — distinct from success (0) AND from refusal (2)', () => {
        expect(restoreExitCode(1)).toBe(3);
        expect(restoreExitCode(12)).toBe(3);
        expect(restoreExitCode(1)).not.toBe(0);
        expect(restoreExitCode(1)).not.toBe(2);
    });

    it('createMany racing a re-resolution (created < submitted) also counts as skipped', () => {
        // The window between the live-key read and the write: skipDuplicates
        // reports only a count, so the residue is countable but not nameable.
        expect(raceSkips(5, 3)).toBe(2);
        expect(skipReportLines([], 2).join(' ')).toContain('appeared live mid-run');
        expect(restoreExitCode(raceSkips(5, 3))).toBe(3);
    });

    it('raceSkips never goes negative (an over-report must not cancel real skips)', () => {
        expect(raceSkips(3, 3)).toBe(0);
        expect(raceSkips(3, 5)).toBe(0);
    });

    it('POSITIVE CONTROL — a full clean restore prints no skip lines and exits 0', () => {
        const { missing, skipped } = partitionRestore(rows('a', 'b'), new Set<string>());
        expect(missing).toHaveLength(2);
        expect(skipped).toHaveLength(0);
        expect(skipReportLines([])).toEqual([]);
        expect(skipReportLines([], 0)).toEqual([]);
        expect(restoreExitCode(0)).toBe(0);
    });
});

// ===========================================================================
// 4. Restore keys file — the SAME rigor as the evict side. Restore is the
//    post-disaster path: a degenerate keys file that quietly becomes "restore
//    nothing / restore partial" with exit 0 is the class-B false green on the
//    one path whose failure is unrecoverable.
// ===========================================================================

describe('_restore_rows keys file: degenerate-but-valid JSON refuses, never narrows silently', () => {
    const snapRows = [
        { normalizedForm: 'and ben jerry' },
        { normalizedForm: 'food test' },
        { normalizedForm: 'red wine' },
    ];

    function refusalReason(v: ReturnType<typeof selectRestoreRows>): string {
        expect(v.ok).toBe(false);
        if (v.ok) throw new Error('unreachable');
        return v.reason;
    }

    it("'[]' refuses — an empty list must not become \"nothing to restore\" with exit 0", () => {
        expect(refusalReason(selectRestoreRows('[]', snapRows))).toContain('non-empty');
    });

    it('a bare JSON string refuses — new Set("oops") iterates as CHARACTERS, matching 0 rows', () => {
        // The pre-fix code would silently produce 0 candidates and exit 0.
        expect(selectRestoreRows('"oops"', snapRows).ok).toBe(false);
    });

    it("mixed-type entries ('[\"and ben jerry\", 3]') refuse — no silent partial filter", () => {
        // Pre-fix: the 3 was dropped by Set membership and 1 of 2 requested rows
        // restored, with exit 0 and no report of the difference.
        expect(refusalReason(selectRestoreRows('["and ben jerry", 3]', snapRows))).toContain('non-string');
    });

    it('empty / whitespace / truncated keys files refuse instead of crashing or passing', () => {
        for (const bad of ['', '   ', '["and ben jerry"', '{"keys": []}', '["a", ""]']) {
            expect(selectRestoreRows(bad, snapRows).ok).toBe(false);
        }
    });

    it('a requested key ABSENT from the snapshot refuses — the mirror of evictGuard unbacked-keys', () => {
        // Pre-fix: silently intersected away — partitionRestore never saw it,
        // skipReportLines never printed it, exit 0 while the row stayed gone.
        const reason = refusalReason(
            selectRestoreRows('["and ben jerry", "never snapshotted key"]', snapRows),
        );
        expect(reason).toContain('NOT in the snapshot');
        expect(reason).toContain(JSON.stringify('never snapshotted key'));
    });

    it('ONE unbacked key refuses the ENTIRE run — no restore-what-we-can', () => {
        const v = selectRestoreRows('["red wine", "ghost a", "ghost b"]', snapRows);
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.reason).toContain('2 requested key(s)');
    });

    it('POSITIVE CONTROL — a valid keys file selects exactly the requested snapshot rows', () => {
        const v = selectRestoreRows('["food test", "red wine"]', snapRows);
        expect(v.ok).toBe(true);
        if (v.ok) {
            expect(v.keys).toEqual(['food test', 'red wine']);
            expect(v.rows.map(r => r.normalizedForm)).toEqual(['food test', 'red wine']);
        }
    });

    it('POSITIVE CONTROL — the real evict-list fixture keys select against the mini snapshot', () => {
        const snap = mini();
        const v = selectRestoreRows('["and ben jerry", "propel water"]', snap.rows);
        expect(v.ok).toBe(true);
        if (v.ok) expect(v.rows).toHaveLength(2);
    });
});
