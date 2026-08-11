/**
 * apply-repoints.test.ts — the first tests this script has ever had.
 *
 * It went untested because it was not importable: PrismaClient, process.argv
 * and an unconditional main() all ran at module scope. main() is now behind a
 * `require.main === module` guard and the decision logic is exported, so the
 * parts that can silently corrupt the cache are checkable.
 *
 * What these pin, in order of how much damage the absence cost:
 *   1. `fs_` is a THREE-character prefix. The old code had one
 *      startsWith('off_') test and an unguarded fall-through to
 *      parseInt(target.slice(4)), so `fs_4513` was read as FdcFood 513 — a
 *      real, unrelated record — and would have been written under
 *      validatedBy 'human-triage', which the write-guard then protects from
 *      correction. Nothing was ever corrupted by it, but only because none of
 *      the mangled ids happened to exist in FdcFood.
 *   2. The three target columns are mutually exclusive.
 *   3. A genuine zero-calorie record is not a missing-nutrition record.
 */

import {
    parseTargetRef,
    targetColumns,
    readKcal,
    unparseableTargets,
    conflictingKeys,
    checkSnapshotCoversPlans,
    type Plan,
    type Repoint,
} from '../apply-repoints';

function plan(over: Partial<Plan> = {}): Plan {
    return { seed: 's', key: 'k', action: 'UPDATE', target: 'off_1', ...over };
}
function repoint(over: Partial<Repoint> = {}): Repoint {
    return { seed: 's', target: 'off_1', class: 'c', severity: 'high', wasFood: 'w', ...over };
}

describe('parseTargetRef — the prefix allowlist', () => {
    it('resolves off_ by barcode, keeping the full remainder', () => {
        expect(parseTargetRef('off_0051933720008')).toEqual({ kind: 'off', barcode: '0051933720008' });
        // Barcodes are not always pure digits in this corpus.
        expect(parseTargetRef('off_44213149860112455')).toEqual({ kind: 'off', barcode: '44213149860112455' });
        expect(parseTargetRef('off_abc.def-1_2')).toEqual({ kind: 'off', barcode: 'abc.def-1_2' });
    });

    it('resolves fdc_ to an integer id', () => {
        expect(parseTargetRef('fdc_167762')).toEqual({ kind: 'fdc', fdcId: 167762 });
    });

    it('resolves fs_ off a THREE-character prefix, as a string', () => {
        expect(parseTargetRef('fs_4513')).toEqual({ kind: 'fs', fsId: '4513' });
        expect(parseTargetRef('fs_75421144')).toEqual({ kind: 'fs', fsId: '75421144' });
    });

    it('REGRESSION: fs_4513 is FatSecret 4513, never FdcFood 513', () => {
        const ref = parseTargetRef('fs_4513');
        expect(ref).not.toBeNull();
        expect(ref!.kind).toBe('fs');
        // The exact off-by-one the old fall-through produced.
        expect('fs_4513'.slice(4)).toBe('513');
        expect((ref as { fsId: string }).fsId).toBe('4513');
    });

    it('returns null for every prefix outside the allowlist, instead of guessing', () => {
        for (const bad of ['ai_9', 'ai_estimate_1', 'x', '', 'weird', 'OFF_123', 'FS_1', 'FDC_1']) {
            expect(parseTargetRef(bad)).toBeNull();
        }
    });

    it('returns null for a recognised prefix with a malformed payload', () => {
        for (const bad of ['off_', 'fdc_', 'fs_', 'fdc_abc', 'fs_abc', 'fdc_12a', 'fs_1.2', 'off_a b']) {
            expect(parseTargetRef(bad)).toBeNull();
        }
    });

    it('never returns a kind whose payload disagrees with the prefix', () => {
        for (const t of ['off_123', 'fdc_123', 'fs_123']) {
            const ref = parseTargetRef(t)!;
            expect(t.startsWith(ref.kind + '_')).toBe(true);
        }
    });
});

describe('targetColumns — the mutual-exclusion invariant', () => {
    it('sets exactly one target column per kind, nulling the other two', () => {
        const cases: Array<[string, string]> = [
            ['off_123', 'offBarcode'],
            ['fdc_123', 'fdcId'],
            ['fs_123', 'fsId'],
        ];
        for (const [target, expectedCol] of cases) {
            const cols = targetColumns(parseTargetRef(target)!);
            const set = (['offBarcode', 'fdcId', 'fsId'] as const).filter(c => cols[c] != null);
            expect(set).toEqual([expectedCol]);
        }
    });

    it('pairs each kind with the source string the production writer uses', () => {
        expect(targetColumns(parseTargetRef('off_1')!).source).toBe('openfoodfacts');
        expect(targetColumns(parseTargetRef('fdc_1')!).source).toBe('fdc');
        expect(targetColumns(parseTargetRef('fs_1')!).source).toBe('fatsecret');
    });

    it('always returns all three keys, so an upsert cannot omit one', () => {
        // The bug this pins: the old update block wrote offBarcode and fdcId
        // and omitted fsId, so repointing a row that carried an fsId left TWO
        // columns populated — and three read sites disagree on precedence when
        // that happens.
        for (const t of ['off_1', 'fdc_1', 'fs_1']) {
            const cols = targetColumns(parseTargetRef(t)!);
            expect(Object.keys(cols).sort()).toEqual(['fdcId', 'fsId', 'offBarcode', 'source']);
        }
    });
});

