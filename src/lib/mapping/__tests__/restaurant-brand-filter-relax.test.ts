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
