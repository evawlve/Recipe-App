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
    extractLabelServingUnit,
    labelLeadingCount,
    labelLeadingQuantity,
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

    it('qty gate: a qty=1 line is not a piece count (the parser defaults bare lines to 1)', () => {
        // An explicit "1 tortilla chip" and a parser-default bare line
        // ("goldfish crackers", "kirkland protein bar chocolate chip") both
        // arrive here as qty=1 — indistinguishable, so neither may read as a
        // counted-piece query; the label side (labelLeadingCount) already
        // demands count >= 2. MUTATION: restore `qty < 1` — all three return
        // a noun again and the count_label cache escape re-opens on every
        // bare/qty-1 snack line (measured looping at up to 271 events/form).
        expect(countedPieceNoun({ qty: 1, multiplier: 1, unit: null, name: 'tortilla chip' } as any)).toBeNull();
        expect(countedPieceNoun({ qty: 1, multiplier: 1, unit: null, name: 'goldfish crackers' } as any)).toBeNull();
        expect(countedPieceNoun({ qty: 1, multiplier: 1, unit: null, name: 'kirkland protein bar chocolate chip' } as any)).toBeNull();
    });

    it('qty >= 2 keeps the count reading, re-aimed at the head noun', () => {
        expect(countedPieceNoun({ qty: 2, multiplier: 1, unit: null, name: 'chocolate chip cookie' } as any)).toBe('cookie');
        // 'kirkland protein bar chocolate chip' has exactly ONE member noun
        // ('bar' is deliberately not in LABEL_COUNT_PIECE_NOUNS), so no noun
        // rule can re-aim it — the QTY gate, not last-match, is what silences
        // its bare-line escape. At an explicit count it still counts 'chip'.
        expect(countedPieceNoun({ qty: 2, multiplier: 1, unit: null, name: 'kirkland protein bar chocolate chip' } as any)).toBe('chip');
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
    it('finds the LAST snack noun, singularized (flavor precedes the head in compounds)', () => {
        expect(pieceNounInName('chicken nuggets')).toBe('nugget');
        expect(pieceNounInName('almonds')).toBeNull();
        // Multi-noun names: the head noun wins, not the flavor modifier.
        // MUTATION: restore first-match — both flip back to 'chip'.
        expect(pieceNounInName('chocolate chip cookie')).toBe('cookie');
        expect(pieceNounInName('quest bar chocolate chip cookie dough')).toBe('cookie');
        // Pre-existing -ies quirk, deliberately unchanged: singularizeUnit
        // maps 'cookies' -> 'cooky', which misses the set, so the PLURAL
        // spelling contributes no cookie match under either scan and 'chip'
        // is the last member either way.
        expect(pieceNounInName('chocolate chip cookies')).toBe('chip');
    });
});

// ============================================================
// The leading quantity of a label serving (fraction fix, 2026-08-18)
// ============================================================

