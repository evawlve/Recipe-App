/**
 * isMultiIngredientMismatch: an "X and Y" query must not annihilate its own dish.
 *
 * The first branch assumes the QUERY is a single ingredient that appears in the
 * candidate only as the secondary component ("cheese" must not be answered by
 * "Mac and Cheese"). When the query is ITSELF an "X and Y" compound that premise
 * is false, and the function returned true for a candidate whose name is
 * byte-identical to the query — so `mac and cheese` rejected every candidate
 * including the record literally named "Mac and Cheese", left strict and relaxed
 * pools both empty, and fell to AI backfill at 28g/90kcal against a real
 * ~200g/~400kcal serving (measured live on the box, 2026-07-26).
 *
 * The regression this rule exists for lives in the REVERSE CHECK, not the first
 * branch. It is asserted here by test rather than by inspection, because that
 * distinction is exactly what the playbook's HARD RULE demands.
 */

import { isMultiIngredientMismatch } from '../filter-candidates';

describe('isMultiIngredientMismatch — compound-query self-match', () => {
    // ---- what the fix must CREATE ----

    it('does not reject a candidate byte-identical to the query', () => {
        expect(isMultiIngredientMismatch('mac and cheese', 'Mac and Cheese')).toBe(false);
    });

    it.each([
        ['mac and cheese', 'Mac and Cheese (Cooked)'],
        ['biscuits and gravy', 'Biscuits and Gravy'],
        ['rice and beans', 'Rice and Beans'],
        ['bacon and eggs', 'Bacon and Eggs'],
        ['chips and queso', 'Chips and Queso'],
        ['spaghetti and meatballs', 'Spaghetti and Meatballs'],
        ['beef and broccoli', 'Beef and Broccoli'],
        ['gin and tonic', 'Gin and Tonic'],
        ['ackee and saltfish', 'Ackee and Saltfish'],
    ])('admits the real dish for %p', (query, candidate) => {
        expect(isMultiIngredientMismatch(query, candidate)).toBe(false);
    });

    // ---- what the fix must NOT break ----
    //
    // MEASURED, not assumed. Both groups below return false on origin/master AND
    // on this branch — they exit before reaching the branch this change touches,
    // so the change provably cannot have moved them. Written down because the
    // 2026-07-26 investigation reported that the canonical regression "lives in
    // the SECOND branch and must be shown untouched"; it does not live in either
    // branch, and a test asserting it did would have failed on master too.

    it('the canonical regression exits early on WORD COUNT, not on either branch', () => {
        // 'tomato and green chili mix' has 5 significant words, so
        // `if (queryWords.length > 3) return false` at filter-candidates.ts:2020
        // fires first. This function never adjudicates it — whatever keeps
        // 'green raw tomatoes' out is upstream (must-have tokens / core-token
        // coverage), so the guard added here cannot reopen it.
        expect(isMultiIngredientMismatch('tomato and green chili mix', 'green raw tomatoes')).toBe(false);
    });

    it.each([
        ['mac and cheese', 'Cheddar Cheese'],
        ['biscuits and gravy', 'Buttermilk Biscuits'],
        ['bacon and eggs', 'Scrambled Eggs'],
    ])('%p vs single-component %p exits at the no-connector guard', (query, candidate) => {
        // The candidate carries no and/&/with, so `if (!multiMatch) return false`
        // at :2024 fires. The REVERSE CHECK only ever runs when the CANDIDATE is
        // compound — it is not a general single-component rejector, which is the
        // opposite of what the investigation assumed.
        expect(isMultiIngredientMismatch(query, candidate)).toBe(false);
    });

    // ---- the first branch must be UNCHANGED for single-ingredient queries ----

    it('a single-ingredient query is still rejected by a mixed product', () => {
        // This is the behaviour the first branch exists for and the guard must
        // not touch: "cheese" is only the secondary half of "Mac and Cheese".
        expect(isMultiIngredientMismatch('cheese', 'Mac and Cheese')).toBe(true);
        expect(isMultiIngredientMismatch('gravy', 'Biscuits and Gravy')).toBe(true);
    });

    it('a single-ingredient query matching the PRIMARY half is still admitted', () => {
        expect(isMultiIngredientMismatch('mac', 'Mac and Cheese')).toBe(false);
    });

    it('a non-compound candidate is short-circuited regardless of query shape', () => {
        expect(isMultiIngredientMismatch('mac and cheese', 'Macaroni')).toBe(false);
    });
});
