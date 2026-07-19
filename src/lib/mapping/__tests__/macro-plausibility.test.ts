/**
 * Unit tests for the macro plausibility gate (macro-plausibility.ts).
 *
 * Anchored on the two golden-set known issues:
 *   - n-prot-04: "black beans" → OFF row with protein = 0
 *   - n-prod-02: "spinach" → OFF row with 224 kcal/100g
 * Plus Atwater-mismatch detection and negative cases that must NOT be flagged
 * (avocado, dried spinach powder, olive oil, diet soda, alcohol, fiber foods).
 */

import { assessMacroPlausibility, IMPLAUSIBLE_MACRO_PENALTY } from '../macro-plausibility';

describe('assessMacroPlausibility', () => {
    // ============================================================
    // Golden-set known issues
    // ============================================================

    it('flags black beans with 0 protein (golden n-prot-04)', () => {
        const result = assessMacroPlausibility('black beans', 'BLACK BEANS', {
            kcal: 91,
            protein: 0,
            carbs: 16,
            fat: 0.5,
        });
        expect(result.plausible).toBe(false);
        expect(result.impossible).toBe(false); // penalize, don't drop
        expect(result.penalty).toBe(IMPLAUSIBLE_MACRO_PENALTY);
        expect(result.reasons).toContain('category:protein_food_with_zero_protein');
    });

    it('flags spinach at 224 kcal/100g (golden n-prod-02)', () => {
        const result = assessMacroPlausibility('spinach', 'Spinach', {
            kcal: 224,
            protein: 3,
            carbs: 4,
            fat: 0.4,
        });
        expect(result.plausible).toBe(false);
        expect(result.impossible).toBe(false);
        expect(result.penalty).toBe(IMPLAUSIBLE_MACRO_PENALTY);
        // Both the produce prior and Atwater should notice this one
        expect(result.reasons.some(r => r.startsWith('category:fresh_produce'))).toBe(true);
    });

    // ============================================================
    // Atwater consistency
    // ============================================================

    it('flags stated kcal wildly above macro-computed kcal', () => {
        // computed = 4*5 + 4*10 + 9*2 = 78 kcal, stated 500
        const result = assessMacroPlausibility('granola bar', 'Some Bar', {
            kcal: 500,
            protein: 5,
            carbs: 10,
            fat: 2,
        });
        expect(result.plausible).toBe(false);
        expect(result.impossible).toBe(false);
        expect(result.reasons.some(r => r.startsWith('atwater:') && r.includes('exceeds'))).toBe(true);
    });

    it('flags stated kcal far below even the protein+fat energy floor', () => {
        // floor = 4*30 + 9*20 = 300 kcal; stated 50
        const result = assessMacroPlausibility('protein bar', 'Broken Data Bar', {
            kcal: 50,
            protein: 30,
            carbs: 10,
            fat: 20,
        });
        expect(result.plausible).toBe(false);
        expect(result.reasons.some(r => r.startsWith('atwater:') && r.includes('below_floor'))).toBe(true);
    });

    it('does NOT flag high-fiber / sugar-alcohol foods where carbs carry little energy', () => {
        // e.g. sugar-free candy: 100g carbs (polyols), stated 40 kcal.
        // Naive Atwater says 400 kcal, but carbs floor at 0 → pass.
        const result = assessMacroPlausibility('sugar free gummies', 'Sugar Free Gummy Bears', {
            kcal: 40,
            protein: 0,
            carbs: 100,
            fat: 0,
        });
        expect(result.plausible).toBe(true);
        expect(result.penalty).toBe(1);
    });

    it('does NOT flag alcoholic drinks whose kcal exceeds macro-computed kcal', () => {
        // Vodka: 231 kcal/100g, all macros 0 — energy is alcohol.
        const result = assessMacroPlausibility('vodka', 'Vodka 80 Proof', {
            kcal: 231,
            protein: 0,
            carbs: 0,
            fat: 0,
        });
        expect(result.plausible).toBe(true);
    });

    it('does NOT run Atwater when any macro is missing', () => {
        const result = assessMacroPlausibility('mystery food', 'Partial Data Food', {
            kcal: 300,
            protein: null,
            carbs: 10,
            fat: 2,
        });
        expect(result.plausible).toBe(true);
    });

    // ============================================================
    // Bounds sanity (hard-impossible → drop)
    // ============================================================

    it('drops negative macros as impossible', () => {
        const result = assessMacroPlausibility('chicken breast', 'Chicken', {
            kcal: 120,
            protein: -5,
            carbs: 0,
            fat: 2,
        });
        expect(result.impossible).toBe(true);
        expect(result.penalty).toBe(0);
        expect(result.reasons.some(r => r.includes('protein_negative'))).toBe(true);
    });

    it('drops macro sum > 105 g/100g as impossible', () => {
        const result = assessMacroPlausibility('peanut butter', 'Peanut Butter', {
            kcal: 600,
            protein: 40,
            carbs: 40,
            fat: 40,
        });
        expect(result.impossible).toBe(true);
        expect(result.penalty).toBe(0);
        expect(result.reasons.some(r => r.includes('macro_sum_over'))).toBe(true);
    });

    it('drops kcal > 900/100g as impossible', () => {
        const result = assessMacroPlausibility('oil', 'Mystery Oil', {
            kcal: 1200,
            protein: 0,
            carbs: 0,
            fat: 100,
        });
        expect(result.impossible).toBe(true);
        expect(result.reasons.some(r => r.includes('kcal_over_900'))).toBe(true);
    });

    it('drops a single macro > 100 g/100g as impossible', () => {
        const result = assessMacroPlausibility('rice', 'Rice', {
            kcal: 360,
            protein: 7,
            carbs: 250,
            fat: 1,
        });
        expect(result.impossible).toBe(true);
    });

    // ============================================================
    // Negative cases — legitimately dense/odd foods must PASS
    // ============================================================

    it('passes avocado at ~160 kcal/100g', () => {
        const result = assessMacroPlausibility('avocado', 'Avocado, raw', {
            kcal: 160,
            protein: 2,
            carbs: 9,
            fat: 15,
        });
        expect(result.plausible).toBe(true);
        expect(result.penalty).toBe(1);
        expect(result.reasons).toEqual([]);
    });

    it('passes dried spinach powder at ~300 kcal/100g (concentrated form exemption)', () => {
        const result = assessMacroPlausibility('spinach powder', 'Dried Spinach Powder', {
            kcal: 300,
            protein: 30,
            carbs: 40,
            fat: 4,
        });
        expect(result.plausible).toBe(true);
    });

    it('passes candidate-side concentrated forms even for a fresh-produce query', () => {
        // Query "banana" but candidate is banana chips — exemption reads both names.
        const result = assessMacroPlausibility('banana', 'Banana Chips', {
            kcal: 519,
            protein: 2.3,
            carbs: 58,
            fat: 34,
        });
        expect(result.plausible).toBe(true);
    });

    it('passes olive oil at 884 kcal/100g', () => {
        const result = assessMacroPlausibility('olive oil', 'Olive Oil, extra virgin', {
            kcal: 884,
            protein: 0,
            carbs: 0,
            fat: 100,
        });
        expect(result.plausible).toBe(true);
        expect(result.penalty).toBe(1);
    });

    it('passes diet soda with 0 everything', () => {
        const result = assessMacroPlausibility('diet soda', 'Diet Cola', {
            kcal: 0,
            protein: 0,
            carbs: 0,
            fat: 0,
        });
        expect(result.plausible).toBe(true);
        expect(result.penalty).toBe(1);
    });

    it('passes normal fresh spinach at 23 kcal/100g', () => {
        const result = assessMacroPlausibility('spinach', 'Spinach, raw', {
            kcal: 23,
            protein: 2.9,
            carbs: 3.6,
            fat: 0.4,
        });
        expect(result.plausible).toBe(true);
    });

    it('passes normal black beans with real protein', () => {
        const result = assessMacroPlausibility('black beans', 'Black Beans, canned', {
            kcal: 91,
            protein: 6,
            carbs: 16,
            fat: 0.5,
        });
        expect(result.plausible).toBe(true);
    });

    it('does NOT apply the protein prior when protein is null (missing data)', () => {
        const result = assessMacroPlausibility('black beans', 'Black Beans', {
            kcal: 91,
            protein: null,
            carbs: 16,
            fat: 0.5,
        });
        expect(result.plausible).toBe(true);
    });

    it('does NOT apply the protein prior to exempt contexts like chicken broth', () => {
        const result = assessMacroPlausibility('chicken broth', 'Chicken Broth', {
            kcal: 4,
            protein: 0,
            carbs: 0.5,
            fat: 0,
        });
        expect(result.plausible).toBe(true);
    });

    it('does NOT apply the produce prior when the candidate is unrelated to produce keywords in query', () => {
        // Dense non-produce food, no produce keyword in query → no cap.
        const result = assessMacroPlausibility('cheddar cheese', 'Cheddar Cheese', {
            kcal: 403,
            protein: 25,
            carbs: 1.3,
            fat: 33,
        });
        expect(result.plausible).toBe(true);
    });

    it('handles missing nutrition object gracefully', () => {
        expect(assessMacroPlausibility('spinach', 'Spinach', null).plausible).toBe(true);
        expect(assessMacroPlausibility('spinach', 'Spinach', undefined).plausible).toBe(true);
    });

    // ============================================================
    // Lean-cut protein floor (golden n-mq-22)
    // ============================================================
    describe('lean-cut protein floor (n-mq-22)', () => {
        it('flags a "grilled chicken breast" deli/roll record at 14.6g protein', () => {
            const r = assessMacroPlausibility(
                'grilled chicken breast',
                'roll oven-roasted chicken breast',
                { kcal: 134, protein: 14.6, carbs: 1.79, fat: 7.65 }
            );
            expect(r.plausible).toBe(false);
            expect(r.impossible).toBe(false); // penalize, never drop
            expect(r.penalty).toBe(IMPLAUSIBLE_MACRO_PENALTY);
            expect(r.reasons.some(x => x.startsWith('category:lean_cut_protein_below_floor'))).toBe(true);
        });

        it('does NOT flag a real grilled chicken breast at 29.5g', () => {
            const r = assessMacroPlausibility(
                'grilled chicken breast',
                'cooked grilled chicken breast',
                { kcal: 165, protein: 29.5, carbs: 0, fat: 3.6 }
            );
            expect(r.plausible).toBe(true);
        });

        it('does NOT apply the cut-floor to legumes/tofu (uses >0 rule only)', () => {
            const r = assessMacroPlausibility('tofu', 'Firm Tofu', { kcal: 76, protein: 8, carbs: 2, fat: 4.8 });
            expect(r.plausible).toBe(true); // 8g is fine for tofu
        });

        it('still exempts chicken breast broth/soup from the floor', () => {
            const r = assessMacroPlausibility('chicken breast broth', 'Chicken Broth', {
                kcal: 4,
                protein: 0.5,
                carbs: 0.5,
                fat: 0.1,
            });
            expect(r.reasons.some(x => x.includes('lean_cut'))).toBe(false);
        });

        it('does NOT apply the cut-floor to bare "chicken" (unscoped)', () => {
            // generic "chicken" is not a named lean cut → floor must not fire
            const r = assessMacroPlausibility('chicken', 'Chicken Nuggets', { kcal: 250, protein: 14, carbs: 15, fat: 15 });
            expect(r.reasons.some(x => x.includes('lean_cut'))).toBe(false);
        });
    });
});
