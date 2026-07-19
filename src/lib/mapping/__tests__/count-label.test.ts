/**
 * Unit tests for count-label helpers (Cluster A pt2, Jul 2026)
 *
 * These predicates decide when a product's own label piece-count
 * ("14 chips (28g)", "15 pieces (28g)") is authoritative for a counted-piece
 * query, powering serving resolution, rerank preference, the cache escape,
 * and the Typesense hasCountServing retrieval flag.
 */

import {
    countedPieceNoun,
    pieceNounInName,
    servingLabelCountsPiece,
    servingLabelHasPieceCount,
} from '../count-label';

describe('countedPieceNoun', () => {
    it('extracts the counted snack noun from a unitless integer count', () => {
        expect(countedPieceNoun({ qty: 13, multiplier: 1, unit: null, name: 'tortilla chips' } as any)).toBe('chip');
        expect(countedPieceNoun({ qty: 10, multiplier: 1, unit: null, name: 'pretzels' } as any)).toBe('pretzel');
    });

    it('returns null when a unit is present or qty is fractional', () => {
        expect(countedPieceNoun({ qty: 2, multiplier: 1, unit: 'cup', name: 'pretzels' } as any)).toBeNull();
        expect(countedPieceNoun({ qty: 1.5, multiplier: 1, unit: null, name: 'cookies' } as any)).toBeNull();
    });

    it('returns null for non-snack nouns (produce stays on the seed table)', () => {
        expect(countedPieceNoun({ qty: 3, multiplier: 1, unit: null, name: 'baby carrots' } as any)).toBeNull();
        expect(countedPieceNoun({ qty: 2, multiplier: 1, unit: null, name: 'bananas' } as any)).toBeNull();
    });
});

describe('servingLabelCountsPiece', () => {
    it('accepts an exact-noun multi-piece label', () => {
        expect(servingLabelCountsPiece('14 chips (28 g)', 28, 'chip')).toBe(true);
        expect(servingLabelCountsPiece('18 chips (28g)', 28, 'chip')).toBe(true);
    });

    it('accepts the generic "pieces" counter for any counted snack noun', () => {
        expect(servingLabelCountsPiece('15 pieces (28 g)', 28, 'pretzel')).toBe(true);
        expect(servingLabelCountsPiece('15 pieces (28 g)', 28, 'chip')).toBe(true);
    });

    it('rejects single-piece labels — a "1 piece (57g)" whole-bar serving is not a per-piece weight', () => {
        expect(servingLabelCountsPiece('1 piece (57g)', 57, 'cookie')).toBe(false);
    });

    it('rejects labels whose word is neither the noun nor a generic counter', () => {
        expect(servingLabelCountsPiece('2 scoops (46g)', 46, 'chip')).toBe(false);
        expect(servingLabelCountsPiece('28 g', 28, 'chip')).toBe(false);
        expect(servingLabelCountsPiece('14 crackers (30g)', 30, 'chip')).toBe(false);
    });

    it('rejects implausible per-piece weights', () => {
        expect(servingLabelCountsPiece('2 chips (0.2g)', 0.2, 'chip')).toBe(false);
    });
});

describe('servingLabelHasPieceCount (noun-agnostic, retrieval flag)', () => {
    it('true for any recognized piece word with count >= 2', () => {
        expect(servingLabelHasPieceCount('14 chips (28 g)', 28)).toBe(true);
        expect(servingLabelHasPieceCount('15 pieces (28 g)', 28)).toBe(true);
        expect(servingLabelHasPieceCount('5 crackers (15g)', 15)).toBe(true);
    });

    it('false for weight-only, single-piece, and non-piece labels', () => {
        expect(servingLabelHasPieceCount('28 g', 28)).toBe(false);
        expect(servingLabelHasPieceCount('1 piece (57g)', 57)).toBe(false);
        expect(servingLabelHasPieceCount('2 scoops (46g)', 46)).toBe(false);
        expect(servingLabelHasPieceCount(null, 28)).toBe(false);
        expect(servingLabelHasPieceCount('15 pieces (28 g)', null)).toBe(false);
    });
});

describe('pieceNounInName', () => {
    it('finds the first snack noun, singularized', () => {
        expect(pieceNounInName('chocolate chip cookies')).toBe('chip');
        expect(pieceNounInName('chicken nuggets')).toBe('nugget');
        expect(pieceNounInName('almonds')).toBeNull();
    });
});
