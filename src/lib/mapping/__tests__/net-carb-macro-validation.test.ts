/**
 * D21b — hasNullOrInvalidMacros charges the macro/calorie consistency check on
 * NET carbs.
 *
 * The defect: a US label reports TOTAL carbohydrate with fibre inside it, and
 * fibre yields ~0-2 kcal/g rather than 4. Charging the whole carb figure at
 * 4 kcal/g over-computes exactly the labels that lead with fibre, and this
 * check then reads them as corrupt and DELETES them before ranking —
 * filterCandidatesByTokens calls it unconditionally, so no ranking change can
 * reach them. Measured 2026-08-28: 477 retrieval-eligible OffFood rows, 367 of
 * them carrying fibre >= 10 g/100 g. Owner: mobile
 * sync-docs/reports/2026-08-28_batch6-one-write-and-seven-holds.md §2c.
 */
import { hasNullOrInvalidMacros, filterCandidatesByTokens } from '../filter-candidates';
import type { UnifiedCandidate } from '../gather-candidates';

// off_0856711006509 "Inked Keto Sourdough" [Inked Keto], stored floats.
// 4(14.8) + 4(40.7) + 9(3.7) = 255.3 against a 2 x 111 = 222 ceiling -> was
// rejected. On net carbs (40.7 - 37 = 3.7) it computes 107.3 -> admitted.
const INKED_KETO_SOURDOUGH = {
    calories: 111,
    protein: 14.8,
    carbs: 40.7,
    fat: 3.7,
    fiber: 37,
};

describe('hasNullOrInvalidMacros — the fibre in a total-carbohydrate label', () => {
    it('admits a high-fibre label that total-carb Atwater called corrupt', () => {
        expect(hasNullOrInvalidMacros(INKED_KETO_SOURDOUGH, 'Inked Keto Sourdough')).toBe(false);
    });

    it('would still reject it if the fibre were dropped — the field is load-bearing', () => {
        const { fiber, ...withoutFibre } = INKED_KETO_SOURDOUGH;
        expect(hasNullOrInvalidMacros(withoutFibre, 'Inked Keto Sourdough')).toBe(true);
    });

    it('still rejects a genuinely inconsistent panel that has no fibre to spend', () => {
        // The GOLCHIN Jalapeno shape this check was written for: 53.6 g carbs
        // = 214 kcal computed against 21 kcal reported.
        expect(hasNullOrInvalidMacros({ calories: 21, protein: 0, carbs: 53.6, fat: 0 }, 'Jalapeno')).toBe(true);
    });

    it('still rejects when the fibre is real but far too small to explain the gap', () => {
        expect(hasNullOrInvalidMacros({ calories: 21, protein: 0, carbs: 53.6, fat: 0, fiber: 2 }, 'Jalapeno')).toBe(true);
    });

    it('does NOT relax when fibre EXCEEDS carbs — that is a different defect', () => {
        // Physically impossible (10,053 corpus rows, 1.22%, queued separately).
        // Clamping net carbs at 0 would hand the largest possible relaxation to
        // the least trustworthy label, so the check falls back to total carbs.
        expect(hasNullOrInvalidMacros({ calories: 10, protein: 0, carbs: 30, fat: 0, fiber: 60 }, 'Impossible')).toBe(true);
    });

    it('relaxes at the boundary where fibre equals carbs', () => {
        expect(hasNullOrInvalidMacros({ calories: 10, protein: 0, carbs: 30, fat: 0, fiber: 30 }, 'All fibre')).toBe(false);
    });

    it('applies to the reported-zero-calories branch too', () => {
        // 91 g carbs of which 89 g fibre: 8 kcal net, under the 10 kcal floor.
        expect(hasNullOrInvalidMacros({ calories: 0, protein: 0, carbs: 91, fat: 0, fiber: 89 }, 'Psyllium husk')).toBe(false);
        // The CRUSHED RED PEPPER CENTO shape (0 kcal, 91 g carbs, no fibre) is
        // untouched.
        expect(hasNullOrInvalidMacros({ calories: 0, protein: 0, carbs: 91, fat: 0 }, 'Crushed Red Pepper')).toBe(true);
    });

    it('is unchanged when the panel carries no fibre field at all', () => {
        expect(hasNullOrInvalidMacros({ calories: 250, protein: 10, carbs: 50, fat: 3 }, 'Bread')).toBe(false);
        expect(hasNullOrInvalidMacros(null)).toBe(false);
    });
});

describe('the filterCandidatesByTokens call site actually carries the fibre', () => {
    // UnifiedCandidate.nutrition holds only kcal/protein/carbs/fat, so a
    // candidate that arrives with a per-100g nutrition block would reach the
    // check with fibre undefined and the rule above would be dead on it.
    // Widening that shape means editing gather-candidates.ts, which is
    // RETRIEVAL_PATHS; the call site reads fibre off rawData instead.
    function cand(over: Partial<UnifiedCandidate>): UnifiedCandidate {
        return {
            id: 'c1',
            source: 'openfoodfacts',
            name: 'Inked Keto Sourdough',
            brandName: 'Inked Keto',
            score: 1,
            rawData: null,
            ...(over as any),
        } as UnifiedCandidate;
    }

    it('keeps the high-fibre bread when fibre lives only on rawData', () => {
        const c = cand({
            nutrition: { per100g: true, kcal: 111, protein: 14.8, carbs: 40.7, fat: 3.7 } as any,
            rawData: { nutrientsPer100g: { ...INKED_KETO_SOURDOUGH } },
        });
        const { filtered } = filterCandidatesByTokens([c], 'inked keto sourdough', {
            rawLine: 'inked keto sourdough',
        });
        expect(filtered.length).toBe(1);
    });

    it('drops it when rawData carries no fibre — proving the fibre is what saved it', () => {
        const { fiber, ...withoutFibre } = INKED_KETO_SOURDOUGH;
        const c = cand({
            nutrition: { per100g: true, kcal: 111, protein: 14.8, carbs: 40.7, fat: 3.7 } as any,
            rawData: { nutrientsPer100g: { ...withoutFibre } },
        });
        const { filtered } = filterCandidatesByTokens([c], 'inked keto sourdough', {
            rawLine: 'inked keto sourdough',
        });
        expect(filtered.length).toBe(0);
    });
});
