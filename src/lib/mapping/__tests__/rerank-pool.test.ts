import { buildRerankPool, rerankPoolRemainder, RERANK_POOL_LIMIT } from '../rerank-pool';

/**
 * Each block names the invariant it pins and, where the guard is a specific
 * expression, the mutation that must kill it. A test written against its own
 * author's mental model shares that model's blind spots, so the mutations were
 * actually applied and confirmed red before this file was committed.
 */

interface C { id: string; source?: string | null }

const c = (id: string, source?: string | null): C => ({ id, source });
const ids = (xs: readonly C[]) => xs.map(x => x.id).join(',');
const bySource = (xs: readonly C[]) =>
    xs.reduce<Record<string, number>>((m, x) => (m[x.source ?? ''] = (m[x.source ?? ''] ?? 0) + 1, m), {});

/** The measured `grilled chicken breast` gather, 2026-08-01: 2 FDC, 14 OFF, 8 FatSecret,
 *  concatenated lane by lane exactly as gatherCandidates emits them. */
const GRILLED_CHICKEN_BREAST: C[] = [
    ...Array.from({ length: 2 }, (_, i) => c(`fdc${i}`, 'fdc')),
    ...Array.from({ length: 14 }, (_, i) => c(`off${i}`, 'openfoodfacts')),
    ...Array.from({ length: 8 }, (_, i) => c(`fs${i}`, 'fatsecret')),
];

describe('buildRerankPool — the defect it exists to fix', () => {
    it('admits the FatSecret lane that a flat prefix deleted entirely', () => {
        // The old behaviour, kept literally so the regression is visible here and
        // not just in a commit message.
        expect(bySource(GRILLED_CHICKEN_BREAST.slice(0, 10)))
            .toEqual({ fdc: 2, openfoodfacts: 8 });

        const pool = buildRerankPool(GRILLED_CHICKEN_BREAST);
        expect(bySource(pool)).toEqual({ fdc: 2, openfoodfacts: 4, fatsecret: 4 });
    });

    it('gives every lane present in the input a place in the window', () => {
        const pool = buildRerankPool(GRILLED_CHICKEN_BREAST);
        for (const lane of ['fdc', 'openfoodfacts', 'fatsecret']) {
            expect(pool.some(x => x.source === lane)).toBe(true);
        }
    });
});

