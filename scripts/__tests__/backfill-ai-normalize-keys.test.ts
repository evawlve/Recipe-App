/**
 * The AiNormalizeCache re-keying migration, and the one guard that must never be removed.
 *
 * Re-keying is cheap to get wrong in two directions:
 *   - too eager: re-keying rows whose key did not move turns a 257-row migration into a
 *     2864-row rewrite (MEASURED counts, live table 2026-08-01);
 *   - too clever: 257 moves produce 6 collisions, and fusing two rows fuses
 *     estimatedCaloriesPer100g and isBranded, which map-ingredient-with-fallback.ts feeds
 *     to simpleRerank. A merge policy applied to a real disagreement changes which
 *     candidate wins a mapping, silently. So a disagreement is an ABORT, not a decision.
 */

jest.mock('../../src/lib/db', () => ({ prisma: {} }));

import {
    planBackfill,
    chooseWinner,
    splitNamespace,
    assertNewKeyFunctionLoaded,
    MergeConflictError,
    type CacheRow,
} from '../backfill-ai-normalize-keys';

function row(over: Partial<CacheRow> & Pick<CacheRow, 'normalizedKey'>): CacheRow {
    return {
        rawLine: over.normalizedKey,
        useCount: 1,
        lastUsedAt: new Date('2026-07-01T00:00:00Z'),
        isBranded: false,
        estimatedCaloriesPer100g: null,
        ...over,
    };
}

/** A stand-in for computeNormalizedKey: strips a leading quantity + unit, nothing else. */
const fakeKey = (body: string, ns = '') =>
    ns + body.replace(/^\d+\s+(cup|cups|scoop|scoops)\s+/, '').toLowerCase().trim();

describe('splitNamespace handles both storage shapes', () => {
    it('takes the namespace out of a LEGACY rawLine', () => {
        // Written before the fix: the namespace lived in rawLine and was mangled into the key.
        expect(splitNamespace(row({
            normalizedKey: 'simplify b ghost 2 scoop ghost protein',
            rawLine: 'SIMPLIFY:B:ghost:2 scoops ghost protein',
        }))).toEqual({ namespace: 'SIMPLIFY:B:ghost:', body: '2 scoops ghost protein' });
    });

    it('takes it out of the KEY once the row has been migrated', () => {
        // Migrated rows have a bare rawLine. Reading the namespace from rawLine alone would
        // call this row un-namespaced and re-key 'SIMPLIFY:rice' to 'rice' on a second run.
        expect(splitNamespace(row({
            normalizedKey: 'SIMPLIFY:rice',
            rawLine: '1 cup rice',
        }))).toEqual({ namespace: 'SIMPLIFY:', body: '1 cup rice' });
    });

    it('leaves an ordinary row un-namespaced', () => {
        expect(splitNamespace(row({ normalizedKey: 'rice', rawLine: '1 cup rice' })))
            .toEqual({ namespace: '', body: '1 cup rice' });
    });
});

describe('the backfill is a no-op on already-correct rows', () => {
    it('neither re-keys nor deletes a row whose key already matches', () => {
        const rows = [
            row({ normalizedKey: 'rice', rawLine: 'rice' }),
            row({ normalizedKey: 'SIMPLIFY:rice', rawLine: '1 cup rice' }),
        ];

        const plan = planBackfill(rows, fakeKey);

        expect(plan.unchanged).toHaveLength(2);
        expect(plan.rekeys).toEqual([]);
        expect(plan.merges).toEqual([]);
    });

    it('is idempotent: re-planning its own output changes nothing', () => {
        const before = [row({
            normalizedKey: 'simplify 1 cup rice',
            rawLine: 'SIMPLIFY:1 cup rice',
        })];
        const first = planBackfill(before, fakeKey);
        expect(first.rekeys).toEqual([{ from: 'simplify 1 cup rice', to: 'SIMPLIFY:rice' }]);

        // The row as it exists after --apply: new key, and rawLine is now bare because
        // aiSimplifyIngredient no longer concatenates the namespace onto it.
        const after = [row({ normalizedKey: 'SIMPLIFY:rice', rawLine: '1 cup rice' })];
        expect(planBackfill(after, fakeKey).rekeys).toEqual([]);
    });

    it('reports a NULL rawLine rather than guessing at a key', () => {
        const plan = planBackfill([row({ normalizedKey: 'rice', rawLine: null })], fakeKey);

        expect(plan.skipped).toHaveLength(1);
        expect(plan.rekeys).toEqual([]);
    });
});