describe('extractLabelServingUnit', () => {
    it('reads the unit past a leading FRACTION', () => {
        // The defect. `^\\s*\\d*\\.?\\d*\\s*([a-z]+)` consumed the `1`, then `/`
        // is not `[a-z]`, so every fraction-led label read as "no unit at all"
        // — 16,350 OffFood rows and 2,389 FatSecretServing rows (measured on
        // the box 2026-08-18 by running this code over both corpora).
        expect(extractLabelServingUnit('1/2 cup (110 g)')).toBe('cup');
        expect(extractLabelServingUnit('1/4 cup (37 g)')).toBe('cup');
        expect(extractLabelServingUnit('2/3 cup (100 g)')).toBe('cup');
        expect(extractLabelServingUnit('3/4 tsp (2.5 g)')).toBe('tsp');
        expect(extractLabelServingUnit('1/2 Cup (100g)')).toBe('cup');
        expect(extractLabelServingUnit('1/12 package (50 g mix)')).toBe('package');
    });

    it('reads the unit past a leading MIXED NUMBER whose whole part is 1', () => {
        expect(extractLabelServingUnit('1 1/4 cup (40 g)')).toBe('cup');
        expect(extractLabelServingUnit('1 1/2 Tbsp (23 g)')).toBe('tbsp');
        expect(extractLabelServingUnit('1 1/3 cookie (28 g)')).toBe('cookie');
    });

    it('a mixed number with a LARGER whole part stays unreadable — it is a weight, not a count', () => {
        // The guard, and the only thing between this PR and a 320x under-bill.
        // `label_unit_match` sits AHEAD of `label_serving_package_unit`, so a
        // unit word that did not exist before pre-empts a branch that was
        // already right: `1 package` of 0761898375006 would go 320 g -> 1 g.
        // MUTATION: relax the `1\s+` to `\d+\s+` and every line below returns
        // a word, all four of them wrong.
        expect(extractLabelServingUnit('320 1/2 package (320 g)')).toBeNull();
        expect(extractLabelServingUnit('30 1/3 Can (30 g)')).toBeNull();
        expect(extractLabelServingUnit('162 1/3 Pizza (162 g)')).toBeNull();
        expect(extractLabelServingUnit('4 1/4 fillet (113 g)')).toBeNull();   // 4.25 OUNCES
        expect(extractLabelServingUnit('2 1/2 cup (85 g)')).toBeNull();
    });

    it('whitespace inside the fraction stays unreadable to BOTH halves', () => {
        // "1 /3 cup" would parse as a unit while `parseQuantityTokens` cannot
        // read ["1","/","3"] and falls back to 1 — the unit and the count
        // disagreeing about the quantity, which is this module's own defect.
        // Refused in one place, so neither half can see it. 21 OFF rows.
        expect(extractLabelServingUnit('1 /3 cup (151 g)')).toBeNull();
        expect(labelLeadingQuantity('1 /3 cup (151 g)')).toBe(1);
        // Degenerate fractions are refused by the pattern, not by the qty
        // guard, so both halves fall back together.
        expect(extractLabelServingUnit('0/2 cup (100 g)')).toBeNull();
        expect(extractLabelServingUnit('1/0 cup (100 g)')).toBeNull();
        expect(labelLeadingQuantity('0/2 cup (100 g)')).toBeNull();
    });

    it('every shape the old regex matched still returns the SAME word', () => {
        // The fraction arm only ever fires where the old pattern matched
        // nothing: measured over all 1,085,526 OffFood rows and all 55,004
        // FatSecretServing rows, ZERO records change from one word to a
        // different word and ZERO lose a word they had. These pin the fallback
        // that carries that property.
        expect(extractLabelServingUnit('2 scoops (46g)')).toBe('scoop');
        expect(extractLabelServingUnit('1 container (170g)')).toBe('container');
        expect(extractLabelServingUnit('18 chips (28g)')).toBe('chip');
        expect(extractLabelServingUnit('cup')).toBe('cup');
        expect(extractLabelServingUnit('0.5 cup')).toBe('cup');
        // Digits glued to the unit: `100.0g` must keep reading `g`, or the
        // per-100g placeholder rule in usableBareLabelServing stops firing.
        expect(extractLabelServingUnit('100 g')).toBe('g');
        expect(extractLabelServingUnit('100.0g')).toBe('g');
        expect(extractLabelServingUnit('1 portion (100 g)')).toBe('portion');
        expect(extractLabelServingUnit(null)).toBeNull();
        expect(extractLabelServingUnit('(28 g)')).toBeNull();
    });

    it('hyphen shapes stay unreadable, exactly as before', () => {
        // "1-1/4 cup" is a hyphen-written mixed number and "2-3 Tbsp" a genuine
        // range; both returned null before and still do. 405 OffFood rows lead
        // with a hyphen — named, deliberately not fixed here, because the two
        // shapes are not separable without a rule nobody has measured.
        expect(extractLabelServingUnit('1-1/4 cup (85 g)')).toBeNull();
        expect(extractLabelServingUnit('2-3 Tbsp (35 g)')).toBeNull();
    });
});