describe('buildRerankPool — invariants', () => {
    it('1. size is min(limit, input length) — a small lane never costs capacity', () => {
        expect(buildRerankPool(GRILLED_CHICKEN_BREAST)).toHaveLength(10);
        // One lane holds a single candidate: its slots must go to the others, not
        // be forfeited. Mutation: stop redistributing (drop the `progressed` loop
        // and take a fixed share per lane) -> this goes to 6.
        const lopsided = [c('a', 'fdc'), ...Array.from({ length: 20 }, (_, i) => c(`o${i}`, 'off'))];
        expect(buildRerankPool(lopsided)).toHaveLength(10);
        expect(buildRerankPool([c('x', 'fdc')])).toHaveLength(1);
        expect(buildRerankPool([])).toHaveLength(0);
        expect(buildRerankPool(GRILLED_CHICKEN_BREAST, 0)).toHaveLength(0);
    });

    it('2. the window is a duplicate-free subset of the input', () => {
        const pool = buildRerankPool(GRILLED_CHICKEN_BREAST);
        expect(new Set(pool.map(x => x.id)).size).toBe(pool.length);
        for (const x of pool) expect(GRILLED_CHICKEN_BREAST).toContain(x);
    });

    it('3. within-lane gather order is preserved', () => {
        const pool = buildRerankPool(GRILLED_CHICKEN_BREAST);
        const off = pool.filter(x => x.source === 'openfoodfacts').map(x => x.id);
        const fs = pool.filter(x => x.source === 'fatsecret').map(x => x.id);
        expect(off).toEqual(['off0', 'off1', 'off2', 'off3']);
        expect(fs).toEqual(['fs0', 'fs1', 'fs2', 'fs3']);
    });

    it('4. first-of-lane is stable — the caller\'s FDC estimate fallback cannot move', () => {
        // `aiNutritionEstimate` falls back to `candidatesForRerank.find(c => c.source === 'fdc')`.
        // Mutation: sort lanes by size, or reverse lane order -> the found FDC row
        // is still fdc0 (within-lane order), so this test alone is NOT sufficient;
        // it pins the consumer, and the lane-order test below pins the rest.
        const pool = buildRerankPool(GRILLED_CHICKEN_BREAST);
        expect(pool.find(x => x.source === 'fdc')!.id).toBe('fdc0');
        expect(pool.find(x => x.source === 'fatsecret')!.id).toBe('fs0');
        expect(pool.find(x => x.source === 'openfoodfacts')!.id).toBe('off0');
    });

    it('5. degenerate input reduces exactly to the old slice', () => {
        const oneLane = Array.from({ length: 20 }, (_, i) => c(`a${i}`, 'fdc'));
        expect(ids(buildRerankPool(oneLane))).toBe(ids(oneLane.slice(0, 10)));

        // Untagged candidates are ONE lane, not an error and not per-candidate
        // lanes: mis-tagging must never be able to delete a candidate.
        const untagged = Array.from({ length: 20 }, (_, i) => c(`u${i}`));
        expect(ids(buildRerankPool(untagged))).toBe(ids(untagged.slice(0, 10)));

        const nullTagged = Array.from({ length: 20 }, (_, i) => c(`n${i}`, null));
        expect(ids(buildRerankPool(nullTagged))).toBe(ids(nullTagged.slice(0, 10)));
    });

    it('untagged candidates share ONE lane even when mixed with tagged ones', () => {
        // The all-untagged case in invariant 5 cannot see this: 20 single-member
        // lanes round-robin to the same order as one 20-member lane, so it passes
        // under the mutation "every untagged candidate is its own lane". Mixing is
        // the shape that separates them — under that mutation the tagged lane is
        // outvoted 9:1 and drops from 2 members to 1. (Found by running the
        // mutation, not by reading the code: the first version of this file had
        // only the all-untagged case and the mutant survived it.)
        const mixed = [
            c('fdc0', 'fdc'), c('fdc1', 'fdc'),
            ...Array.from({ length: 12 }, (_, i) => c(`u${i}`)),
        ];
        const pool = buildRerankPool(mixed);
        expect(bySource(pool)).toEqual({ fdc: 2, '': 8 });
        expect(ids(pool)).toBe('fdc0,u0,fdc1,u1,u2,u3,u4,u5,u6,u7');
    });

    it('lane order is FIRST APPEARANCE, so no source preference is introduced', () => {
        // Same three lanes, gathered in a different order: the window must follow
        // the input, never a hardcoded ranking. Mutation: order lanes by a fixed
        // list like ['fdc','openfoodfacts','fatsecret'] -> this goes red.
        const fsFirst = [
            ...Array.from({ length: 4 }, (_, i) => c(`fs${i}`, 'fatsecret')),
            ...Array.from({ length: 4 }, (_, i) => c(`fdc${i}`, 'fdc')),
            ...Array.from({ length: 4 }, (_, i) => c(`off${i}`, 'openfoodfacts')),
        ];
        expect(ids(buildRerankPool(fsFirst, 3))).toBe('fs0,fdc0,off0');

        const fdcFirst = [
            ...Array.from({ length: 4 }, (_, i) => c(`fdc${i}`, 'fdc')),
            ...Array.from({ length: 4 }, (_, i) => c(`fs${i}`, 'fatsecret')),
            ...Array.from({ length: 4 }, (_, i) => c(`off${i}`, 'openfoodfacts')),
        ];
        expect(ids(buildRerankPool(fdcFirst, 3))).toBe('fdc0,fs0,off0');
    });

    it('input shorter than the limit is returned whole, and never mutated', () => {
        const short = [c('a', 'fdc'), c('b', 'off')];
        const pool = buildRerankPool(short);
        expect(ids(pool)).toBe('a,b');
        pool.push(c('c', 'off'));
        expect(short).toHaveLength(2);
    });

    it('RERANK_POOL_LIMIT is still the 10 the caller used to hardcode', () => {
        expect(RERANK_POOL_LIMIT).toBe(10);
    });
});

describe('rerankPoolRemainder', () => {
    it('returns exactly what the window did not take, in gather order', () => {
        const pool = buildRerankPool(GRILLED_CHICKEN_BREAST);
        const rest = rerankPoolRemainder(GRILLED_CHICKEN_BREAST, pool);

        expect(rest).toHaveLength(GRILLED_CHICKEN_BREAST.length - pool.length);
        expect(bySource(rest)).toEqual({ openfoodfacts: 10, fatsecret: 4 });

        // Disjoint from the window. This is the whole reason the remainder is
        // computed by difference: `filtered.slice(10)` would re-offer fs0..fs3 and
        // off4..off9, which the counted-noun reach-through would then push into a
        // window that already holds them. Mutation: revert to `slice(10)` -> the
        // overlap assertion below goes red with 6 duplicates.
        const inPool = new Set(pool.map(x => x.id));
        expect(rest.filter(x => inPool.has(x.id))).toEqual([]);

        // Order within the remainder is still gather order.
        expect(rest.map(x => x.id).slice(0, 3)).toEqual(['off4', 'off5', 'off6']);
    });

    it('an empty window leaves the input untouched', () => {
        expect(ids(rerankPoolRemainder(GRILLED_CHICKEN_BREAST, []))).toBe(ids(GRILLED_CHICKEN_BREAST));
    });
});
