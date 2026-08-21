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
    majorityPair,
    parseReviewedBy,
    reviewStateOf,
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
        reviewedAt: null,
        reviewedBy: null,
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
        usedCount: 448,
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

// ---------------------------------------------------------------------------
// 5. The majority view (human-review only — D-A3) and the review stamp
// ---------------------------------------------------------------------------

describe('majorityPair — the view predicate', () => {
    it('is true for the live fairlife shape: 9/10 SUSPECT, one OK hiding it from the rule', () => {
        const vs = [...Array.from({ length: 9 }, () => verdict()), verdict({ verdict: 'OK', axis: 'none' })];
        const [g] = groupByPair(vs);
        expect(screenPair(g).qualifies).toBe(false);
        expect(majorityPair(g)).toBe(true);
    });

    it('is false for a unanimous pair — that is a candidate, not a view row', () => {
        const [g] = groupByPair([verdict(), verdict(), verdict()]);
        expect(screenPair(g).qualifies).toBe(true);
        expect(majorityPair(g)).toBe(false);
    });

    it('requires a STRICT majority — 2/4 is a tie, not a majority', () => {
        const [g] = groupByPair([verdict(), verdict(), verdict({ verdict: 'OK', axis: 'none' }), verdict({ verdict: 'OK', axis: 'none' })]);
        expect(majorityPair(g)).toBe(false);
    });

    it('respects minN — 2/2 is unanimous but under the threshold, and is neither', () => {
        const [g] = groupByPair([verdict(), verdict()]);
        expect(majorityPair(g)).toBe(false);
        expect(screenPair(g).qualifies).toBe(false);
    });

    it('includes a unanimous pair whose bill MOVED — the rule refuses it, the human should see it', () => {
        const [g] = groupByPair([verdict(), verdict(), verdict(), verdict({ billedGrams: 414 })]);
        expect(screenPair(g).qualifies).toBe(false);
        expect(majorityPair(g)).toBe(true);
    });
});

describe('parseReviewedBy / reviewStateOf — reading the stamp back', () => {
    it('splits <who>:<disposition> on the first colon only', () => {
        expect(parseReviewedBy('lane-a-2026-08-21:cascade')).toEqual({ who: 'lane-a-2026-08-21', disposition: 'cascade' });
        expect(parseReviewedBy('bare-name')).toEqual({ who: 'bare-name', disposition: null });
        expect(parseReviewedBy('')).toEqual({ who: null, disposition: null });
        expect(parseReviewedBy(null)).toEqual({ who: null, disposition: null });
    });

    it('a pair is reviewed only when EVERY verdict is stamped', () => {
        const at = new Date('2026-08-22T00:00:00Z');
        const all = [verdict({ reviewedAt: at, reviewedBy: 'a:dismiss' }), verdict({ reviewedAt: at, reviewedBy: 'a:dismiss' })];
        expect(reviewStateOf(all)).toMatchObject({ reviewed: true, unreviewedCount: 0, newSinceReview: 0 });
        expect(reviewStateOf(all).latest).toMatchObject({ who: 'a', disposition: 'dismiss' });

        const partial = [verdict({ reviewedAt: at, reviewedBy: 'a:dismiss' }), verdict()];
        expect(reviewStateOf(partial)).toMatchObject({ reviewed: false, unreviewedCount: 1 });
    });

    it('re-opens a stamped pair when a verdict arrives AFTER the stamp', () => {
        const at = new Date(Date.UTC(2026, 7, 12, 0, 0));
        // seq 1,2 → 08-11, 08-12 11:35 (after 00:00 on 08-12 → one is "new since")
        const vs = [verdict({ reviewedAt: at, reviewedBy: 'a:watch' }), verdict({ reviewedAt: at, reviewedBy: 'a:watch' }), verdict()];
        const r = reviewStateOf(vs);
        expect(r.reviewed).toBe(false);
        expect(r.unreviewedCount).toBe(1);
        expect(r.newSinceReview).toBeGreaterThanOrEqual(1);
    });

    it('an empty pair is not reviewed', () => {
        expect(reviewStateOf([]).reviewed).toBe(false);
    });
});