describe('labelLeadingQuantity', () => {
    it('parses fractions, mixed numbers, integers and decimals', () => {
        expect(labelLeadingQuantity('1/2 cup (110 g)')).toBe(0.5);
        expect(labelLeadingQuantity('1/12 package (50 g mix)')).toBeCloseTo(1 / 12, 12);
        expect(labelLeadingQuantity('1 1/4 cup (40 g)')).toBe(1.25);
        expect(labelLeadingQuantity('320 1/2 package (320 g)')).toBe(320);   // the leading integer, as before
        expect(labelLeadingQuantity('18 chips (28 g)')).toBe(18);
        expect(labelLeadingQuantity('2.5 oz')).toBe(2.5);
    });

    it('returns null when the label does not LEAD with a digit', () => {
        expect(labelLeadingQuantity('cup')).toBeNull();
        expect(labelLeadingQuantity('One Slice (50g)')).toBeNull();
        expect(labelLeadingQuantity('a dozen cookies')).toBeNull();
        expect(labelLeadingQuantity('')).toBeNull();
        expect(labelLeadingQuantity(null)).toBeNull();
    });

    it('refuses hyphen shapes to the plain leading number', () => {
        // parseQuantityTokens averages a range ("2-3" -> 2.5). A hyphen is
        // neither a slash nor whitespace, so no fraction arm can start and the
        // caller keeps reading the first number, unchanged. 405 OFF rows.
        expect(labelLeadingQuantity('2-3 Tbsp (35 g)')).toBe(2);
        expect(labelLeadingQuantity('1-1/4 cup (85 g)')).toBe(1);
        // A CONTINUING numeric run is what the lookahead refuses, so a
        // malformed shape falls back whole rather than half-parsed.
        expect(labelLeadingQuantity('1/2/3 cup')).toBe(1);
        expect(labelLeadingQuantity('3//4 cup')).toBe(3);
    });
});

describe('labelLeadingCount is NOT the fraction reader (and stays integer-only)', () => {
    it('still returns null for every fractional shape', () => {
        // build-fatsecret-result.ts:240-245 records why it cannot be reused:
        // integer-only, and null below 2. That is load-bearing for
        // servingLabelCountsPiece / servingLabelHasPieceCount, and it is ALSO
        // where this PR's one regression came from — see the third guard below.
        expect(labelLeadingCount('1/2 cup (110 g)')).toBeNull();
        expect(labelLeadingCount('1 1/3 cookie (28 g)')).toBeNull();   // leading int is 1, < 2
        expect(labelLeadingCount('1 container')).toBeNull();
        expect(labelLeadingCount('15 pieces (28 g)')).toBe(15);
        expect(labelLeadingCount('2 1/2 Cookie (114 g)')).toBe(2);
        // A NUMERATOR IS NOT A COUNT. Integer-only does not save a label whose
        // fraction LEADS with an integer >= 2, and this is the one shape where
        // the two halves could still disagree about where the quantity ends.
        expect(labelLeadingCount('2/3 spear')).toBe(2);
        expect(labelLeadingCount('3/4 cup (54 g)')).toBe(3);
    });

    it('the RETRIEVAL flag is unmoved corpus-wide; the NOUN predicate was not, and is refused', () => {
        // Two predicates, two different answers, and conflating them is what
        // hid the regression. `servingLabelHasPieceCount` is noun-agnostic and
        // demands the label word be a recognized PIECE word, so a fraction-led
        // label can only reach it as "2/3 cookie"-shaped — measured over all
        // 1,085,526 OffFood and all 55,004 FatSecretServing rows, ZERO rows
        // change its verdict under this PR, so the Typesense `hasCountServing`
        // index needs no rebuild.
        expect(servingLabelHasPieceCount('1/4 pretzel (59 g)', 59)).toBe(false);
        expect(servingLabelHasPieceCount('1 1/3 cookie (28 g)', 28)).toBe(false);
        expect(servingLabelHasPieceCount('2 1/2 Cookie (114 g)', 114)).toBe(false);
        // `servingLabelCountsPiece` takes the noun from the REQUEST, so any
        // label word can match it, and there the new reading DID move rows:
        // 403 FatSecretServing rows and 3,381 OffFood rows flipped true, 0
        // flipped the other way (box, 2026-08-19). The third guard returns
        // every one of them. `1/4 pretzel` was already false — numerator 1 —
        // which is exactly why the numerator-2 shapes went unnoticed.
        expect(servingLabelCountsPiece('1/4 pretzel (59 g)', 59, 'pretzel')).toBe(false);
        expect(servingLabelCountsPiece('2/3 spear', 28, 'spear')).toBe(false);
        expect(servingLabelCountsPiece('3/4 serving', 5, 'serving')).toBe(false);
        expect(servingLabelCountsPiece('2/3 cup (100 g)', 100, 'cup')).toBe(false);
        // MUTATION: drop the `leadingLabelFraction` refusal and the three above
        // return true, billing 28/2 = 14 g for a spear the label calls 42 g.
        // The plain-integer class the predicate exists for is untouched.
        expect(servingLabelCountsPiece('14 chips (28 g)', 28, 'chip')).toBe(true);
        expect(servingLabelCountsPiece('15 pieces (28 g)', 28, 'pretzel')).toBe(true);
    });
});
