import { buildRerankPool, rerankPoolRemainder, RERANK_POOL_LIMIT } from '../rerank-pool';

/**
 * Each block names the invariant it pins and, where the guard is a specific
 * expression, the mutation that must kill it. A test written against its own
 * author's mental model shares that model's blind spots, so the mutations were
 * actually applied and confirmed red before this file was committed.
 */

interface C { id: string; source?: string | null; semanticSimilarity?: number | null }

const c = (id: string, source?: string | null): C => ({ id, source });
/** A semantic-lane candidate. Presence of the field is the lane tag, not its value. */
const s = (id: string, source: string, sim = 0.9179): C => ({ id, source, semanticSimilarity: sim });
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

    it('5. degenerate input — ONE source AND ONE mode — reduces exactly to the old slice', () => {
        const oneLane = Array.from({ length: 20 }, (_, i) => c(`a${i}`, 'fdc'));
        expect(ids(buildRerankPool(oneLane))).toBe(ids(oneLane.slice(0, 10)));

        // The mode half of the condition is load-bearing since lane identity
        // became source x mode: one SOURCE is no longer enough to degenerate.
        const oneSourceTwoModes = [
            ...Array.from({ length: 10 }, (_, i) => c(`k${i}`, 'openfoodfacts')),
            ...Array.from({ length: 10 }, (_, i) => s(`s${i}`, 'openfoodfacts')),
        ];
        expect(ids(buildRerankPool(oneSourceTwoModes)))
            .not.toBe(ids(oneSourceTwoModes.slice(0, 10)));

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

    it('the OFF semantic block reaches the window instead of being starved', () => {
        // The measured `rolled oats` gather, 2026-08-04 (winner-diff snapshot):
        // 30 candidates, of which 16 OFF — 8 keyword then 8 semantic-only. The
        // semantic block is a clean trailing run because searchOffSemantic() is
        // pushed LAST into searchPromises and only un-deduped rows are appended.
        const ROLLED_OATS: C[] = [
            ...Array.from({ length: 2 }, (_, i) => c(`fdc${i}`, 'fdc')),
            ...Array.from({ length: 8 }, (_, i) => c(`kw${i}`, 'openfoodfacts')),
            ...Array.from({ length: 8 }, (_, i) => s(`sem${i}`, 'openfoodfacts')),
            ...Array.from({ length: 8 }, (_, i) => c(`fs${i}`, 'fatsecret')),
        ];
        // The defect, twice over. A flat prefix never reaches the semantic block:
        expect(ROLLED_OATS.slice(0, 10).filter(x => x.semanticSimilarity != null)).toHaveLength(0);
        // ...and neither did round-robin on `source` alone, because OFF was ONE
        // lane whose first 4 members are all keyword. (Grouping on source gives
        // OFF 4 slots here; its first 4 are kw0..kw3.)
        expect(ROLLED_OATS.filter(x => x.source === 'openfoodfacts').slice(0, 4)
            .filter(x => x.semanticSimilarity != null)).toHaveLength(0);

        const pool = buildRerankPool(ROLLED_OATS);
        // OFF still gets its 4 slots (invariant 6) — but spends 2 on each block
        // instead of all 4 on the keyword block. That is the entire change.
        expect(bySource(pool)).toEqual({ fdc: 2, openfoodfacts: 4, fatsecret: 4 });
        expect(pool.filter(x => x.semanticSimilarity != null).map(x => x.id))
            .toEqual(['sem0', 'sem1']);
        // Mutation: drop the mode level (group by `c.source ?? ''` only) -> zero
        // semantic rows, and this goes red.
    });

    it('a lane with no semantic path is not split, so invariant 4 cannot move', () => {
        // FDC and FatSecret have no semantic retrieval today — `semanticSimilarity`
        // has exactly one write site, searchOffSemantic(). So the FDC lane stays
        // whole and `find(c => c.source === 'fdc')` still lands on fdc0.
        const mixed = [
            ...Array.from({ length: 3 }, (_, i) => c(`fdc${i}`, 'fdc')),
            ...Array.from({ length: 6 }, (_, i) => c(`kw${i}`, 'openfoodfacts')),
            ...Array.from({ length: 6 }, (_, i) => s(`sem${i}`, 'openfoodfacts')),
            ...Array.from({ length: 6 }, (_, i) => c(`fs${i}`, 'fatsecret')),
        ];
        const pool = buildRerankPool(mixed);
        expect(pool.find(x => x.source === 'fdc')!.id).toBe('fdc0');
        expect(pool.filter(x => x.source === 'fdc').map(x => x.id)).toEqual(['fdc0', 'fdc1', 'fdc2']);
        // Per-source shares are untouched by OFF's internal split (invariant 6).
        expect(bySource(pool)).toEqual({ fdc: 3, openfoodfacts: 4, fatsecret: 3 });
    });

    it('6. splitting a source does not take capacity from a source that did not split', () => {
        // This is the invariant the FLAT form (one round-robin over source#mode)
        // violated. Gated 2026-08-04 over 253 cold seeds + 600 traffic queries:
        // the flat form moved identity the right way but pushed 29 rows into the
        // no-serving-anchor tier family against 6 out, because OFF took two slots
        // per pass and FatSecret — the source carrying real label servings —
        // dropped 3 -> 2. Nesting is what makes the split budget-neutral.
        //
        // Mutation: flatten the grouping to a single Map keyed `src + '#' + mode`
        // -> fatsecret goes 3 -> 2 and this goes red.
        const withSemantic = [
            ...Array.from({ length: 3 }, (_, i) => c(`fdc${i}`, 'fdc')),
            ...Array.from({ length: 6 }, (_, i) => c(`kw${i}`, 'openfoodfacts')),
            ...Array.from({ length: 6 }, (_, i) => s(`sem${i}`, 'openfoodfacts')),
            ...Array.from({ length: 6 }, (_, i) => c(`fs${i}`, 'fatsecret')),
        ];
        // The same input with the semantic rows relabelled as keyword: one lane
        // per source, i.e. exactly the pre-change grouping.
        const asOneLanePerSource = withSemantic.map(x => c(x.id, x.source));

        expect(bySource(buildRerankPool(withSemantic)))
            .toEqual(bySource(buildRerankPool(asOneLanePerSource)));
    });

    it('tags an OVERLAP row semantic even though it arrived by keyword — pinned, not hidden', () => {
        // gatherCandidates() keeps the KEYWORD copy at its keyword position on a
        // dedupe hit and merges the similarity onto it, so `semanticSimilarity` is
        // a SUPERSET of "arrived by semantic search". This test pins that known
        // imperfection so it stays visible: kw1 jumps lanes despite sitting in the
        // keyword block. Measured cost 2026-08-04: 50 of 1,372 flagged OFF
        // candidates (3.6%), 14 of 429 window slots. Fixing it exactly needs a
        // provenance field stamped in gather, which winner-diff cannot gate.
        const withOverlap: C[] = [
            c('kw0', 'openfoodfacts'),
            { id: 'kw1', source: 'openfoodfacts', semanticSimilarity: 0.83 },
            ...Array.from({ length: 6 }, (_, i) => c(`kw${i + 2}`, 'openfoodfacts')),
            ...Array.from({ length: 8 }, (_, i) => s(`sem${i}`, 'openfoodfacts')),
        ];
        const pool = buildRerankPool(withOverlap);
        // kw1 is FIRST of the semantic lane, ahead of every genuine semantic row.
        expect(pool.filter(x => x.semanticSimilarity != null)[0].id).toBe('kw1');
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
