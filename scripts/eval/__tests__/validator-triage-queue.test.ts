/**
 * validator-triage-queue.test.ts — the predicate and the pointer classifier.
 *
 * NO NETWORK, NO DATABASE. `openPrisma` is never called; every test drives the
 * pure functions with hand-built fixtures, so the suite cannot depend on what the
 * live table happens to hold on the day it runs (which is exactly what this table
 * does — it grows ~1 row/night).
 *
 * What is worth testing here, in order of how badly a bug would hurt:
 *   1. the three clauses of the rule, each falsified independently — a screen that
 *      silently accepts a non-unanimous or moved-bill pair is worse than no screen,
 *      because it launders disagreement into a repair queue;
 *   2. the pointer classifier — a candidate whose row has been repointed must be
 *      REPORTED, not dropped, or the reader hides the rows that prove it works;
 *   3. that zero candidates is a normal exit, not an error, and that the near-miss
 *      comparator reproduces the naive count the rule is defended against.
 */

import {
    TRIAGE_MIN_N,
    buildTriageQueue,
    groupByPair,
    mappingTargetId,
    naiveAnySuspect,
    parseIntFlag,
    pointerStatusOf,
    renderMarkdown,
    resolveOutBase,
    screenPair,
    FlagError,
    type MappingPointer,
    type VerdictRecord,
} from '../validator-triage-queue';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let seq = 0;

function verdict(over: Partial<VerdictRecord> = {}): VerdictRecord {
    seq++;
    return {
        normalizedForm: 'core fairlife power',
        foodId: 'off_0711620020636',
        phrase: 'fairlife core power',
        verdict: 'SUSPECT',
        axis: 'serving',
        reason: 'a 250 g bill for a 414 ml bottle',
        model: 'anthropic/claude-sonnet-5',
        billedGrams: 250,
        billedKcal: 139,
        servingTier: 'bare_sibling_serving',
        // Distinct, increasing, and on distinct days so `nights` is meaningful.
        createdAt: new Date(Date.UTC(2026, 7, 10 + seq, 11, 35)),
        ...over,
    };
}

function mapping(over: Partial<MappingPointer> = {}): MappingPointer {
    return {
        normalizedForm: 'core fairlife power',
        source: 'openfoodfacts',
        offBarcode: '0711620020636',
        fdcId: null,
        fsId: null,
        foodName: 'Fairlife Core Power High Protein Milkshake',
        brandName: 'Fairlife',
        validatedBy: 'ai',
        validatedAt: new Date('2026-07-19T00:55:28.952Z'),
        ...over,
    };
}

beforeEach(() => { seq = 0; });

// ---------------------------------------------------------------------------
// 1. The predicate
// ---------------------------------------------------------------------------

