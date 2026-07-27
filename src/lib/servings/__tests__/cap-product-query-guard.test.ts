/**
 * The category CAP must not overwrite a PRODUCT's declared label serving.
 *
 * `getBareQueryDefault` matches a lexicon token anywhere in the query, and the
 * CAP fires whenever the billed grams exceed `categoryDefault x 2`. For the 2.5g
 * spice/salt category that threshold is FIVE GRAMS — below every real packaged
 * food — so any product whose name happens to contain salt / cinnamon / spice /
 * pepper had its manufacturer serving replaced by one teaspoon.
 *
 * All six rows below were measured live on the box (2026-07-27) with
 * scripts/eval/probe-bare-serving.ts, which captures the guard's own
 * previousTier/previousGrams. They are not hypotheses:
 *
 *   mac and cheese                            bare_label_serving    113.4g -> 28g
 *   rxbar chocolate sea salt                  label_serving_default    52g -> 2.5g
 *   quaker instant rolled oats apple cinnamon label_serving_default    43g -> 2.5g
 *   ryse loaded protein cinnamon              label_serving_default  34.2g -> 2.5g
 *   pumpkin spice granola                     fs_default_serving       29g -> 2.5g
 *   talenti sea salt caramel                  fs_default_serving      128g -> 2.5g
 *
 * `mac and cheese` is the case that shows head-anchoring is not enough on its
 * own: its literal head token IS "cheese", so the head-gated branch let a 113.4g
 * label serving be capped to the 28g one-ounce cheese default — 40 kcal billed
 * for a ~400 kcal dish.
 */

import {
    applyOffBareQueryGuard,
    capMayOverrideLabelServing,
    isDoseAnchoredBareQuery,
} from '../bare-query-guard';
import type { ParsedIngredient } from '../../parse/ingredient-line';

const bare = (name: string): ParsedIngredient =>
    ({ qty: 1, unit: null, multiplier: 1, name } as unknown as ParsedIngredient);

/** The CAP path, driven exactly as build-off-result / build-fatsecret-result drive it. */
function cap(queryName: string, grams: number, servingTier = 'label_serving_default') {
    return applyOffBareQueryGuard({
        grams,
        servingTier,
        parsed: bare(queryName),
        rawLine: queryName,
        queryName,
        foodName: 'irrelevant to the CAP path',
    });
}

describe('capMayOverrideLabelServing', () => {
    it.each([
        ['salt'], ['doritos'], ['honey'], ['mayonnaise'],
        ['olive oil'], ['black pepper'], ['peanut butter'], ['brown sugar'],
        ['table salt'], ['coca cola'], ['greek yogurt'],
    ])('allows the cap for the bare ingredient %p', (q) => {
        expect(capMayOverrideLabelServing(q)).toBe(true);
    });

    it('allows a THREE-token dose-anchored query through ("ghost pre workout")', () => {
        // The scoop dose is the whole point for these, and the phrase needs its
        // final token to trigger the category (eval n-serv-43).
        expect(isDoseAnchoredBareQuery('ghost pre workout')).toBe(true);
        expect(capMayOverrideLabelServing('ghost pre workout')).toBe(true);
    });

    it.each([
        ['mac and cheese'],
        ['rxbar chocolate sea salt'],
        ['quaker instant rolled oats apple cinnamon'],
        ['ryse loaded protein cinnamon'],
        ['pumpkin spice granola'],
        ['talenti sea salt caramel'],
    ])('blocks the cap for the product query %p', (q) => {
        expect(capMayOverrideLabelServing(q, 'label_serving_default')).toBe(false);
    });

    it('does not let the dose-anchor carve-out readmit a long product query', () => {
        // "rxbar chocolate sea salt" IS dose-anchored by the letter of the rule —
        // its head token is "salt" — which is exactly why the carve-out carries a
        // token limit of its own instead of being an unconditional escape hatch.
        expect(isDoseAnchoredBareQuery('rxbar chocolate sea salt')).toBe(true);
        expect(capMayOverrideLabelServing('rxbar chocolate sea salt', 'label_serving_default')).toBe(false);
    });

    it('protects DECLARED label tiers only — package-scale grams stay cappable', () => {
        // The winner-gate caught this as a live regression on the first draft,
        // which protected every CAP tier by token count: `orgain organic protein
        // powder` went 35g -> 325.3g via package_count_sibling, billing 1,168 kcal
        // for one scoop. A package COUNT is not a declared serving.
        const q = 'orgain organic protein powder';
        expect(capMayOverrideLabelServing(q, 'package_count_sibling')).toBe(true);
        expect(capMayOverrideLabelServing(q, 'package_quantity_own')).toBe(true);
        expect(capMayOverrideLabelServing(q, 'seed_count_default')).toBe(true);
        expect(capMayOverrideLabelServing(q, 'label_serving_default')).toBe(false);
    });

    it('is not fooled by punctuation or extra whitespace', () => {
        expect(capMayOverrideLabelServing('  olive   oil  ', 'label_serving_default')).toBe(true);
        expect(capMayOverrideLabelServing("trader joe's everything bagel seasoning", 'label_serving_default')).toBe(false);
    });

    it('treats an empty query as capable (it cannot be a product name)', () => {
        expect(capMayOverrideLabelServing('', 'label_serving_default')).toBe(true);
    });
});

