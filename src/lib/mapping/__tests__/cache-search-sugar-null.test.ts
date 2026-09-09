/**
 * buildCacheFoodResponse() — the search route's AI-cache lane and the
 * /api/foods/[id] cache branch — ships `sugar100: null` when
 * `AiGeneratedFood.sugarPer100g` is null, and 0 only when the column holds 0.
 *
 * The sibling of cache-search-fiber-null.test.ts, one PR later (#134), pinned
 * here for the same reason: this builder is a SECOND emitter of the field and
 * does not go through resolveFoodDetails, so the parse-lane pin cannot see it.
 *
 * THERE IS DELIBERATELY NO `sodium100` ON THIS RESPONSE, and #134 did not add
 * one — `extractCacheNutrients()` does not read `sodiumMgPer100g` at all, so
 * the builder has no sodium to ship. An ABSENT key already says "no claim";
 * adding the field is a wire WIDENING (a new field, a new extraction and an
 * mg -> g conversion that must match resolve-payload's), which is its own row
 * with its own client half, not a null-fold fix. The absence is asserted below
 * so that a later widening is a deliberate act with a test to update, not a
 * silent drift.
 *
 * RED on the pre-fix tree: the `toBeNull()` fails on master @ 4a1ca59
 * (`nutrients.sugar ?? 0`); the declared-0 row is the control.
 */

jest.mock('../../db', () => ({ prisma: {} }));

import { buildCacheFoodResponse, type CacheFoodRecord } from '../cache-search';

function cacheFood(sugarPer100g: number | null): CacheFoodRecord {
    return {
        id: 'cksugar',
        displayName: 'Blueberry Compote',
        caloriesPer100g: 72,
        proteinPer100g: 0.8,
        carbsPer100g: 14.4,
        fatPer100g: 1.6,
        fiberPer100g: 2.4,
        sugarPer100g,
        servings: [],
    } as unknown as CacheFoodRecord;
}

describe('buildCacheFoodResponse sugar100', () => {
    it('a null column is null on the response — no fabricated 0 g', () => {
        const r = buildCacheFoodResponse(cacheFood(null), 0.9);
        expect(r.sugar100).toBeNull();
        // The macros still fold null to 0 (unchanged shape), and fibre keeps #424's rule.
        expect(r.kcal100).toBe(72);
        expect(r.fiber100).toBe(2.4);
    });

    it('a stored 0 — the column default — stays 0', () => {
        expect(buildCacheFoodResponse(cacheFood(0), 0.9).sugar100).toBe(0);
    });

    it('a stored value passes through unchanged', () => {
        expect(buildCacheFoodResponse(cacheFood(7.2), 0.9).sugar100).toBe(7.2);
    });

    it('the response carries NO sodium100 key at all — absence is the claim, see the header', () => {
        const r = buildCacheFoodResponse(cacheFood(7.2), 0.9) as Record<string, unknown>;
        expect('sodium100' in r).toBe(false);
        expect(JSON.stringify(r)).not.toContain('sodium');
    });
});
