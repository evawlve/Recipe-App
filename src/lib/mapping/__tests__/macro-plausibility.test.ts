/**
 * Unit tests for the macro plausibility gate (macro-plausibility.ts).
 *
 * Anchored on the two golden-set known issues:
 *   - n-prot-04: "black beans" → OFF row with protein = 0
 *   - n-prod-02: "spinach" → OFF row with 224 kcal/100g
 * Plus Atwater-mismatch detection and negative cases that must NOT be flagged
 * (avocado, dried spinach powder, olive oil, diet soda, alcohol, fiber foods).
 */

import {
    assessMacroPlausibility,
    assessRankTimePlausibility,
    assessSaveTimePlausibility,
    IMPLAUSIBLE_MACRO_PENALTY,
} from '../macro-plausibility';

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

describe('assessSaveTimePlausibility', () => {
    // ============================================================
    // The four rows the 2026-07-20 parity sweep actually cached
    // ============================================================

    it('rejects "granulated sugar" at 16 kcal/100g vs estimate ~387', () => {
        const r = assessSaveTimePlausibility(
            'granulated sugar', 'Granulated Sugar',
            { kcal: 16, protein: 0, carbs: 4, fat: 0 },
            { caloriesPer100g: 387, proteinPer100g: 0, confidence: 0.9 }
        );
        expect(r.save).toBe(false);
        expect(r.reasons.some((x: string) => x.startsWith('estimate:kcal_'))).toBe(true);
    });

    it('rejects "grape" at 5 kcal/100g vs estimate ~69', () => {
        const r = assessSaveTimePlausibility(
            'grape', 'Grape drink',
            { kcal: 5, protein: 0, carbs: 1.2, fat: 0 },
            { caloriesPer100g: 69, proteinPer100g: 0.7, confidence: 0.85 }
        );
        expect(r.save).toBe(false);
    });

    it('rejects "lentil" at 20.9 kcal/100g vs estimate ~116', () => {
        const r = assessSaveTimePlausibility(
            'lentil', 'Lentil soup base',
            { kcal: 20.9, protein: 1.2, carbs: 3.5, fat: 0.3 },
            { caloriesPer100g: 116, proteinPer100g: 9, confidence: 0.85 }
        );
        expect(r.save).toBe(false);
    });

    it('rejects "blueberry" at 8.7g protein/100g vs estimate ~0.7', () => {
        const r = assessSaveTimePlausibility(
            'blueberry', 'Blueberry protein blend',
            { kcal: 60, protein: 8.7, carbs: 5, fat: 0.5 },
            { caloriesPer100g: 57, proteinPer100g: 0.7, confidence: 0.85 }
        );
        expect(r.save).toBe(false);
        expect(r.reasons.some((x: string) => x.includes('protein') && x.includes('over_expected'))).toBe(true);
    });

    // ============================================================
    // Deterministic floors — simple staple queries skip the LLM
    // normalize step, so these must fire WITHOUT an estimate
    // (live-verified 2026-07-20: the sugar probe had no estimate
    // and the corrupt row is internally consistent, so only a
    // floor can catch it)
    // ============================================================

    it('rejects whole-query sweetener under the kcal floor without an estimate', () => {
        const r = assessSaveTimePlausibility(
            'granulated sugar', 'Granulated sugar',
            { kcal: 16, protein: 0, carbs: 4, fat: 0 }
        );
        expect(r.save).toBe(false);
        expect(r.reasons.some((x: string) => x.startsWith('floor:sweetener_kcal_'))).toBe(true);
    });

    it('does NOT apply the sweetener floor to compound queries like "honey ham"', () => {
        const r = assessSaveTimePlausibility(
            'honey ham', 'Honey Ham',
            { kcal: 122, protein: 17, carbs: 6, fat: 3 }
        );
        expect(r.save).toBe(true);
    });

    it('rejects fresh produce under the kcal floor without an estimate (grape → 5 kcal drink)', () => {
        const r = assessSaveTimePlausibility(
            'grape', 'Grape drink',
            { kcal: 5, protein: 0, carbs: 1.2, fat: 0 }
        );
        expect(r.save).toBe(false);
        expect(r.reasons.some((x: string) => x.startsWith('floor:produce_kcal_'))).toBe(true);
    });

    it('does NOT flag real low-cal produce (celery at 14 kcal)', () => {
        const r = assessSaveTimePlausibility(
            'celery', 'Celery, raw',
            { kcal: 14, protein: 0.7, carbs: 3, fat: 0.2 }
        );
        expect(r.save).toBe(true);
    });

    it('rejects protein-dense produce hijack without an estimate (blueberry → 8.7g protein)', () => {
        const r = assessSaveTimePlausibility(
            'blueberry', 'Blueberry blend',
            { kcal: 60, protein: 8.7, carbs: 5, fat: 0.5 }
        );
        expect(r.save).toBe(false);
        expect(r.reasons.some((x: string) => x.startsWith('floor:produce_protein_'))).toBe(true);
    });

    it('rejects legume under the kcal floor without an estimate (lentil → 20.9 kcal)', () => {
        const r = assessSaveTimePlausibility(
            'lentil', 'Lentil base',
            { kcal: 20.9, protein: 1.2, carbs: 3.5, fat: 0.3 }
        );
        expect(r.save).toBe(false);
        expect(r.reasons.some((x: string) => x.startsWith('floor:legume_kcal_'))).toBe(true);
    });

    it('exempts lentil SOUP from the legume floor', () => {
        const r = assessSaveTimePlausibility(
            'lentil soup', 'Lentil Soup',
            { kcal: 44, protein: 2.5, carbs: 6.5, fat: 1 }
        );
        expect(r.save).toBe(true);
    });

    // ============================================================
    // Strictness: soft ranking failures also block the write
    // ============================================================

    it('blocks the write on a soft (penalty-only) ranking failure', () => {
        // "black beans" with 0 protein soft-penalizes in ranking but must not be cached
        const r = assessSaveTimePlausibility(
            'black beans', 'BLACK BEANS',
            { kcal: 91, protein: 0, carbs: 16, fat: 0.5 }
        );
        expect(r.save).toBe(false);
    });

    it('rejects protein-dense query mapped to a near-zero-protein record', () => {
        // wrong-record class: "chicken breast"-style query landing on broth-like data
        const r = assessSaveTimePlausibility(
            'grilled chicken', 'Chicken flavor base',
            { kcal: 40, protein: 2, carbs: 4, fat: 1.5 },
            { caloriesPer100g: 165, proteinPer100g: 31, confidence: 0.9 }
        );
        expect(r.save).toBe(false);
        expect(r.reasons.some((x: string) => x.includes('under_expected') || x.startsWith('estimate:kcal_'))).toBe(true);
    });

    // ============================================================
    // Must-save negatives (no false positives)
    // ============================================================

    it('saves a clean pick close to the estimate', () => {
        const r = assessSaveTimePlausibility(
            'banana', 'Bananas, raw',
            { kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3 },
            { caloriesPer100g: 105, proteinPer100g: 1.3, confidence: 0.9 }
        );
        expect(r.save).toBe(true);
        expect(r.reasons).toEqual([]);
    });

    it('ignores the estimate cross-check below the confidence gate', () => {
        // Corrupt-looking cheese numbers with a LOW-confidence estimate → the
        // estimate check must not run, and no deterministic floor covers
        // cheese, so the save goes through (conservative fail-open).
        const r = assessSaveTimePlausibility(
            'cheddar cheese', 'Cheddar Cheese',
            { kcal: 50, protein: 3, carbs: 1, fat: 4 },
            { caloriesPer100g: 403, proteinPer100g: 23, confidence: 0.5 }
        );
        expect(r.save).toBe(true);
    });

    it('saves when no nutrition data is provided (missing data is not this gate\'s job)', () => {
        const r = assessSaveTimePlausibility('olive oil', 'Olive Oil', null, {
            caloriesPer100g: 884, proteinPer100g: 0, confidence: 0.9,
        });
        expect(r.save).toBe(true);
    });

    it('does not fire the kcal band on near-zero foods (abs-diff floor)', () => {
        // diet soda: expected 2 kcal, actual 0 — ratio is extreme, diff is trivial
        const r = assessSaveTimePlausibility(
            'diet soda', 'Diet Cola',
            { kcal: 0, protein: 0, carbs: 0, fat: 0 },
            { caloriesPer100g: 2, proteinPer100g: 0, confidence: 0.9 }
        );
        expect(r.save).toBe(true);
    });

    it('tolerates cooked-vs-label variance inside the 4x band', () => {
        // carrot cached at 24 kcal vs estimate 41 — questionable but inside the
        // band; the gate is deliberately conservative (ratio 1.7x)
        const r = assessSaveTimePlausibility(
            'carrot', 'Carrots',
            { kcal: 24, protein: 0.6, carbs: 5.3, fat: 0.1 },
            { caloriesPer100g: 41, proteinPer100g: 0.9, confidence: 0.9 }
        );
        expect(r.save).toBe(true);
    });

    it('still hard-rejects physically impossible values without any estimate', () => {
        const r = assessSaveTimePlausibility(
            'mystery food', 'Mystery',
            { kcal: 1200, protein: 10, carbs: 10, fat: 10 }
        );
        expect(r.save).toBe(false);
    });
});