describe('buildTriageQueue — majority section and review state', () => {
    it('lists the hidden 9/10 pair in the majority view with serves, and NOT as a candidate', () => {
        const vs = [...Array.from({ length: 9 }, () => verdict()), verdict({ verdict: 'OK', axis: 'none' })];
        const r = buildTriageQueue(vs, [mapping()]);
        expect(r.candidates).toHaveLength(0);
        expect(r.majority).toHaveLength(1);
        expect(r.majority[0]).toMatchObject({
            normalizedForm: 'core fairlife power', suspectCount: 9, n: 10, share: 0.9,
            pointerStatus: 'live', serves: 448, review: { reviewed: false },
        });
        expect(r.majority[0].notEmittedBecause.join(' ')).toMatch(/not unanimous/);
        expect(r.majority[0].latestSuspectReason).toBe('a 250 g bill for a 414 ml bottle');
    });

    it('orders the majority view by share, then n, then serves', () => {
        const a = [...Array.from({ length: 3 }, () => verdict({ normalizedForm: 'aaa' })), verdict({ normalizedForm: 'aaa', verdict: 'OK', axis: 'none' })]; // 3/4
        const b = [...Array.from({ length: 9 }, () => verdict({ normalizedForm: 'bbb' })), verdict({ normalizedForm: 'bbb', verdict: 'OK', axis: 'none' })]; // 9/10
        const c = [...Array.from({ length: 3 }, () => verdict({ normalizedForm: 'ccc' })), verdict({ normalizedForm: 'ccc', verdict: 'OK', axis: 'none' })]; // 3/4, more serves
        const r = buildTriageQueue([...a, ...b, ...c], [
            mapping({ normalizedForm: 'aaa', usedCount: 5 }),
            mapping({ normalizedForm: 'bbb', usedCount: 1 }),
            mapping({ normalizedForm: 'ccc', usedCount: 50 }),
        ]);
        expect(r.majority.map(m => m.normalizedForm)).toEqual(['bbb', 'ccc', 'aaa']);
    });

    it('counts a fully stamped candidate as reviewed, and an unstamped one as open', () => {
        const at = new Date('2026-08-22T00:00:00Z');
        const reviewed = Array.from({ length: 3 }, () => verdict({ normalizedForm: 'done', reviewedAt: at, reviewedBy: 'lane-a:repaired' }));
        const open = Array.from({ length: 3 }, () => verdict({ normalizedForm: 'todo' }));
        const r = buildTriageQueue([...reviewed, ...open], [mapping({ normalizedForm: 'done' }), mapping({ normalizedForm: 'todo' })], { reviewedCount: 3 });
        expect(r.candidates).toHaveLength(2);
        expect(r.reviewedCandidateCount).toBe(1);
        expect(r.openCandidateCount).toBe(1);
        const done = r.candidates.find(c => c.normalizedForm === 'done')!;
        expect(done.review).toMatchObject({ reviewed: true, who: 'lane-a', disposition: 'repaired', newSinceReview: 0 });
        expect(r.log.join(' ')).toMatch(/1 open \/ 1 reviewed/);
    });

    it('renders the majority section and the D-A3 caveat in markdown', () => {
        const vs = [...Array.from({ length: 9 }, () => verdict()), verdict({ verdict: 'OK', axis: 'none' })];
        const md = renderMarkdown(buildTriageQueue(vs, [mapping()]));
        expect(md).toMatch(/## Majority view — HUMAN REVIEW ONLY/);
        expect(md).toMatch(/`core fairlife power`.*9\/10/);
        expect(md).toMatch(/never an auto-bar/);
        expect(md).toMatch(/ordering aid, not a price/);
    });

    it('keeps the majority view EMPTY when the only repeated pair is unanimous — no double listing', () => {
        const r = buildTriageQueue([verdict(), verdict(), verdict()], [mapping()]);
        expect(r.candidates).toHaveLength(1);
        expect(r.majority).toHaveLength(0);
    });
});
