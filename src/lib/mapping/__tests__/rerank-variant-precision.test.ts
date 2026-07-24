/**
 * Same-brand variant precision + branded-match confidence calibration.
 *
 * Covers the restaurant/QSR defects where the exact record is retrieved at top
 * score but the reranker mis-selects a sibling variant, or the correct branded
 * record lands just under the 0.85 cache gate:
 *   - extra-qualifier penalty (QPC vs "Double" QPC)
 *   - explicit size honoring (medium ≠ small)
 *   - explicit count honoring (10 piece ≠ 6 piece)
 *   - branded-exact-match confidence calibration (clears 0.85)
 *   - calibration abstains on ambiguous / specialty picks (safety)
 *
 * These scenarios reproduce the real retrieval evidence: the rerank `query`
 * argument has size/count/brand stripped by upstream normalization, while the
 * raw line (4th arg) still carries them — which is exactly why the fix reads the
 * raw line.
 */

import { simpleRerank, type RerankCandidate } from '../simple-rerank';

function fs(id: string, name: string, brandName: string, score: number): RerankCandidate {
    return { id, name, brandName, score, source: 'fatsecret' };
}
function off(id: string, name: string, brandName: string, score: number): RerankCandidate {
    return { id, name, brandName, score, source: 'openfoodfacts' };
}

describe('same-brand variant precision', () => {
    it('penalizes an un-requested "Double" qualifier: QPC beats Double QPC', () => {
        const candidates: RerankCandidate[] = [
            fs('qpc', 'Quarter Pounder with Cheese', "McDonald's", 1.425),
            fs('dqpc', 'Double Quarter Pounder with Cheese', "McDonald's", 1.335),
            fs('deluxe', 'Quarter Pounder with Cheese Deluxe', "McDonald's", 1.395),
        ];
        const r = simpleRerank(
            'mcdonalds quarter pounder with cheese',
            candidates,
            undefined,
            'mcdonalds quarter pounder with cheese',
            true,
            'mcdonalds',
        );
        expect(r.winner).not.toBeNull();
        expect(r.winner!.name).toBe('Quarter Pounder with Cheese');
    });

    it('honors an explicit size from the raw line when the rerank query dropped it (medium ≠ small)', () => {
        // rerank query has "medium" stripped; raw line retains it.
        const candidates: RerankCandidate[] = [
            off('sm', "Arby's, Curly Fries, Small", "Arby's", 2.8),
            off('md', "Arby's, Curly Fries, Medium", "Arby's", 2.8),
            off('lg', "Arby's, Curly Fries, Large", "Arby's", 2.8),
        ];
        const r = simpleRerank(
            'arbys curly fries',
            candidates,
            undefined,
            'arbys curly fries medium',
            true,
            'arbys',
        );
        expect(r.winner).not.toBeNull();
        expect(r.winner!.name).toBe("Arby's, Curly Fries, Medium");
    });

    it('honors an explicit piece-count from the raw line (10 piece ≠ 6 piece)', () => {
        const candidates: RerankCandidate[] = [
            off('w6', "Wendy's, 6 Piece Chicken Nuggets", "Wendy's", 2.8),
            off('w4', "Wendy's, 4 Piece Chicken Nuggets", "Wendy's", 2.75),
            off('w10', "Wendy's, 10 Piece Chicken Nuggets", "Wendy's", 2.75),
        ];
        const r = simpleRerank(
            'wendys chicken nuggets',
            candidates,
            undefined,
            'wendys 10 piece nuggets',
            true,
            'wendys',
        );
        expect(r.winner).not.toBeNull();
        expect(r.winner!.name).toBe("Wendy's, 10 Piece Chicken Nuggets");
    });

    it('does not fire for non-branded queries (no targetBrand, not branded)', () => {
        // "double" qualifier must be ignored when there is no brand context.
        const candidates: RerankCandidate[] = [
            off('a', 'Cheeseburger', '', 2.0),
            off('b', 'Double Cheeseburger', '', 2.0),
        ];
        const r = simpleRerank('double cheeseburger', candidates, undefined, 'double cheeseburger', false, undefined);
        // With no brand gate, the variant penalty is inactive — "double" is in the
        // query anyway, so the double record is a legitimate winner (not demoted).
        expect(r.winner).not.toBeNull();
        expect(r.winner!.name).toBe('Double Cheeseburger');
    });
});

describe('branded-match confidence calibration', () => {
    it('lifts a clean same-brand exact match over the 0.85 cache gate', () => {
        const candidates: RerankCandidate[] = [
            off('g', 'Chipotle, Guacamole', 'Chipotle', 7.9),
            off('gk', 'Chipotle, Guacamole, Kids', 'Chipotle', 7.85),
        ];
        const r = simpleRerank(
            'guacamole',           // brand stripped from rerank query
            candidates,
            undefined,
            'chipotle guacamole',  // raw line retains the brand
            true,
            'chipotle',
        );
        expect(r.winner).not.toBeNull();
        expect(r.winner!.name).toBe('Chipotle, Guacamole');
        expect(r.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('abstains on a specialty pick that adds a descriptor beyond the query (no lift)', () => {
        // "cheese pizza" but only specialty "Wisconsin 6 Cheese" variants exist —
        // the winner adds "wisconsin", so calibration must NOT lift it.
        const candidates: RerankCandidate[] = [
            fs('sm', 'Wisconsin 6 Cheese Pizza - Hand Tossed - Small', "Domino's Pizza", 1.116),
            fs('md', 'Wisconsin 6 Cheese Pizza - Hand Tossed - Medium', "Domino's Pizza", 1.14),
            fs('lg', 'Wisconsin 6 Cheese Pizza - Hand Tossed - Large', "Domino's Pizza", 1.092),
        ];
        const r = simpleRerank(
            'dominos cheese pizza',
            candidates,
            undefined,
            'dominos cheese pizza medium slice',
            true,
            'dominos',
        );
        expect(r.winner).not.toBeNull();
        // Size is still honored (medium wins its pool)...
        expect(r.winner!.name).toBe('Wisconsin 6 Cheese Pizza - Hand Tossed - Medium');
        // ...but confidence is NOT lifted to the branded-exact tier.
        expect(r.confidence).toBeLessThan(0.85);
    });

    it('does not calibrate up when the winner carries an un-requested extra qualifier', () => {
        // Only "Double …" SKUs exist for a plain query → the winner adds the
        // un-requested "double" qualifier, so calibration must abstain (the
        // branded-exact tier is reserved for tight matches only).
        const candidates: RerankCandidate[] = [
            fs('d', 'Double Quarter Pounder with Cheese', "McDonald's", 1.4),
            fs('dm', 'Double Quarter Pounder with Cheese Meal', "McDonald's", 1.38),
        ];
        const r = simpleRerank(
            'mcdonalds quarter pounder with cheese',
            candidates,
            undefined,
            'mcdonalds quarter pounder with cheese',
            true,
            'mcdonalds',
        );
        // Either rejected outright (below the min-confidence gate) or kept below
        // the cache gate — never calibrated into the branded-exact tier.
        expect(r.reason).not.toBe('branded_exact_match');
        expect(r.confidence).toBeLessThan(0.85);
    });
});
