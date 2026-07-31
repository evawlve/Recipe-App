/**
 * Guards for restore-off-pointers.ts.
 *
 * Same discipline as cache-ops-guards.test.ts: this is the post-disaster path,
 * so every way the run could quietly restore nothing and still look clean is
 * forced, and every block carries a POSITIVE CONTROL so "always refuses" cannot
 * satisfy the suite.
 */

import {
    corpusLooksEmpty,
    extractOffPointers,
    partitionPointerRestore,
    pointerExitCode,
    residueReportLines,
    type OffPointer,
    type PointerPartition,
} from '../restore-off-pointers';
import type { SnapshotRow } from '../_evict_rows';

const row = (normalizedForm: string, offBarcode: unknown): SnapshotRow =>
    ({ normalizedForm, offBarcode } as SnapshotRow);

const ptr = (normalizedForm: string, offBarcode: string): OffPointer => ({ normalizedForm, offBarcode });

const emptyPartition = (): PointerPartition =>
    ({ restorable: [], orphaned: [], missingRow: [], alreadySet: [] });

describe('extractOffPointers', () => {
    test('positive control: rows carrying a barcode become pointers', () => {
        expect(extractOffPointers([row('greek plain yogurt', '0123456789012')]))
            .toEqual([ptr('greek plain yogurt', '0123456789012')]);
    });

    test.each([
        ['null — a FatSecret/FDC row, never part of this operation', null],
        ['undefined — column absent from the snapshot row', undefined],
        ['empty string', ''],
        ['whitespace only', '   '],
        ['a number — pgvector/JSON round-trips can retype; a non-string is not a barcode', 12345],
    ])('%s yields no pointer', (_name, bad) => {
        expect(extractOffPointers([row('k', bad)])).toEqual([]);
    });

    test('mixed rows keep only the pointered ones — the FS/FDC majority must not be invented', () => {
        const got = extractOffPointers([
            row('a', '111'), row('b', null), row('c', '222'), row('d', undefined),
        ]);
        expect(got.map(p => p.normalizedForm)).toEqual(['a', 'c']);
    });
});

describe('partitionPointerRestore', () => {
    const pointers = [ptr('a', '111'), ptr('b', '222'), ptr('c', '333'), ptr('d', '444')];
    const live = new Map<string, string | null>([
        ['a', null],   // restorable
        ['b', null],   // barcode delisted -> orphaned
        ['c', '999'],  // live traffic repointed it -> alreadySet
        // 'd' absent    -> missingRow
    ]);
    const surviving = new Set(['111', '333', '444']);

    test('positive control: each row lands in exactly one bucket', () => {
        const p = partitionPointerRestore(pointers, live, surviving);
        expect(p.restorable.map(x => x.normalizedForm)).toEqual(['a']);
        expect(p.orphaned.map(x => x.normalizedForm)).toEqual(['b']);
        expect(p.alreadySet.map(x => x.normalizedForm)).toEqual(['c']);
        expect(p.missingRow.map(x => x.normalizedForm)).toEqual(['d']);
    });

    test('every pointer is accounted for — nothing may be silently dropped', () => {
        const p = partitionPointerRestore(pointers, live, surviving);
        const total = p.restorable.length + p.orphaned.length + p.missingRow.length + p.alreadySet.length;
        expect(total).toBe(pointers.length);
    });

    test('a row whose live pointer already equals the snapshot is STILL not rewritten', () => {
        // Same value, but the column is not NULL, so --fresh did not strip it and
        // this key is not ours to touch. Writing it would be a no-op today and a
        // clobber the day the values differ.
        const p = partitionPointerRestore([ptr('a', '111')], new Map([['a', '111']]), new Set(['111']));
        expect(p.restorable).toHaveLength(0);
        expect(p.alreadySet).toHaveLength(1);
    });

    test('a surviving barcode cannot rescue a key that no longer exists', () => {
        const p = partitionPointerRestore([ptr('gone', '111')], new Map(), new Set(['111']));
        expect(p.missingRow).toHaveLength(1);
        expect(p.restorable).toHaveLength(0);
    });
});

describe('corpusLooksEmpty — the refusal that stops a green no-op', () => {
    test('positive control: a normal partial-survival read is NOT empty', () => {
        expect(corpusLooksEmpty(2854, 2701)).toBe(false);
    });
    test('even a single survivor is a real corpus', () => {
        expect(corpusLooksEmpty(2854, 1)).toBe(false);
    });
    test('asking about barcodes and matching none is a refusal, not 100% delisting', () => {
        expect(corpusLooksEmpty(2854, 0)).toBe(true);
    });
    test('asking about nothing is not an empty corpus — the zero-pointer case refuses earlier', () => {
        expect(corpusLooksEmpty(0, 0)).toBe(false);
    });
});

describe('pointerExitCode — residue is never success', () => {
    test('positive control: a clean full restore exits 0', () => {
        const p = emptyPartition();
        p.restorable.push(ptr('a', '111'));
        expect(pointerExitCode(p)).toBe(0);
    });

    test.each([
        ['orphaned', 'orphaned'],
        ['missingRow', 'missingRow'],
        ['alreadySet', 'alreadySet'],
    ] as const)('a single %s row alone exits 3', (_name, bucket) => {
        const p = emptyPartition();
        p.restorable.push(ptr('a', '111'));
        p[bucket].push(ptr('b', '222'));
        expect(pointerExitCode(p)).toBe(3);
    });

    test('exit 3 even when NOTHING was restorable — an all-residue run must not read as 0', () => {
        const p = emptyPartition();
        p.orphaned.push(ptr('b', '222'));
        expect(pointerExitCode(p)).toBe(3);
    });
});

describe('residueReportLines — every unrestored key is printed', () => {
    test('positive control: a clean partition prints nothing', () => {
        expect(residueReportLines(emptyPartition())).toEqual([]);
    });

    test('each unrestored key appears by name, so the report is a worklist not a count', () => {
        const p = emptyPartition();
        p.orphaned.push(ptr('discontinued bar', '111'));
        p.missingRow.push(ptr('evicted key', '222'));
        p.alreadySet.push(ptr('repointed key', '333'));
        const text = residueReportLines(p).join('\n');
        expect(text).toContain('discontinued bar');
        expect(text).toContain('evicted key');
        expect(text).toContain('repointed key');
    });

    test('restorable rows are not reported as residue', () => {
        const p = emptyPartition();
        p.restorable.push(ptr('fine key', '111'));
        expect(residueReportLines(p)).toEqual([]);
    });
});