describe('the package-scale regression the gate caught', () => {
    it('still caps a 325g whole-tub package count to the one-scoop default', () => {
        const r = applyOffBareQueryGuard({
            grams: 325.3,
            servingTier: 'package_count_sibling',
            parsed: bare('orgain organic protein powder'),
            rawLine: 'orgain organic protein powder',
            queryName: 'orgain organic protein powder',
            foodName: 'Organic Protein Protein Powder',
        });
        expect(r).not.toBeNull();
        expect(r!.grams).toBeLessThan(100);
    });
});

describe('the CAP path — what the fix must CREATE', () => {
    it('keeps the 52g RXBAR label instead of billing one teaspoon of sea salt', () => {
        expect(cap('rxbar chocolate sea salt', 52)).toBeNull();
    });

    it('keeps the 113.4g mac-and-cheese label the head-gated branch used to cap', () => {
        expect(cap('mac and cheese', 113.398, 'bare_label_serving')).toBeNull();
    });

    it.each([
        ['quaker instant rolled oats apple cinnamon', 43, 'label_serving_default'],
        ['ryse loaded protein cinnamon', 34.2, 'label_serving_default'],
        ['pumpkin spice granola', 29, 'label_serving_default'],
        ['talenti sea salt caramel', 128, 'label_serving_default'],
    ])('keeps the declared label for %p', (q, g, tier) => {
        expect(cap(q as string, g as number, tier as string)).toBeNull();
    });
});

describe('the CAP path — what the fix must NOT break', () => {
    it('still caps a 250g whole-bottle olive oil serving to 14g', () => {
        expect(cap('olive oil', 250)).toMatchObject({ grams: 14, servingTier: 'bare_category_default' });
    });

    it('still caps the 164g bell-pepper seed hijack on bare "black pepper" (n-serv-38)', () => {
        expect(cap('black pepper', 164, 'seed_count_default'))
            .toMatchObject({ grams: 2.5, servingTier: 'bare_category_default' });
    });

    it('still caps a 130g doritos package to the salty-snack default (n-serv-42)', () => {
        expect(cap('doritos', 130)).not.toBeNull();
    });

    it('still caps the 104g cup-measure on bare sugar (n-serv-37)', () => {
        expect(cap('sugar', 104)).toMatchObject({ grams: 4 });
    });

    it('stays inert on peanut butter, whose own 32g entry sets a 64g threshold (n-serv-50)', () => {
        expect(cap('peanut butter', 32)).toBeNull();
    });

    // ---- REPLACE tiers are deliberately untouched ----
    //
    // There the grams are FABRICATED — a flat-100g placeholder or a count floor —
    // so a category default is strictly better in both directions and no label
    // data is at risk. Asserted rather than assumed, because "the change only
    // narrows a cap" is the kind of by-inspection claim this repo has been wrong
    // about five times.

    it('a long product query still gets its flat-100g floor REPLACED', () => {
        const r = applyOffBareQueryGuard({
            grams: 100,
            servingTier: 'flat_100g_default',
            parsed: bare('quest protein bar birthday cake'),
            rawLine: 'quest protein bar birthday cake',
            queryName: 'quest protein bar birthday cake',
            foodName: 'Quest Protein Bar Birthday Cake',
        });
        expect(r).not.toBeNull();
        expect(r!.grams).toBeGreaterThan(5);
    });

    it('a long product query still replaces the flat floor via its lexicon category', () => {
        const r = applyOffBareQueryGuard({
            grams: 100,
            servingTier: 'flat_100g_default',
            parsed: bare('trader joes everything bagel seasoning'),
            rawLine: 'trader joes everything bagel seasoning',
            queryName: 'trader joes everything bagel seasoning',
            foodName: 'Everything Bagel Seasoning',
        });
        expect(r).toMatchObject({ grams: 2.5 });
    });

    // ---- eligibility is unchanged ----

    it('a non-bare request is still ignored entirely', () => {
        expect(applyOffBareQueryGuard({
            grams: 250,
            servingTier: 'label_serving_default',
            parsed: { qty: 2, unit: null, multiplier: 1, name: 'olive oil' } as unknown as ParsedIngredient,
            rawLine: '2 olive oil',
            queryName: 'olive oil',
            foodName: 'Olive Oil',
        })).toBeNull();
    });
});
