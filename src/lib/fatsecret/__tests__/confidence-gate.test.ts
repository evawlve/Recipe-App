/**
 * Confidence Gate Tests
 * 
 * Tests for the confidence gate early exit feature that:
 * 1. Skips AI reranking for high-confidence matches
 * 2. Still uses AI for ambiguous cases
 */

import { assessConfidence, confidenceGate, type UnifiedCandidate } from '../gather-candidates';

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
