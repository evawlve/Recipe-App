/**
 * The isolation receipt for the nutrition-modifier restoration.
 *
 * This file IS arm 1 of the gate. `winner-diff.ts` replays `normalizedName` from
 * a frozen snapshot and is therefore structurally blind to a change that
 * produces that field — and `winner-gate.sh` does NOT abort here, because
 * `FROZEN_INPUT_PATHS` covers neither `map-ingredient-with-fallback.ts` nor
 * `llm-output-guards.ts` even though both are producers of the frozen value. So
 * a green frozen-pool run on this branch is vacuous, and these named targets and
 * sentinels stand in for it, the way #312 gated the digit-brand lexicon by
 * running `parseIngredientLine()` against branch-vs-master copies of one file.
 *
 * TARGETS must move. SENTINELS must not. Both counts are asserted, because
 * "admit-only by inspection" is not a safety argument.
 */

import {
    NUTRITION_MODIFIER_PHRASES,
    restoreNutritionModifiers,
} from '../llm-output-guards';

describe('restoreNutritionModifiers — TARGETS (every one must move)', () => {
    // Each pair is (the user's own text, what the normalizer handed downstream).
    // The candidate strings are the REAL values observed in `SegmentationCache`
    // on box BU4urjF_aMOJ1oBawuCLD, 2026-08-15 — not invented fixtures. Writing
    // an invented fixture is how the `serving-ai-tiers` regex gap survived.
    const targets: [string, string, string][] = [
        ['a plate with sugar free greek yogurt', 'greek yogurt', 'sugar free greek yogurt'],
        ['a burger with sugar free bbq sauce', 'bbq sauce', 'sugar free bbq sauce'],
        ['a parfait with no sugar added greek yogurt', 'greek yogurt', 'no sugar added greek yogurt'],
        ['a parfait with unsweetened greek yogurt', 'greek yogurt', 'unsweetened greek yogurt'],
        ['a parfait with reduced fat greek yogurt', 'greek yogurt', 'reduced fat greek yogurt'],
        ['a parfait with nonfat greek yogurt', 'greek yogurt', 'nonfat greek yogurt'],
        ['a parfait with low fat greek yogurt', 'greek yogurt', 'low fat greek yogurt'],
        ['fat free cheddar cheese and an apple', 'cheddar cheese', 'fat free cheddar cheese'],
        ['1 cup unsweetened almond milk', 'almond milk', 'unsweetened almond milk'],
        // Golden case n-mq-11, whose own note says the qualifier is dropped and is
        // "tracked here so a future qualifier-aware match can be measured against it".
        ["2 tbsp ghugh's sugar free honey mustard", 'honey mustard', 'sugar free honey mustard'],
        // n-seg-33's second item. `diet` is attributive here and must be restored.
        ['i had a chicken caesar salad and a diet coke', 'coke', 'diet coke'],
    ];

    it.each(targets)('%s -> restores', (evidence, candidate, expected) => {
        const { restored, added } = restoreNutritionModifiers(evidence, candidate);
        expect(restored).toBe(expected);
        expect(added.length).toBeGreaterThan(0);
    });

    it('every target moves — the count is asserted, not eyeballed', () => {
        const moved = targets.filter(
            ([e, c]) => restoreNutritionModifiers(e, c).restored !== c,
        );
        expect(moved).toHaveLength(targets.length);
    });
});

describe('restoreNutritionModifiers — SENTINELS (none may move)', () => {
    const sentinels: [string, string][] = [
        // No modifier present: pure no-op.
        ['greek yogurt', 'greek yogurt'],
        ['a bowl of cereal with milk', 'milk'],
        ['2 eggs', 'eggs'],
        // Already retained downstream — must not be doubled.
        ['a bowl of cereal with fat free milk', 'fat free milk'],
        ['a snack with zero sugar red bull', 'zero sugar red bull'],
        // Owned by IDENTITY_QUALIFIERS / isIdentityWholePhrase(); restoring here
        // would double-restore and reopen the 2026-08-04 count-unit collision.
        ['whole milk', 'whole milk'],
        // `light` is deliberately excluded: live synonym_rewrites CREATE the word.
        ['light corn syrup', 'corn syrup'],
        ['canned light red kidney beans', 'red kidney beans'],
        // `organic` carries conflictPenalty 0 — "user preference, not nutrition".
        ['orgain organic protein powder', 'protein powder'],
        // Widening toward the sugary product has no consequence argument, and it
        // is the substring hazard `unsweetened` matching must not trip.
        ['sweetened condensed milk', 'condensed milk'],
        // `diet` in its ordinary-noun sense must be refused positionally.
        ['i changed my diet', 'diet'],
        ['a snack on my diet', 'snack'],
        // ADDS ONLY: a downstream ADDITION is left alone. This is what keeps the
        // guard from fighting stripIntroducedFoodTokens().
        ['chicken breast', 'skinless chicken breast'],
    ];

    it.each(sentinels)('%s -> unchanged', (evidence, candidate) => {
        const { restored, added } = restoreNutritionModifiers(evidence, candidate);
        expect(restored).toBe(candidate);
        expect(added).toEqual([]);
    });

    it('no sentinel moves — the count is asserted', () => {
        const moved = sentinels.filter(
            ([e, c]) => restoreNutritionModifiers(e, c).restored !== c,
        );
        expect(moved).toEqual([]);
    });
});

describe('the contract', () => {
    it('never returns empty, even for an empty candidate', () => {
        expect(restoreNutritionModifiers('sugar free jam', '').restored).toBe('');
        expect(restoreNutritionModifiers('sugar free jam', null).restored).toBe('');
    });

    it('restores in the order the user typed, not phrase-table order', () => {
        const { restored } = restoreNutritionModifiers('fat free sugar free yogurt', 'yogurt');
        expect(restored).toBe('fat free sugar free yogurt');
    });

    it('matches whole tokens only — a substring never fires', () => {
        // "skimmed" must not satisfy "skim"; "dietary" must not satisfy "diet".
        expect(restoreNutritionModifiers('skimmed milk', 'milk').added).toEqual([]);
        expect(restoreNutritionModifiers('dietary fibre bar', 'bar').added).toEqual([]);
    });

    it('longest-first: "no sugar added" is not shadowed by a shorter member', () => {
        const { added } = restoreNutritionModifiers('no sugar added jam', 'jam');
        expect(added).toEqual(['no sugar added']);
    });

    it('folds hyphens on both sides', () => {
        expect(restoreNutritionModifiers('sugar-free jam', 'jam').restored).toBe('sugar free jam');
        expect(restoreNutritionModifiers('sugar free jam', 'sugar-free jam').added).toEqual([]);
    });

    it('is idempotent — running it twice changes nothing the second time', () => {
        const once = restoreNutritionModifiers('sugar free bbq sauce', 'bbq sauce').restored;
        const twice = restoreNutritionModifiers('sugar free bbq sauce', once).restored;
        expect(twice).toBe(once);
    });

    it('the shipped set excludes every phrase refused by name', () => {
        // Pins the exclusions so re-adding one is a deliberate, reviewed act.
        for (const refused of ['light', 'lite', 'organic', 'natural', 'whole', 'sweetened',
            'low sodium', 'less sodium', 'lean', 'gluten free', 'vegan', 'keto']) {
            expect(NUTRITION_MODIFIER_PHRASES).not.toContain(refused);
        }
    });
});
