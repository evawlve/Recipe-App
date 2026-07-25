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

    it('still rejects a restaurant product for a bare raw-ingredient query', () => {
        // "cinnamon sticks" must NOT grab "Cinnamon Sticks (DiGiorno)" — the query
        // does not name DiGiorno, so the meal/product guard still applies.
        expect(isMealProductMismatch('cinnamon sticks', 'Cinnamon Sticks', 'DiGiorno')).toBe(true);
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