describe('readKcal', () => {
    it('reads calories, falling back to kcal', () => {
        expect(readKcal({ calories: 110 })).toBe(110);
        expect(readKcal({ kcal: 110 })).toBe(110);
    });

    it('treats a genuine zero as a value, not as missing', () => {
        // fs_6409498 (Bang Energy Drink) really is 0 kcal/100g. A falsy check
        // would skip it.
        expect(readKcal({ calories: 0 })).toBe(0);
        expect(readKcal({ calories: 0 })).not.toBeNull();
    });

    it('returns null for the empty object persistFatSecretHits writes on failure', () => {
        // It writes `nutrientsPer100g: (per100 ?? {})` — an empty object, not
        // null — so a null-check on the column itself would miss this.
        expect(readKcal({})).toBeNull();
        expect(readKcal(null)).toBeNull();
        expect(readKcal(undefined)).toBeNull();
        expect(readKcal({ calories: 'x' })).toBeNull();
    });
});

describe('unparseableTargets — fail closed on a mis-shaped file', () => {
    it('is empty when every target is in the vocabulary', () => {
        expect(unparseableTargets([
            repoint({ target: 'off_1' }), repoint({ target: 'fdc_2' }), repoint({ target: 'fs_3' }),
        ])).toEqual([]);
    });

    it('names every offending entry with its seed', () => {
        const bad = unparseableTargets([
            repoint({ seed: 'ok', target: 'off_1' }),
            repoint({ seed: 'nope', target: 'ai_9' }),
            repoint({ seed: 'alsonope', target: 'fs_abc' }),
        ]);
        expect(bad).toHaveLength(2);
        expect(bad[0]).toContain('nope');
        expect(bad[0]).toContain('ai_9');
        expect(bad[1]).toContain('fs_abc');
    });
});

describe('conflictingKeys', () => {
    it('flags one key aimed at two different targets', () => {
        const c = conflictingKeys([
            plan({ key: 'rice', target: 'off_1' }),
            plan({ key: 'rice', target: 'fs_2' }),
        ]);
        expect(c).toHaveLength(1);
        expect(c[0].key).toBe('rice');
    });

    it('allows one key repeated with the SAME target', () => {
        expect(conflictingKeys([
            plan({ key: 'rice', target: 'off_1' }),
            plan({ key: 'rice', target: 'off_1' }),
        ])).toEqual([]);
    });

    it('ignores SKIPs, which write nothing', () => {
        expect(conflictingKeys([
            plan({ key: 'rice', target: 'off_1' }),
            plan({ key: 'rice', target: 'fs_2', action: 'SKIP' }),
        ])).toEqual([]);
    });
});

describe('checkSnapshotCoversPlans — the restore anchor', () => {
    const snap = (keys: string[]) => JSON.stringify({
        table: 'FoodMapping',
        rows: keys.map(k => ({ normalizedForm: k, foodName: 'x' })),
    });

    it('accepts a snapshot containing every row the run would overwrite', () => {
        const r = checkSnapshotCoversPlans(snap(['rice', 'oats']), [plan({ key: 'rice' })]);
        expect(r.ok).toBe(true);
        expect(r.rowCount).toBe(2);
        expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('REFUSES when a row being overwritten is absent from the snapshot', () => {
        const r = checkSnapshotCoversPlans(snap(['oats']), [plan({ key: 'rice' })]);
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('OVERWRITE');
        expect(r.missingKeys).toEqual(['rice']);
    });

    it('does not require coverage of CREATEs, which destroy nothing', () => {
        const r = checkSnapshotCoversPlans(snap([]), [plan({ key: 'new', action: 'CREATE' })]);
        expect(r.ok).toBe(true);
    });

    it('ignores SKIPs', () => {
        const r = checkSnapshotCoversPlans(snap([]), [plan({ key: 'rice', action: 'SKIP' })]);
        expect(r.ok).toBe(true);
    });

    it('refuses a snapshot of the wrong table', () => {
        const r = checkSnapshotCoversPlans(JSON.stringify({ table: 'OffFood', rows: [] }), []);
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('OffFood');
    });

    it('refuses a file that is not a snapshot at all', () => {
        expect(checkSnapshotCoversPlans('not json', []).ok).toBe(false);
        expect(checkSnapshotCoversPlans(JSON.stringify({ table: 'FoodMapping' }), []).ok).toBe(false);
    });

    it('hashes the exact bytes it was given, so the outcome file pins the artifact', () => {
        const a = checkSnapshotCoversPlans(snap(['rice']), []);
        const b = checkSnapshotCoversPlans(snap(['rice']), []);
        const c = checkSnapshotCoversPlans(snap(['oats']), []);
        expect(a.sha256).toBe(b.sha256);
        expect(a.sha256).not.toBe(c.sha256);
    });
});