describe('screenPair — the three clauses', () => {
    it('emits on exactly 3 unanimous SUSPECT verdicts with identical billedGrams', () => {
        const g = groupByPair([verdict(), verdict(), verdict()])[0];
        expect(g.n).toBe(3);
        const r = screenPair(g);
        expect(r.qualifies).toBe(true);
        expect(r.failReasons).toEqual([]);
    });

    it('refuses n < 3 even when every verdict is SUSPECT', () => {
        const g = groupByPair([verdict(), verdict()])[0];
        const r = screenPair(g);
        expect(r.qualifies).toBe(false);
        expect(r.failReasons.join(' ')).toMatch(/n=2 < 3/);
    });

    it('refuses a mixed panel — one OK among three breaks unanimity', () => {
        const g = groupByPair([
            verdict(),
            verdict({ verdict: 'OK', axis: 'none' }),
            verdict(),
        ])[0];
        expect(g.n).toBe(3);
        expect(g.suspectCount).toBe(2);
        const r = screenPair(g);
        expect(r.qualifies).toBe(false);
        expect(r.failReasons.join(' ')).toMatch(/not unanimous: 2\/3 SUSPECT/);
    });

    it('refuses when billedGrams differs across the verdicts', () => {
        const g = groupByPair([
            verdict({ billedGrams: 250 }),
            verdict({ billedGrams: 250 }),
            verdict({ billedGrams: 414 }),
        ])[0];
        const r = screenPair(g);
        expect(r.qualifies).toBe(false);
        expect(r.failReasons.join(' ')).toMatch(/billedGrams varies/);
        expect(g.distinctBilledGrams).toEqual([250, 414]);
    });

    it('reports EVERY failed clause, not just the first', () => {
        // n=2, not unanimous, and the bill moved: all three clauses fail.
        const g = groupByPair([
            verdict({ billedGrams: 250 }),
            verdict({ billedGrams: 300, verdict: 'OK', axis: 'none' }),
        ])[0];
        const r = screenPair(g);
        expect(r.qualifies).toBe(false);
        expect(r.failReasons).toHaveLength(3);
    });

    it('honours a caller-supplied minN without touching the exported default', () => {
        const g = groupByPair([verdict(), verdict()])[0];
        expect(screenPair(g, 2).qualifies).toBe(true);
        expect(screenPair(g).qualifies).toBe(false);
        expect(TRIAGE_MIN_N).toBe(3);
    });

    it('groups by the PAIR — same key, two different records stay separate', () => {
        const groups = groupByPair([
            verdict({ foodId: 'off_A' }),
            verdict({ foodId: 'off_A' }),
            verdict({ foodId: 'off_B' }),
        ]);
        expect(groups).toHaveLength(2);
        expect(groups.map(g => g.n).sort()).toEqual([1, 2]);
    });

    it('does not collide two pairs whose space-joined composite is the same string', () => {
        // 'a b' + 'off_c' vs 'a' + 'b off_c' — only reachable if the joiner is a
        // space. foodId never contains one in production, but the key must not
        // depend on that.
        const groups = groupByPair([
            verdict({ normalizedForm: 'a b', foodId: 'off_c' }),
            verdict({ normalizedForm: 'a', foodId: 'b off_c' }),
        ]);
        expect(groups).toHaveLength(2);
    });

    it('counts axes over the SUSPECT verdicts only', () => {
        const g = groupByPair([
            verdict({ axis: 'serving' }),
            verdict({ axis: 'identity' }),
            verdict({ verdict: 'OK', axis: 'none' }),
        ])[0];
        expect(g.axisCounts).toEqual({ serving: 1, identity: 1 });
    });

    it('carries every distinct phrase verbatim', () => {
        const g = groupByPair([
            verdict({ phrase: 'fairlife core power' }),
            verdict({ phrase: 'a fairlife core power' }),
            verdict({ phrase: 'fairlife core power' }),
        ])[0];
        expect(g.phrases).toEqual(['fairlife core power', 'a fairlife core power']);
    });
});

