/**
 * The SERVING verdict — winner-diff blind spot (B), closed 2026-07-27.
 *
 * These tests exist because of a specific shipped failure. PR #173 moved
 * `mac and cheese` off an AI backfill onto the record literally named "Mac and
 * Cheese" — the winner diff showed 5 NOWINNER->WINNER and 0 losses, the eval
 * stayed at 0 real failures, and the gate was green. The billed number went
 * 90.4 -> 39.5 kcal against a true ~400, because the 28g serving anchor never
 * moved and the newly-admitted record has a lower kcal/100g.
 *
 * Nothing in the harness could see that. The verdict below is what sees it, so
 * the cases that matter most here are the ones asserting that ABSENCE OF DATA
 * is reported as UNJUDGED and never as agreement.
 */

import {
    ReplayRow,
    ServingInfo,
    billedKcalDeltaPct,
    classifyServing,
    summariseServing,
    formatServingSummary,
} from '../winner-diff-screens';

function row(query: string, serving?: ServingInfo | null): ReplayRow {
    return {
        query,
        path: 'rerank',
        relaxedRecovery: false,
        pool: {
            gather: 10, afterTokenFilter: 8, afterCoreToken: 6, afterZeroMacro: 6,
            afterPlausibility: 5, afterDenylist: 5, admitted: 5, rerankWindow: 5,
        },
        rerankWindowIds: [], admittedIds: [], rerankRan: true,
        gate: { skipAiRerank: false, reason: 'ok', confidence: 0.8 },
        winner: null,
        notes: [],
        ...(serving === undefined ? {} : { serving }),
    };
}

const s = (grams: number | null, tier: string | null, kcal: number | null, aiTouched = false): ServingInfo =>
    ({ grams, servingTier: tier, servingDescription: null, totalKcal: kcal, aiTouched });

describe('classifyServing', () => {
    it('reports GRAMS-CHANGED when the billed grams move', () => {
        expect(classifyServing(
            row('rxbar chocolate sea salt', s(2.5, 'bare_category_default', 9.6)),
            row('rxbar chocolate sea salt', s(52, 'bare_label_serving', 210)),
        )).toBe('GRAMS-CHANGED');
    });

    it('reports TIER-CHANGED when grams hold but provenance moves', () => {
        expect(classifyServing(
            row('bagel', s(98, 'bare_sibling_serving', 260)),
            row('bagel', s(98, 'bare_label_serving', 260)),
        )).toBe('TIER-CHANGED');
    });

    it('treats sub-epsilon float drift as SAME', () => {
        expect(classifyServing(row('q', s(28.0, 't', 90)), row('q', s(28.004, 't', 90)))).toBe('SERVING-SAME');
    });

    it('reports gained and lost servings in the right direction', () => {
        expect(classifyServing(row('q', s(null, null, null)), row('q', s(50, 't', 100)))).toBe('NOSERVING->SERVING');
        expect(classifyServing(row('q', s(50, 't', 100)), row('q', s(null, null, null)))).toBe('SERVING->NOSERVING');
    });

    // ---- the cases the whole file exists for: silence is never agreement ----

    it('a replay taken WITHOUT the serving stage is UNJUDGED, not SERVING-SAME', () => {
        // `serving === undefined` means the stage never ran. Calling that
        // agreement is precisely the blind spot that cleared PR #173.
        expect(classifyServing(row('mac and cheese'), row('mac and cheese'))).toBe('UNJUDGED');
        expect(classifyServing(row('q'), row('q', s(28, 't', 39.5)))).toBe('UNJUDGED');
        expect(classifyServing(row('q', s(28, 't', 90.4)), row('q'))).toBe('UNJUDGED');
    });

    it('a serving-stage error is UNJUDGED, not unchanged', () => {
        const errored: ServingInfo = { ...s(null, null, null), error: 'winner not found in frozen pool' };
        expect(classifyServing(row('q', errored), row('q', s(null, null, null)))).toBe('UNJUDGED');
    });

    it('an AI-estimated tier gets its own verdict rather than counting as movement', () => {
        // AI estimators do not replay deterministically. Counting them as movement
        // would make every gate look noisy; counting them as SAME would hide real
        // regressions behind a model call. Neither — they are named.
        expect(classifyServing(
            row('q', s(30, 'ai_generated_serving', 100, true)),
            row('q', s(45, 'ai_generated_serving', 150, true)),
        )).toBe('AI-NONDETERMINISTIC');
    });

    it('null-vs-null with the stage RUN is genuine agreement', () => {
        expect(classifyServing(row('q', null), row('q', null))).toBe('SERVING-SAME');
    });
});

describe('billedKcalDeltaPct', () => {
    it('is negative when the change makes the user under-billed', () => {
        // The literal PR #173 numbers. A gate that prints this cannot report the
        // change as a closed under-bill.
        const d = billedKcalDeltaPct(
            row('mac and cheese', s(28, 'flat', 90.4)),
            row('mac and cheese', s(28, 'bare_category_default', 39.5)),
        );
        expect(d).not.toBeNull();
        expect(d!).toBeCloseTo(-56.3, 1);
    });

    it('is null rather than Infinity when the A side billed zero', () => {
        expect(billedKcalDeltaPct(row('q', s(10, 't', 0)), row('q', s(10, 't', 50)))).toBeNull();
    });

    it('is null when either side lacks a total', () => {
        expect(billedKcalDeltaPct(row('q'), row('q', s(10, 't', 50)))).toBeNull();
    });
});

describe('summariseServing', () => {
    const A = [
        row('mac and cheese', s(28, 'bare_category_default', 39.5)),
        row('rxbar chocolate sea salt', s(2.5, 'bare_category_default', 9.6)),
        row('black pepper', s(2.5, 'bare_category_default', 9.1)),
        row('ghost cinnamon roll', s(30, 'ai_generated_serving', 120, true)),
        row('unrun'),
    ];
    const B = [
        row('mac and cheese', s(200, 'bare_sibling_serving', 282)),
        row('rxbar chocolate sea salt', s(52, 'bare_label_serving', 210)),
        row('black pepper', s(2.5, 'bare_category_default', 9.1)),
        row('ghost cinnamon roll', s(31, 'ai_generated_serving', 124, true)),
        row('unrun'),
    ];

    it('counts every verdict and ranks movers by kcal magnitude', () => {
        const sum = summariseServing(A, B);
        expect(sum.counts['GRAMS-CHANGED']).toBe(2);
        expect(sum.counts['SERVING-SAME']).toBe(1);
        expect(sum.counts['AI-NONDETERMINISTIC']).toBe(1);
        expect(sum.counts['UNJUDGED']).toBe(1);
        // rxbar is +2088%, mac and cheese +614% — biggest first.
        expect(sum.moved.map(m => m.query)).toEqual(['rxbar chocolate sea salt', 'mac and cheese']);
    });

    it('lists the unjudged rows instead of only counting them', () => {
        const sum = summariseServing(A, B);
        expect(sum.unjudged).toContain('unrun');
        expect(sum.unjudged).toContain('ghost cinnamon roll');
    });

    it('formats the unjudged rows into the report so a count cannot read as clearance', () => {
        const text = formatServingSummary(summariseServing(A, B)).join('\n');
        expect(text).toContain('UNJUDGED');
        expect(text).toContain('NOT evidence of no change');
        expect(text).toContain('unrun');
        expect(text).toContain('BILLED-NUMBER MOVERS');
    });

    it('does not crash on an empty population', () => {
        const sum = summariseServing([], []);
        expect(formatServingSummary(sum).join('\n')).toContain('no comparable rows');
    });
});