describe('assessRankTimePlausibility', () => {
    // ============================================================
    // Floor parity with the save-time gate (single source of truth)
    // ============================================================

    it('fires exactly the same floor:* reasons as the save-time gate (shared floors)', () => {
        // One input per deterministic floor + one clean input. Both functions
        // consume collectDeterministicFloorReasons — the floor verdicts must
        // agree exactly on identical inputs.
        const cases: Array<[string, string, { kcal: number; protein: number; carbs: number; fat: number }]> = [
            ['granulated sugar', 'Granulated sugar', { kcal: 16, protein: 0, carbs: 4, fat: 0 }],
            ['grape', 'Grape drink', { kcal: 5, protein: 0, carbs: 1.2, fat: 0 }],
            ['blueberry', 'Blueberry blend', { kcal: 60, protein: 8.7, carbs: 5, fat: 0.5 }],
            ['lentil', 'Lentil base', { kcal: 20.9, protein: 1.2, carbs: 3.5, fat: 0.3 }],
            ['banana', 'Bananas, raw', { kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3 }],
        ];
        for (const [query, name, macros] of cases) {
            const rank = assessRankTimePlausibility(query, name, macros);
            const save = assessSaveTimePlausibility(query, name, macros);
            const rankFloors = rank.reasons.filter((r) => r.startsWith('floor:'));
            const saveFloors = save.reasons.filter((r) => r.startsWith('floor:'));
            expect(rankFloors).toEqual(saveFloors);
            expect(rank.floorHit).toBe(rankFloors.length > 0 || rank.reasons.some((r) => r.startsWith('category:')));
        }
    });

    // ============================================================
    // Floor-grade classification
    // ============================================================

    it('classifies the sweetener kcal floor as floorHit', () => {
        const r = assessRankTimePlausibility('granulated sugar', 'Granulated sugar', {
            kcal: 16, protein: 0, carbs: 4, fat: 0,
        });
        expect(r.impossible).toBe(false);
        expect(r.floorHit).toBe(true);
        expect(r.reasons.some((x) => x.startsWith('floor:sweetener_kcal_'))).toBe(true);
    });

    it('classifies produce kcal-under and protein-over floors as floorHit', () => {
        const under = assessRankTimePlausibility('grape', 'Grape drink', {
            kcal: 5, protein: 0, carbs: 1.2, fat: 0,
        });
        expect(under.floorHit).toBe(true);
        const protein = assessRankTimePlausibility('blueberry', 'Blueberry blend', {
            kcal: 60, protein: 8.7, carbs: 5, fat: 0.5,
        });
        expect(protein.floorHit).toBe(true);
    });

    it('classifies the produce kcal-over-150 category prior as floorHit (lemon 383 kJ-as-kcal class)', () => {
        const r = assessRankTimePlausibility('lemon', 'Lemon', {
            kcal: 383, protein: 25, carbs: 46.7, fat: 13.3,
        });
        expect(r.impossible).toBe(false);
        expect(r.floorHit).toBe(true);
        expect(r.reasons.some((x) => x.startsWith('category:fresh_produce_kcal_'))).toBe(true);
    });

    it('classifies the legume kcal floor as floorHit', () => {
        const r = assessRankTimePlausibility('lentil', 'Lentil base', {
            kcal: 20.9, protein: 1.2, carbs: 3.5, fat: 0.3,
        });
        expect(r.floorHit).toBe(true);
        expect(r.reasons.some((x) => x.startsWith('floor:legume_kcal_'))).toBe(true);
    });

    it('classifies zero-protein protein food as floorHit, not soft (golden n-prot-04)', () => {
        const r = assessRankTimePlausibility('black beans', 'BLACK BEANS', {
            kcal: 91, protein: 0, carbs: 16, fat: 0.5,
        });
        expect(r.floorHit).toBe(true);
        expect(r.softPenalty).toBe(false); // no Atwater reason fired here
        expect(r.reasons).toContain('category:protein_food_with_zero_protein');
    });

    it('classifies the lean-cut protein floor as floorHit, not soft (golden n-mq-22)', () => {
        const r = assessRankTimePlausibility(
            'grilled chicken breast',
            'roll oven-roasted chicken breast',
            { kcal: 134, protein: 14.6, carbs: 1.79, fat: 7.65 }
        );
        expect(r.floorHit).toBe(true);
        expect(r.softPenalty).toBe(false);
        expect(r.reasons.some((x) => x.startsWith('category:lean_cut_protein_below_floor'))).toBe(true);
    });

    // ============================================================
    // Atwater stays soft
    // ============================================================

    it('keeps Atwater high-side failures soft — never floorHit', () => {
        // computed = 4*5 + 4*10 + 9*2 = 78 kcal, stated 500
        const r = assessRankTimePlausibility('granola bar', 'Some Bar', {
            kcal: 500, protein: 5, carbs: 10, fat: 2,
        });
        expect(r.softPenalty).toBe(true);
        expect(r.floorHit).toBe(false);
        expect(r.impossible).toBe(false);
    });

    it('keeps Atwater low-side failures soft — never floorHit', () => {
        // floor = 4*30 + 9*20 = 300 kcal; stated 50
        const r = assessRankTimePlausibility('protein bar', 'Broken Data Bar', {
            kcal: 50, protein: 30, carbs: 10, fat: 20,
        });
        expect(r.softPenalty).toBe(true);
        expect(r.floorHit).toBe(false);
    });

    // ============================================================
    // Impossible passthrough + clean passthrough
    // ============================================================

    it('passes impossible bounds violations through as impossible', () => {
        const r = assessRankTimePlausibility('oil', 'Mystery Oil', {
            kcal: 1200, protein: 0, carbs: 0, fat: 100,
        });
        expect(r.impossible).toBe(true);
        expect(r.floorHit).toBe(false);
        expect(r.softPenalty).toBe(false);
    });

    it('returns fully clean for a plausible record', () => {
        const r = assessRankTimePlausibility('avocado', 'Avocado, raw', {
            kcal: 160, protein: 2, carbs: 9, fat: 15,
        });
        expect(r).toEqual({ impossible: false, floorHit: false, softPenalty: false, reasons: [] });
    });

    // ============================================================
    // Lean fish/seafood extension (PR D pt3 critic amendment).
    // These are FLOOR-GRADE (sort-below), NOT drops: a battered/fried
    // fish record merely ranks below plausible ones and still surfaces
    // when nothing better exists — so extending the pattern is safe.
    // ============================================================

    it('floors the corrupt tuna record at 5.66g protein/100g (barcode 0859710005238 class)', () => {
        const r = assessRankTimePlausibility('tuna', 'Tuna', {
            kcal: 94, protein: 5.66, carbs: 10.38, fat: 3.77,
        });
        expect(r.floorHit).toBe(true);
        expect(r.impossible).toBe(false); // sort-below, never a drop
        expect(r.reasons.some((x) => x.startsWith('category:lean_cut_protein_below_floor'))).toBe(true);
    });

    it('passes salmon at 20g protein/100g clean', () => {
        const r = assessRankTimePlausibility('salmon', 'Atlantic Salmon, raw', {
            kcal: 208, protein: 20, carbs: 0, fat: 13,
        });
        expect(r.floorHit).toBe(false);
        expect(r.reasons).toEqual([]);
    });

    it('applies the fish floor to other named lean fish (tilapia)', () => {
        const r = assessRankTimePlausibility('tilapia', 'Tilapia meal kit', {
            kcal: 120, protein: 6, carbs: 12, fat: 4,
        });
        expect(r.floorHit).toBe(true);
    });

    it('still exempts fish-derived fats/sauces from the floor (cod liver oil)', () => {
        const r = assessRankTimePlausibility('cod liver oil', 'Cod Liver Oil', {
            kcal: 900, protein: 0, carbs: 0, fat: 100,
        });
        expect(r.reasons.some((x) => x.includes('lean_cut'))).toBe(false);
        expect(r.reasons.some((x) => x.includes('protein_food_with_zero_protein'))).toBe(false);
    });
});
