import {
    queryTargetsCandidateBrand,
    hasSuspiciousMacros,
    filterCandidatesByTokens,
    isMealProductMismatch,
} from '../filter-candidates';
import type { UnifiedCandidate } from '../gather-candidates';

let _id = 0;
function cand(partial: Partial<UnifiedCandidate>): UnifiedCandidate {
    return {
        id: `c${_id++}`,
        source: 'fatsecret',
        name: 'x',
        brandName: null,
        score: 1,
        rawData: null,
        ...(partial as any),
    } as UnifiedCandidate;
}

describe('queryTargetsCandidateBrand — possessive/punctuation insensitive', () => {
    it('matches "arbys" query to "Arby\'s" brand (the apostrophe bug)', () => {
        expect(queryTargetsCandidateBrand('arbys curly fries', "Arby's")).toBe(true);
    });
    it('matches "mcdonalds" query to "McDonald\'s" brand', () => {
        expect(queryTargetsCandidateBrand('mcdonalds chicken nuggets', "McDonald's")).toBe(true);
    });
    it('matches multi-word brand "olive garden"', () => {
        expect(queryTargetsCandidateBrand('olive garden breadsticks', 'Olive Garden')).toBe(true);
    });
    it('matches "starbucks" one-token brand', () => {
        expect(queryTargetsCandidateBrand('starbucks spinach feta wrap', 'Starbucks')).toBe(true);
    });
    it('does NOT match when query omits the brand', () => {
        expect(queryTargetsCandidateBrand('chicken nuggets', "Tyson")).toBe(false);
        expect(queryTargetsCandidateBrand('curly fries', "Arby's")).toBe(false);
    });
    it('does NOT treat a bare generic word as a brand match', () => {
        expect(queryTargetsCandidateBrand('original potato chips', 'Original')).toBe(false);
        expect(queryTargetsCandidateBrand('classic marinara', 'Classic')).toBe(false);
    });
    it('null / empty brand is never a match', () => {
        expect(queryTargetsCandidateBrand('anything', null)).toBe(false);
        expect(queryTargetsCandidateBrand('anything', '')).toBe(false);
    });
});

describe('hasSuspiciousMacros ignoreCeilings — ceilings drop, floors stay', () => {
    it('ignoreCeilings lets a calorie-dense branded product past a produce ceiling', () => {
        // "strawberry" produce profile caps ~60 kcal/100g; a Frosted Strawberry
        // Pop-Tart is ~390. Default = suspicious; ignoreCeilings = allowed.
        const poptart = { calories: 390, protein: 4, carbs: 70, fat: 9 };
        expect(hasSuspiciousMacros('pop-tarts frosted strawberry', poptart)).toBe(true);
        expect(hasSuspiciousMacros('pop-tarts frosted strawberry', poptart, { ignoreCeilings: true })).toBe(false);
    });
    it('ignoreCeilings STILL enforces the protein floor (supplement safety)', () => {
        // "protein" whey profile requires a high min protein; a 12g/100g record
        // must stay suspicious even with ceilings ignored (n-seg-25 protection).
        const lowProtein = { calories: 350, protein: 12, carbs: 55, fat: 8 };
        expect(hasSuspiciousMacros('whey protein', lowProtein, { ignoreCeilings: true })).toBe(true);
    });
});

describe('filterCandidatesByTokens — branded restaurant items survive', () => {
    it('keeps "Arby\'s Curly Fries" for "arbys curly fries"', () => {
        const cands = [
            cand({ source: 'fatsecret', name: 'Curly Fries - Large', brandName: "Arby's" }),
            cand({ source: 'fdc', name: 'new zealand imported striploin cooked fast fried beef', brandName: null }),
        ];
        const { filtered } = filterCandidatesByTokens(cands, 'arbys curly fries', {
            rawLine: 'arbys curly fries',
        });
        expect(filtered.some(c => c.brandName === "Arby's")).toBe(true);
    });

    it('keeps the Starbucks wrap despite normal-but-"suspicious" macros', () => {
        const cands = [
            cand({
                source: 'fatsecret',
                name: 'Spinach, Feta & Egg White Wrap',
                brandName: 'Starbucks',
                nutrition: { per100g: true, kcal: 182, protein: 12.58, fat: 5.03, carbs: 21.38 } as any,
            }),
        ];
        const { filtered } = filterCandidatesByTokens(cands, 'starbucks spinach feta wrap', {
            rawLine: 'starbucks spinach feta wrap',
        });
        expect(filtered.length).toBe(1);
    });

    // ------------------------------------------------------------------
    // RE-DECIDED 2026-08-28 (D21a). This block used to assert the OPPOSITE of
    // its first case: "cinnamon sticks" must NOT reach "Cinnamon Sticks
    // (DiGiorno)" because the query does not name DiGiorno. That behaviour was
    // isMealProductMismatch's RESTAURANT_BRANDS branch, and it is now deleted.
    //
    // The old expectation is REVERSED deliberately, not edited to make a build
    // pass. The A26(i) census froze the pre-filter pool over 449 queries and
    // graded 256 fired pairs blind: the branch carried 8% of the guard's firing
    // volume at 71.4% losses on chain queries [45.4, 88.3], and deleting it
    // measured 10 FIXED / 4 BROKEN (2.50 : 1) — better than every arm that tried
    // to narrow it instead. THIS CASE IS ONE OF THE 4 BROKEN, which is why the
    // pin is kept and inverted rather than dropped. The decisive cell is n=14:
    // the direction is safe, the magnitude is soft, and no larger sample exists.
    // Owner: mobile sync-docs/reports/2026-08-28_a26i-the-meal-product-guard-census.md.
    // ------------------------------------------------------------------
    it('no longer rejects on the candidate BRAND alone (D21a: branch 2 deleted)', () => {
        expect(isMealProductMismatch('cinnamon sticks', 'Cinnamon Sticks')).toBe(false);
    });

    it('takes no brand argument at all, so the branch cannot be re-added quietly', () => {
        expect(isMealProductMismatch.length).toBe(2);
    });

    it('still rejects an extraneous MEAL word — branch 1 is untouched', () => {
        // Branch 1 is 1,193 of the guard's 1,293 fires (92%) at 15.1% losses, and
        // every relaxation of it the census tested breaks far more than it fixes.
        expect(isMealProductMismatch('orange zest', 'ORANGE ZEST CHICKEN')).toBe(true);
        expect(isMealProductMismatch('yellow zucchini', 'Zucchini Lasagna')).toBe(true);
        expect(isMealProductMismatch('cinnamon sticks', 'Cinnamon Sticks Pizza')).toBe(true);
        expect(isMealProductMismatch('starbucks pike place roast', 'Beef Tri-Tip Roast')).toBe(true);
    });

    it('does NOT fix the branch-1 chain losses, which are a different item', () => {
        // Named in the census's loss list and easy to misattribute to this
        // change: both are dropped for an extraneous MEAL WORD, not for a brand,
        // so deleting branch 2 leaves them exactly where they were.
        expect(isMealProductMismatch('wingstop classic wings', 'Chicken Wings classic')).toBe(true);
        expect(isMealProductMismatch('popeyes chicken tenders', 'Chicken Patty, Fillet or Tenders')).toBe(true);
    });
});

