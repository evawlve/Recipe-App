/**
 * rerank-pool.ts — how the pre-rerank candidate window is COMPOSED.
 *
 * WHY THIS EXISTS
 * ---------------
 * `mapIngredientWithFallback()` used to build the rerank window as
 * `filtered.slice(0, 10)`. `filtered` is in GATHER order, not score order, and
 * gatherCandidates() concatenates its lanes (FDC, then OpenFoodFacts, then the
 * FatSecret lane) rather than interleaving them. So whenever the earlier lanes
 * alone fill the window, every later lane is DELETED before simpleRerank ever
 * runs — not out-ranked, never seen.
 *
 * That is not an edge case. Measured cold over a 20-query cold-seed population
 * on 2026-08-01 (winner-diff `snapshot`, which forces production flags, so the
 * FatSecret lane is live exactly as it is on the box):
 *
 *     17 of 20 queries admitted ZERO FatSecret candidates to the window
 *     while the lane had gathered 8. `grilled chicken breast`:
 *       gathered 24 { fdc: 2, openfoodfacts: 14, fatsecret: 8 }
 *       window     { fdc: 2, openfoodfacts: 8 }
 *       deleted 14 { fatsecret: 8, openfoodfacts: 6 }
 *
 * Re-derive:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/eval/winner-diff.ts \
 *     snapshot --from-file <seeds> --out /tmp/snap.json
 *   then group each entry's `candidates` by `source`, before and after the window.
 *
 * The caller block in map-ingredient-with-fallback.ts has documented this defect
 * in a comment since the confidenceGate demotion, and named the repair it did NOT
 * want: special-casing one favoured candidate past the cutoff. That was measured
 * and reverted (it only changed WHICH rows were wrong, and turned one
 * adjudicated-wrong record into a CACHED one). This module is the repair the
 * comment asked for instead — fix the composition, not the exception.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is NOT a source preference. No lane is ranked above another and no lane is
 * guaranteed a minimum. Lanes are visited in the order they first appear in the
 * input, which IS gather order, so the only thing that changes is WHICH
 * candidates spend the window's fixed budget — never how they are then scored.
 *
 * It is NOT an admission relaxation. `|window|` is unchanged (`limit`, still 10),
 * so this cannot widen the pool the way the changes in playbook section 5a did.
 * It is a RE-COMPOSITION, and re-composition is non-monotone in both directions:
 * candidates that reach the reranker today can be evicted by it. That is a cost,
 * it is real, and it is what the winner-gate regression population is for.
 *
 * INVARIANTS (each has a test in __tests__/rerank-pool.test.ts)
 * ------------------------------------------------------------
 *  1. Size: `out.length === Math.min(limit, input.length)`.
 *  2. Subset: every element of `out` is an element of `input`, no duplicates.
 *  3. Within-lane order is preserved — a lane's candidates appear in the window
 *     in the same relative order gather produced them.
 *  4. FIRST-OF-LANE STABILITY: for any lane present in the window, the window's
 *     first member of that lane is that lane's first member in `input`. The
 *     caller depends on this: its FDC nutrition-estimate fallback takes
 *     `find(c => c.source === 'fdc')`, and that consumer must not move.
 *  5. Degenerate input (one lane, or a missing/blank `source`) reduces exactly to
 *     the old `slice(0, limit)`. A single-lane corpus sees no change at all.
 */

/** Candidates only need a lane tag; keeping this structural avoids importing
 *  gather-candidates.ts, which is not leaf-safe (playbook section 4 — read-only
 *  eval tooling must be able to import this without warming ONNX). */
export interface LaneTagged {
    source?: string | null;
    /** Retrieval score. Compared only against candidates from the SAME lane — see
     *  the within-lane ordering note in buildRerankPool(). */
    score?: number | null;
}

/** The pre-rerank window size. Was the literal `10` inside the caller. */
export const RERANK_POOL_LIMIT = 10;

/**
 * Round-robin the candidates across their retrieval lanes, preserving each
 * lane's internal (gather) order, until `limit` is reached.
 *
 * Lane identity is the raw `source` string. An absent or empty `source` is its
 * own lane rather than an error: mis-tagging a candidate must not be able to
 * delete it, and a corpus where nothing is tagged degenerates to the old
 * behaviour (invariant 5) instead of behaving unpredictably.
 */
export function buildRerankPool<T extends LaneTagged>(
    candidates: readonly T[],
    limit: number = RERANK_POOL_LIMIT,
): T[] {
    if (limit <= 0) return [];
    if (candidates.length <= limit) return candidates.slice();

    // Lane order = order of FIRST APPEARANCE in the input. This is what keeps
    // the function free of any built-in source preference: it inherits gather's
    // ordering decision rather than making one of its own.
    const lanes = new Map<string, T[]>();
    for (const c of candidates) {
        const key = c.source ?? '';
        const lane = lanes.get(key);
        if (lane) lane.push(c);
        else lanes.set(key, [c]);
    }

    // WITHIN a lane, spend the budget on the best-scoring candidates, not the
    // first-gathered ones. Gather order is not score order: measured over 194
    // real-traffic queries (2026-08-04), 21.6% had a same-lane candidate excluded
    // from the window while scoring ABOVE one that got in — `1 bottle premier
    // protein caramel` never scored an OpenFoodFacts row named "Premier Protein
    // Caramel" at 12.85 because a 5.90 row sat earlier in the lane.
    //
    // This is a WITHIN-lane comparison only, and that is what makes it safe: the
    // source score scales genuinely diverge (computeOffScore() is unbounded
    // additive, computePositionScore() is [0,1]), so a cross-lane sort would be
    // comparing incomparable numbers — the de-ranked Phase 2 item 6. Round-robin
    // still decides how many slots each lane gets; this only decides which of a
    // lane's own candidates take them.
    //
    // Sort is STABLE (ES2019+), so equal scores keep gather order.
    for (const lane of lanes.values()) {
        lane.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }

    // A single lane cannot be starved by definition, and round-robining it would
    // be an identity transform anyway. It still gets the score ordering above:
    // the budget defect is a WITHIN-lane one, so it applies just as much when
    // there is only one lane. (Before the ordering change this returned
    // `candidates.slice(0, limit)` and the whole degenerate case was a no-op.)
    if (lanes.size <= 1) return lanes.values().next().value!.slice(0, limit);

    const out: T[] = [];
    const cursors = new Map<string, number>();
    for (const key of lanes.keys()) cursors.set(key, 0);

    // Round-robin. A lane that runs dry simply stops contributing and its slots
    // go to the lanes that still have candidates — so a small lane never costs
    // the window capacity, and the size invariant holds.
    let progressed = true;
    while (out.length < limit && progressed) {
        progressed = false;
        for (const [key, lane] of lanes) {
            if (out.length >= limit) break;
            const i = cursors.get(key)!;
            if (i >= lane.length) continue;
            out.push(lane[i]);
            cursors.set(key, i + 1);
            progressed = true;
        }
    }
    return out;
}

/**
 * The candidates `buildRerankPool` did NOT take, in gather order.
 *
 * The caller walks this for the counted-noun reach-through (count-labelled SKUs
 * below the cutoff may still compete). Before this module that was
 * `filtered.slice(10)` — correct only while the window was a prefix. It is not
 * one any more, so the remainder has to be computed by difference or the
 * reach-through would re-offer candidates already in the window.
 */
export function rerankPoolRemainder<T extends LaneTagged>(
    candidates: readonly T[],
    pool: readonly T[],
): T[] {
    if (pool.length === 0) return candidates.slice();
    const taken = new Set<T>(pool);
    return candidates.filter(c => !taken.has(c));
}
