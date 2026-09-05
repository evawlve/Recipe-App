/**
 * buildCacheFoodResponse() — the search route's AI-cache lane and the
 * /api/foods/[id] cache branch — ships `fiber100: null` when
 * `AiGeneratedFood.fiberPer100g` is null, and 0 only when the column holds 0.
 *
 * The same rule as ResolvedNutritionPer100g.fiber100 (src/lib/nlp/resolve-payload.ts),
 * pinned here because this builder is a SECOND emitter of the field: it does not
 * go through resolveFoodDetails, so the parse-lane pin cannot see it. The column
 * is `Float? @default(0)` and 0 of 241 rows are null today (measured on the box
 * 2026-09-05; re-derive: SELECT count(*) FILTER (WHERE "fiberPer100g" IS NULL),
 * count(*) FROM "AiGeneratedFood";), so this is inert on the live store and is
 * the rule the moment a writer stores null.
 *
 * RED on the pre-fix tree: the `toBeNull()` fails on master @ 5411f7e
 * (`nutrients.fiber ?? 0`); the declared-0 row is the control.
 */

jest.mock('../../db', () => ({ prisma: {} }));

import { buildCacheFoodResponse, type CacheFoodRecord } from '../cache-search';

function cacheFood(fiberPer100g: number | null): CacheFoodRecord {
    return {
        id: 'ckfiber',
        displayName: 'Blueberry Compote',
        caloriesPer100g: 72,
        proteinPer100g: 0.8,
        carbsPer100g: 14.4,
        fatPer100g: 1.6,
        fiberPer100g,
        sugarPer100g: 7.2,
        servings: [],
    } as unknown as CacheFoodRecord;
}

describe('buildCacheFoodResponse fiber100', () => {
    it('a null column is null on the response — no fabricated 0 g', () => {
        const r = buildCacheFoodResponse(cacheFood(null), 0.9);
        expect(r.fiber100).toBeNull();
        // The rest of the panel still folds null to 0 (unchanged shape).
        expect(r.kcal100).toBe(72);
        expect(r.sugar100).toBe(7.2);
    });

    it('a stored 0 — the column default — stays 0', () => {
        expect(buildCacheFoodResponse(cacheFood(0), 0.9).fiber100).toBe(0);
    });

    it('a stored value passes through unchanged', () => {
        expect(buildCacheFoodResponse(cacheFood(4), 0.9).fiber100).toBe(4);
    });
});