describe('merge policy', () => {
    it('elects the row whose stored key already equals the new key', () => {
        // Keeping it means no key a live lookup already reaches ever changes identity —
        // even though the other row is 20x hotter.
        const incumbent = row({ normalizedKey: 'milk', rawLine: 'milk', useCount: 184 });
        const stray = row({ normalizedKey: 'one milk', rawLine: 'one milk', useCount: 9 });

        expect(chooseWinner('milk', [stray, incumbent])).toBe(incumbent);
        expect(chooseWinner('milk', [incumbent, stray])).toBe(incumbent);
    });

    it('falls back to the higher useCount when neither key matches', () => {
        const hot = row({ normalizedKey: 'a', useCount: 7 });
        const cold = row({ normalizedKey: 'b', useCount: 2 });

        expect(chooseWinner('c', [cold, hot])).toBe(hot);
    });

    it('breaks a useCount tie on lastUsedAt, not on input order', () => {
        // The live 'panera bacon turkey bravo' / '... sandwich' pair: both useCount=3, and
        // neither stored key equals the new key. Without this the winner is whatever order
        // Postgres happened to return.
        const older = row({
            normalizedKey: 'panera bacon turkey bravo',
            useCount: 3,
            lastUsedAt: new Date('2026-07-02T00:00:00Z'),
        });
        const newer = row({
            normalizedKey: 'panera bacon turkey bravo sandwich',
            useCount: 3,
            lastUsedAt: new Date('2026-07-20T00:00:00Z'),
        });

        expect(chooseWinner('x', [older, newer])).toBe(newer);
        expect(chooseWinner('x', [newer, older])).toBe(newer);
    });

    it('sums useCount across the group', () => {
        const plan = planBackfill([
            row({ normalizedKey: 'milk', rawLine: 'milk', useCount: 184 }),
            row({ normalizedKey: 'one milk', rawLine: 'milk', useCount: 9 }),
        ], fakeKey);

        expect(plan.merges).toHaveLength(1);
        const merge = plan.merges[0];
        expect(merge.winner.normalizedKey).toBe('milk');
        expect(merge.winner.useCount + merge.losers.reduce((a, l) => a + l.useCount, 0)).toBe(193);
    });
});

describe('the abort guard on rerank inputs', () => {
    it('refuses to merge two distinct non-null nutrition estimates', () => {
        // The real pair this guard was written for: 'plain plain rice vinegar' (kcal 14) and
        // 'plain rice vinegar' (kcal 24). They only collide under a token-collapsing key
        // function, and merging them would move a simpleRerank input by 10 kcal/100g.
        const rows = [
            row({ normalizedKey: 'plain plain rice vinegar', rawLine: 'rice vinegar', estimatedCaloriesPer100g: 14 }),
            row({ normalizedKey: 'plain rice vinegar', rawLine: 'rice vinegar', estimatedCaloriesPer100g: 24 }),
        ];

        expect(() => planBackfill(rows, fakeKey)).toThrow(MergeConflictError);
        expect(() => planBackfill(rows, fakeKey)).toThrow(/estimatedCaloriesPer100g/);
    });

    it('refuses to merge rows that disagree on isBranded', () => {
        const rows = [
            row({ normalizedKey: 'a', rawLine: 'ghost protein', isBranded: true }),
            row({ normalizedKey: 'b', rawLine: 'ghost protein', isBranded: false }),
        ];

        expect(() => planBackfill(rows, fakeKey)).toThrow(/isBranded/);
    });

    it('allows a merge where only one side carries the estimate', () => {
        // NULL is "not known", not a competing answer, so the merge fills it in.
        const rows = [
            row({ normalizedKey: 'milk', rawLine: 'milk', estimatedCaloriesPer100g: 42 }),
            row({ normalizedKey: 'one milk', rawLine: 'milk', estimatedCaloriesPer100g: null }),
        ];

        expect(planBackfill(rows, fakeKey).merges).toHaveLength(1);
    });
});

describe('the script refuses to run against the old key function', () => {
    it('throws when the loaded computeNormalizedKey still folds the namespace into the body', () => {
        // The old shape. Running the backfill before the deploy would strand exactly the
        // rows it exists to rescue, and nothing would report it.
        const oldShape = (body: string, ns = '') =>
            (ns + body).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

        expect(() => assertNewKeyFunctionLoaded(oldShape)).toThrow(/deploy first/);
    });

    it('passes against the real computeNormalizedKey', () => {
        expect(() => assertNewKeyFunctionLoaded()).not.toThrow();
    });
});