describe('naiveAnySuspect — the comparator', () => {
    it('fires on a repeated pair with a single SUSPECT', () => {
        const g = groupByPair([verdict(), verdict({ verdict: 'OK', axis: 'none' })])[0];
        expect(naiveAnySuspect(g)).toBe(true);
        expect(screenPair(g).qualifies).toBe(false);
    });

    it('does not fire on a singleton', () => {
        const g = groupByPair([verdict()])[0];
        expect(naiveAnySuspect(g)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 2. The pointer classifier
// ---------------------------------------------------------------------------

describe('mappingTargetId — the inverse of saveValidatedMapping()', () => {
    it('rebuilds each of the three prefixed forms', () => {
        expect(mappingTargetId({ offBarcode: '123', fdcId: null, fsId: null })).toBe('off_123');
        expect(mappingTargetId({ offBarcode: null, fdcId: 168917, fsId: null })).toBe('fdc_168917');
        expect(mappingTargetId({ offBarcode: null, fdcId: null, fsId: '75421144' })).toBe('fs_75421144');
    });

    it('returns null rather than inventing a target when the row points nowhere', () => {
        expect(mappingTargetId({ offBarcode: null, fdcId: null, fsId: null })).toBeNull();
    });
});

describe('pointerStatusOf', () => {
    it('live when the row still points at the judged record', () => {
        expect(pointerStatusOf('off_0711620020636', mapping())).toBe('live');
    });

    it('repointed when the row now points somewhere else', () => {
        // The CAVA shape: judged an OFF record, repaired onto a FatSecret one.
        const repaired = mapping({ offBarcode: null, fsId: '75421144', source: 'fatsecret', validatedBy: 'human-triage' });
        expect(pointerStatusOf('off_0898328002222', repaired)).toBe('repointed');
    });

    it('missing when the FoodMapping row is gone', () => {
        expect(pointerStatusOf('off_0711620020636', null)).toBe('missing');
        expect(pointerStatusOf('off_0711620020636', undefined)).toBe('missing');
    });

    it('unresolvable when the row carries no target column', () => {
        expect(pointerStatusOf('off_x', mapping({ offBarcode: null, fdcId: null, fsId: null }))).toBe('unresolvable');
    });
});

// ---------------------------------------------------------------------------
// 3. The queue
// ---------------------------------------------------------------------------

describe('buildTriageQueue', () => {
    it('reports a repointed candidate instead of dropping it', () => {
        const verdicts = [
            verdict({ normalizedForm: 'avocado bowl cava harissa', foodId: 'off_0898328002222', axis: 'identity', billedGrams: 28 }),
            verdict({ normalizedForm: 'avocado bowl cava harissa', foodId: 'off_0898328002222', axis: 'identity', billedGrams: 28 }),
            verdict({ normalizedForm: 'avocado bowl cava harissa', foodId: 'off_0898328002222', axis: 'identity', billedGrams: 28 }),
        ];
        const mappings = [mapping({
            normalizedForm: 'avocado bowl cava harissa',
            offBarcode: null, fsId: '75421144', source: 'fatsecret',
            foodName: 'Harissa Avocado Curated Bowl', brandName: 'Cava',
            validatedBy: 'human-triage',
        })];

        const report = buildTriageQueue(verdicts, mappings);
        expect(report.candidates).toHaveLength(1);
        const c = report.candidates[0];
        expect(c.pointerStatus).toBe('repointed');
        expect(c.currentFoodId).toBe('fs_75421144');
        expect(c.currentValidatedBy).toBe('human-triage');
        expect(c.note).toMatch(/STALE EVIDENCE/);
        // It is a candidate, but it must not be counted as work to do.
        expect(report.actionableCount).toBe(0);
        expect(report.staleCount).toBe(1);
        expect(report.byPointerStatus.repointed).toBe(1);
    });

    it('counts a live candidate as actionable', () => {
        const report = buildTriageQueue([verdict(), verdict(), verdict()], [mapping()]);
        expect(report.candidates).toHaveLength(1);
        expect(report.candidates[0].pointerStatus).toBe('live');
        expect(report.candidates[0].note).toMatch(/ACTIONABLE/);
        expect(report.actionableCount).toBe(1);
        expect(report.staleCount).toBe(0);
    });

    it('screens on the verdicts BEFORE consulting the pointer', () => {
        // A repointed row whose verdicts do not meet the rule is still not a
        // candidate: the pointer only labels, it never admits.
        const report = buildTriageQueue([verdict(), verdict()], [mapping({ offBarcode: 'other' })]);
        expect(report.candidates).toHaveLength(0);
        expect(report.nearMisses).toHaveLength(1);
    });

    it('reproduces the 2-vs-4 receipt: unanimity halves the naive count', () => {
        const pair = (form: string, id: string, verdicts: Partial<VerdictRecord>[]) =>
            verdicts.map(v => verdict({ normalizedForm: form, foodId: id, ...v }));
        const rows = [
            // qualifies: 7/7 (abbreviated to 3/3 — the rule is n>=3, not n=7)
            ...pair('avocado bowl cava harissa', 'off_A', [{}, {}, {}]),
            // qualifies: 3/3
            ...pair('core fairlife power', 'off_B', [{}, {}, {}]),
            // repeated + some SUSPECT, but NOT unanimous -> naive only
            ...pair('joe scandinavian swimmer trader', 'fs_C', [{}, {}, { verdict: 'OK', axis: 'none' }]),
            ...pair('bowl burrito chicken chipotle', 'off_D', [{}, { verdict: 'OK', axis: 'none' }, { verdict: 'OK', axis: 'none' }]),
            // repeated, all OK -> neither
            ...pair('cracker goldfish', 'off_E', [
                { verdict: 'OK', axis: 'none' }, { verdict: 'OK', axis: 'none' }, { verdict: 'OK', axis: 'none' },
            ]),
            // singleton SUSPECT -> neither (naive is scoped to repeated pairs)
            ...pair('chai masala', 'off_F', [{}]),
        ];

        const report = buildTriageQueue(rows, []);
        expect(report.naiveCandidateCount).toBe(4);
        expect(report.candidates).toHaveLength(2);
        expect(report.candidates.map(c => c.normalizedForm).sort())
            .toEqual(['avocado bowl cava harissa', 'core fairlife power']);
        // The two the naive screen would have added are visible as near misses.
        const naiveOnly = report.nearMisses.filter(m => m.naiveWouldEmit);
        expect(naiveOnly.map(m => m.normalizedForm).sort())
            .toEqual(['bowl burrito chicken chipotle', 'joe scandinavian swimmer trader']);
    });

    it('treats zero candidates as a normal result and says why', () => {
        const report = buildTriageQueue([verdict({ verdict: 'OK', axis: 'none' })], [mapping()]);
        expect(report.candidates).toHaveLength(0);
        expect(report.verdictCount).toBe(1);
        expect(report.log.join(' ')).toMatch(/not a clean bill of health/);
        expect(report.caveats.join(' ')).toMatch(/ZERO CANDIDATES IS NOT/);
    });

    it('keeps the two honest limits in the report, not just in the header comment', () => {
        const report = buildTriageQueue([verdict(), verdict(), verdict()], [mapping()]);
        expect(report.caveats.join(' ')).toMatch(/CONSERVATISM, NOT FROM A MEASURED OPERATING POINT/);
        expect(report.caveats.join(' ')).toMatch(/HOT HEAD, NEVER THE TAIL/);
        expect(report.caveats.join(' ')).toMatch(/4,468/);
    });

    it('does not list an all-OK pair as a near miss', () => {
        const rows = [
            verdict({ verdict: 'OK', axis: 'none' }),
            verdict({ verdict: 'OK', axis: 'none' }),
        ];
        expect(buildTriageQueue(rows, []).nearMisses).toHaveLength(0);
    });

    it('sorts worst-first by verdict count', () => {
        const rows = [
            ...[1, 2, 3].map(() => verdict({ normalizedForm: 'three', foodId: 'off_3' })),
            ...[1, 2, 3, 4, 5].map(() => verdict({ normalizedForm: 'five', foodId: 'off_5' })),
        ];
        const report = buildTriageQueue(rows, []);
        expect(report.candidates.map(c => c.normalizedForm)).toEqual(['five', 'three']);
    });

    it('surfaces the verbatim phrase and the judge reasons on a candidate', () => {
        const report = buildTriageQueue([verdict(), verdict(), verdict()], [mapping()]);
        const c = report.candidates[0];
        expect(c.phrases).toEqual(['fairlife core power']);
        expect(c.reasons).toHaveLength(3);
        expect(c.nights).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Rendering + flags
// ---------------------------------------------------------------------------

describe('rendering and flags', () => {
    it('renders markdown carrying the comparator and the caveats', () => {
        const report = buildTriageQueue([verdict(), verdict(), verdict()], [mapping()]);
        const md = renderMarkdown(report);
        expect(md).toContain('core fairlife power');
        expect(md).toContain('probe VERBATIM');
        expect(md).toContain('## Caveats');
        expect(md).toMatch(/would emit \*\*\d+\*\*/);
    });

    it('renders an empty queue without claiming the cache is clean', () => {
        const md = renderMarkdown(buildTriageQueue([verdict({ verdict: 'OK', axis: 'none' })], []));
        expect(md).toContain('not a clean bill of health');
    });

    it('refuses a non-integer --min-n rather than emitting an empty queue', () => {
        expect(() => parseIntFlag('--min-n', 'abc', 3, 1)).toThrow(FlagError);
        expect(() => parseIntFlag('--min-n', '--all', 3, 1)).toThrow(/takes a value/);
        expect(() => parseIntFlag('--min-n', '0', 3, 1)).toThrow(/>= 1/);
        expect(parseIntFlag('--min-n', undefined, 3, 1)).toBe(3);
        expect(parseIntFlag('--min-n', '4', 3, 1)).toBe(4);
    });

    it('strips a trailing extension from --out so .json/.md are not doubled', () => {
        expect(resolveOutBase('/tmp/q.json', new Date())).toBe('/tmp/q');
        expect(resolveOutBase('/tmp/q.md', new Date())).toBe('/tmp/q');
        expect(resolveOutBase(undefined, new Date('2026-08-15T01:02:03.400Z')))
            .toMatch(/validator-triage-queue-2026-08-15T01-02-03-400Z$/);
    });
});