describe('disqualifier scan ignores the brand name', () => {
    // The UNRELATED_INDICATORS list exists to reject unrelated PRODUCTS ("cadillac"
    // for flaxseed meal). It was being tested against name + brandName, so every
    // chain whose brand contains grill/kitchen/cafe/diner/bistro/restaurant had its
    // whole catalogue rejected: 476 ingested FatSecret records across 66 brands.
    // Observed live before the fix — "qdoba chicken burrito" gathered 8 Qdoba
    // FatSecret records and 0 survived, all on disqualifier "grill".
    const qdoba = [
        'Chicken Queso Burrito', 'Cholula Hot & Sweet Chicken Burrito', 'Quesabirria Burrito',
        'Southwest Steak Burrito', 'Grilled Chicken - Kids', 'Keto Bowl - Chicken',
        'Grilled Adobo Chicken', 'Chicken Queso Bowl',
    ];

    it('keeps Qdoba Mexican Grill records for "qdoba chicken burrito"', () => {
        const cands = qdoba.map(name => cand({
            source: 'fatsecret',
            name,
            brandName: 'Qdoba Mexican Grill',
            nutrition: { per100g: true, kcal: 185, protein: 9.5, fat: 6.2, carbs: 22 } as any,
        }));
        const { filtered } = filterCandidatesByTokens(cands, 'qdoba chicken burrito', {
            rawLine: 'qdoba chicken burrito',
        });
        // The assembled burrito is the record the golden case n-mq-39 needs.
        expect(filtered.map(c => c.name)).toContain('Chicken Queso Burrito');
    });

    it('keeps a venue-brand record when the brand word is only in the brand', () => {
        const cands = [cand({
            source: 'fatsecret',
            name: 'Chipotle Chicken Burrito',
            brandName: 'The Gym Kitchen',
            nutrition: { per100g: true, kcal: 153, protein: 8.4, fat: 3.1, carbs: 22.5 } as any,
        })];
        const { filtered } = filterCandidatesByTokens(cands, 'chipotle chicken burrito', {
            rawLine: 'chipotle chicken burrito',
        });
        expect(filtered.length).toBe(1);
    });

    it('spares an OFF record that bakes a venue brand into the name', () => {
        // OFF stores the brand inside the name, so scanning the name alone would
        // still see "grill" — brand-derived words are skipped explicitly.
        const cands = [cand({
            source: 'openfoodfacts',
            name: 'Qdoba Mexican Grill, Chicken Queso Burrito',
            brandName: 'Qdoba Mexican Grill',
            nutrition: { per100g: true, kcal: 185, protein: 9.5, fat: 6.2, carbs: 22 } as any,
        })];
        const { filtered } = filterCandidatesByTokens(cands, 'qdoba chicken burrito', {
            rawLine: 'qdoba chicken burrito',
        });
        expect(filtered.length).toBe(1);
    });

    it('STILL rejects an unrelated word that is in the product name', () => {
        // The check must keep doing its job when the disqualifier is genuinely part
        // of the product, not the brand — this is the case the list was written for.
        const cands = [cand({
            source: 'openfoodfacts',
            name: 'Cadillac Margarita Mix',
            brandName: 'Jose Cuervo',
            nutrition: { per100g: true, kcal: 120, protein: 0, fat: 0, carbs: 30 } as any,
        })];
        const { filtered } = filterCandidatesByTokens(cands, 'flaxseed meal', {
            rawLine: 'flaxseed meal',
        });
        expect(filtered.length).toBe(0);
    });

    it('STILL rejects a grill APPLIANCE for a food query', () => {
        const cands = [cand({
            source: 'openfoodfacts',
            name: 'George Foreman Grill Cleaning Wipes',
            brandName: 'George Foreman',
            nutrition: { per100g: true, kcal: 0, protein: 0, fat: 0, carbs: 0 } as any,
        })];
        const { filtered } = filterCandidatesByTokens(cands, 'chicken breast', {
            rawLine: 'chicken breast',
        });
        expect(filtered.length).toBe(0);
    });
});
