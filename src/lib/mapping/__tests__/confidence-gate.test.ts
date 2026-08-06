/**
 * Confidence Gate Tests
 * 
 * Tests for the confidence gate early exit feature that:
 * 1. Skips AI reranking for high-confidence matches
 * 2. Still uses AI for ambiguous cases
 */

import { assessConfidence, confidenceGate, type UnifiedCandidate } from '../gather-candidates';
import { RERANK_DECLINED_CONFIDENCE, SUB_THRESHOLD_SAVE_FLOOR } from '../sub-threshold-admission';

const mockCandidate = (name: string, score: number): UnifiedCandidate => ({
    id: '123',
    source: 'fatsecret' as const,
    name,
    score,
    rawData: {},
});

describe('assessConfidence', () => {
    test('returns 1.0 for exact match', () => {
        const candidate = mockCandidate('Cheddar Cheese', 0.95);
        const conf = assessConfidence('cheddar cheese', candidate);
        expect(conf).toBe(1.0);
    });

    test('returns high confidence for contained match', () => {
        const candidate = mockCandidate('Cheddar Cheese Block', 0.95);
        const conf = assessConfidence('cheddar cheese', candidate);
        expect(conf).toBeGreaterThan(0.85);
    });

    test('returns lower confidence for partial token match', () => {
        const candidate = mockCandidate('Swiss Cheese', 0.90);
        const conf = assessConfidence('cheddar cheese', candidate);
        expect(conf).toBeLessThan(0.85);  // Only "cheese" matches
    });

    test('returns 1.0 for exact match regardless of score', () => {
        // Both should return 1.0 because they're exact matches
        const highScoreCandidate = mockCandidate('Cottage Cheese', 0.95);
        const lowScoreCandidate = mockCandidate('Cottage Cheese', 0.80);

        const highConf = assessConfidence('cottage cheese', highScoreCandidate);
        const lowConf = assessConfidence('cottage cheese', lowScoreCandidate);

        // Both are exact matches, so both return 1.0
        expect(highConf).toBe(1.0);
        expect(lowConf).toBe(1.0);
    });
});

describe('confidenceGate', () => {
    test('skips AI for high confidence exact match with clear margin', () => {
        // First candidate is exact match (1.0), second only partial match
        const candidates = [
            mockCandidate('Cheddar Cheese', 0.95),
            mockCandidate('Swiss Cheese', 0.90),  // Only "cheese" matches, lower confidence
        ];
        const result = confidenceGate('cheddar cheese', candidates);

        expect(result.skipAiRerank).toBe(true);
        expect(result.selected?.name).toBe('Cheddar Cheese');
        expect(result.reason).toBe('high_confidence_clear_winner');
    });

    test('does NOT skip AI when both candidates match equally well (pepper)', () => {
        // Both contain "pepper" so both have high confidence
        const candidates = [
            mockCandidate('Bell Pepper', 0.92),
            mockCandidate('Black Pepper', 0.91),
        ];
        const result = confidenceGate('pepper', candidates);

        // Margin between two high-confidence matches is too small
        expect(result.skipAiRerank).toBe(false);
        expect(result.reason).toContain('margin_too_small');
    });

    test('does NOT skip AI when confidence below threshold', () => {
        const candidates = [
            mockCandidate('Some Random Food', 0.95),
            mockCandidate('Another Food', 0.80),
        ];
        const result = confidenceGate('cottage cheese', candidates);

        expect(result.skipAiRerank).toBe(false);
        expect(result.reason).toContain('confidence_below_threshold');
    });

    test('does NOT skip AI when margin is too small', () => {
        const candidates = [
            mockCandidate('Low Fat Milk', 0.95),
            mockCandidate('Lowfat Milk', 0.94),  // Very similar score
        ];
        // Both would have similar confidence for "low fat milk"
        const result = confidenceGate('low fat milk', candidates);

        // If both are close matches, margin might be too small
        if (!result.skipAiRerank) {
            expect(result.reason).toContain('margin_too_small');
        }
    });

    test('returns no_candidates reason for empty list', () => {
        const result = confidenceGate('whatever', []);

        expect(result.skipAiRerank).toBe(false);
        expect(result.reason).toBe('no_candidates');
    });

    test('can skip AI with single candidate if high confidence', () => {
        const candidates = [
            mockCandidate('Olive Oil', 0.95),
        ];
        const result = confidenceGate('olive oil', candidates);

        expect(result.skipAiRerank).toBe(true);
        expect(result.selected?.name).toBe('Olive Oil');
    });
});

/**
 * basic_produce_bypass feeds confidence_gate_backstop in
 * map-ingredient-with-fallback.ts, which writes gateResult.confidence into the
 * cache with NO reason scope. The bypass names a candidate by REGEX on the
 * query, not by any assessment of it, so it must not report a number the
 * mobile badge reads as "✓ Exact Match".
 */
describe('basic_produce_bypass confidence is not a laundered engine score', () => {
    test('T4 does not launder a raw engine score', () => {
        // 6.9 is the measured computeOffScore median on the abstention
        // population. The old code did Math.max(0, Math.min(1, top1.score)),
        // which SATURATED to exactly 1 rather than rejecting.
        const candidates = [
            mockCandidate('Broccoli, raw', 6.9),
            mockCandidate('Broccoli Florets', 5.2),
        ];
        const result = confidenceGate('broccoli', candidates);

        expect(result.reason).toBe('basic_produce_bypass');
        expect(result.confidence).toBe(RERANK_DECLINED_CONFIDENCE);
        expect(result.confidence).not.toBe(1);
    });

    /**
     * T4b — the exit is a CEILING, not a replacement.
     *
     * This is the test the first cut of this PR did not have, and its absence
     * turned a narrowing into a loosening for the low tail. `basic_produce_bypass`
     * has no score floor of its own, so writing a flat RERANK_DECLINED_CONFIDENCE
     * RAISES confidence wherever `top1.score < 0.78`.
     *
     * 0.67551 is not a hypothetical. Measured 2026-08-05 over the box's 111
     * `mapping-analysis-*.json`: of 295 `basic_produce_bypass` decisions, 6 were
     * written at exactly 0.67551 — every one of them
     * `grilled chicken with brown rice and steamed broccoli` resolving to
     * fdc_174567 "cream of chicken dry mix prepared with water soup". That value
     * is BELOW SUB_THRESHOLD_SAVE_FLOOR (0.75), so those decisions are not
     * cacheable at all today, and a flat 0.78 would make them cacheable. That is
     * the entire justification for the cap.
     *
     * IT IS NOT A BADGE CHANGE, and an earlier version of this comment claimed it
     * was. Mobile `CONFIDENCE_LEVELS.medium.min` is 0.5 and `getConfidenceLevel()`
     * compares with `>=`, so 0.67551 already renders medium "Good Estimate" —
     * the same tier as 0.78. Verified in the mobile repo's
     * `src/constants/nutrition.ts` 2026-08-05. The claim was false under this
     * repo's own mapping too (`confidence >= 0.6 ? 'medium'` yields medium for
     * both). It mattered because the doc-check claim carrying the same sentence
     * does not test the badge assertion, so the nightly would have reported it
     * green indefinitely — CLAUDE.md doc rules 1 and 2.
     *
     * MUTATION PROOF: delete the `Math.min(RERANK_DECLINED_CONFIDENCE, …)`
     * wrapper in `confidenceGate()` — i.e. return the bare constant — and this
     * test fails with `Expected: 0.6755 Received: 0.78`.
     */
    test('T4b caps a low raw score instead of raising it to the constant', () => {
        const candidates = [
            mockCandidate('Cream Of Chicken Dry Mix Prepared With Water Soup', 0.6755),
            mockCandidate('Broccoli, raw', 0.4),
        ];
        const result = confidenceGate('grilled chicken with brown rice and steamed broccoli', candidates);

        expect(result.reason).toBe('basic_produce_bypass');
        // The whole point: a below-constant score passes through UNCHANGED.
        expect(result.confidence).toBe(0.6755);
        expect(result.confidence).not.toBe(RERANK_DECLINED_CONFIDENCE);
        // …and it stays below the save floor, so it remains uncacheable.
        expect(result.confidence).toBeLessThan(SUB_THRESHOLD_SAVE_FLOOR);
    });

    test('T4c the exit is monotone-downward for every score it can be handed', () => {
        // Property form of T4b: min(0.78, clamp(x)) <= clamp(x) for all x, so
        // this edit cannot raise ANY decision's confidence. Spans the clamp's
        // own edges (negative, >1) as well as the 0.78 crossover.
        for (const score of [-3, 0, 0.4, 0.6755, 0.7499, 0.78, 0.81, 1, 6.9, 12]) {
            const clamped = Math.max(0, Math.min(1, score));
            const result = confidenceGate('broccoli', [mockCandidate('Broccoli, raw', score)]);
            expect(result.reason).toBe('basic_produce_bypass');
            expect(result.confidence).toBeLessThanOrEqual(clamped);
            expect(result.confidence).toBeLessThanOrEqual(RERANK_DECLINED_CONFIDENCE);
            expect(result.confidence).toBeGreaterThanOrEqual(0);
        }
    });

    test('T5 high_confidence_clear_winner is untouched', () => {
        // Pins that this edit did not collapse all three gate exits onto one
        // number: this exit returns assessConfidence()'s real value, which for
        // an exact match is 1.0.
        const candidates = [
            mockCandidate('Cheddar Cheese', 0.95),
            mockCandidate('Swiss Cheese', 0.90),
        ];
        const result = confidenceGate('cheddar cheese', candidates);

        expect(result.reason).toBe('high_confidence_clear_winner');
        expect(result.confidence).toBe(assessConfidence('cheddar cheese', candidates[0]));
        expect(result.confidence).not.toBe(RERANK_DECLINED_CONFIDENCE);
    });
});
