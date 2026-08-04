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
 *  5. Degenerate input (ONE lane — i.e. one source AND one retrieval mode, or a
 *     missing/blank `source` with no semantic hits) reduces exactly to the old
 *     `slice(0, limit)`.
 *  6. PER-SOURCE BUDGET NEUTRALITY: the number of candidates each `source`
 *     contributes is exactly what it contributed when lanes were `source` alone.
 *     Splitting a source's lane changes WHICH of its rows are picked, never HOW
 *     MANY, so it cannot take capacity from a source that did not split. This is
 *     the invariant that separates this design from the flat one — see below.
 *
 * LANE IDENTITY IS `source` x RETRIEVAL MODE, NESTED
 * ---------------------------------------------------
 * Grouping on `source` alone left the founding defect intact one level down.
 * The OFF lane is not one ranked list: gatherCandidates() pushes
 * `searchOffSemantic()` LAST, so an OFF lane is two already-sorted blocks
 * concatenated — keyword hits, then the semantic-only tail — and
 * `computeOffScore()` sorts within each block but never across the join. When
 * the keyword block alone fills the OFF budget the semantic block is
 * structurally unreachable, which is exactly the starvation this module was
 * built to fix. Splitting the lane gives the semantic block its own slots, with
 * no score comparison at all — but the split must be NESTED under `source`, not
 * flattened into it.
 *
 * The flat form (`lane = source + '#' + mode`, one round-robin) was built and
 * gated FIRST, and it failed on exactly the axis invariant 6 now protects.
 * Measured 2026-08-04 over 253 enriched cold seeds and 600 real-traffic queries,
 * `--with-serving`, 0/0/0 noise floor on both trees: identity moved the right
 * way (branded -> generic 74:1 cold, 48:7 traffic) while the BILLED NUMBER moved
 * the wrong way — 29 rows into the no-serving-anchor tier family against 6 out,
 * 40 rows losing a FatSecret label serving. The cause was arithmetic, not
 * ranking: two lanes for OpenFoodFacts meant two slots per pass, so on a budget
 * of 10 FatSecret dropped 3 -> 2, and FatSecret rows are the ones carrying real
 * label servings. Nesting keeps the identity win and returns the budget. Do not
 * "simplify" this back to a flat key.
 *
 * `semanticSimilarity` is a SUPERSET of "arrived by semantic search", not a
 * partition: on a dedupe hit gather keeps the KEYWORD copy at its keyword
 * position and merges the similarity onto it, so an overlap row is tagged
 * semantic while sitting in the keyword block. That misattribution is real and
 * measured small — 71 of 1,745 flagged OFF candidates (4.1%), costing 14 of 382
 * window slots under this nested form (20 of 551 under the flat one), over 241
 * usable rows from 253 cold seeds enriched for this defect on 2026-08-04.
 * Re-derive:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/eval/_lane_identity_probe.ts \
 *     --snapshot <snap.json> --replay <replay.json> --variant nested
 * An exact discriminator would be a provenance field stamped at retrieval time,
 * but that is a change inside gather — which winner-diff structurally cannot
 * gate (its pool is frozen at gather's output, blind spot (A)), and which
 * winner-gate.sh aborts on by design.
 *
 * FDC and FatSecret have no semantic path today, so their lane identity is
 * unchanged and invariant 4's consumer (`find(c => c.source === 'fdc')`) cannot
 * move. Re-derive: `semanticSimilarity` has exactly one write site outside
 * gather, `searchOffSemantic()` in src/lib/openfoodfacts/search.ts.
 */

/** Candidates need a lane tag and a retrieval-mode tag; keeping this structural
 *  avoids importing gather-candidates.ts, which is not leaf-safe (playbook
 *  section 4 — read-only eval tooling must be able to import this without
 *  warming ONNX). */
export interface LaneTagged {
    source?: string | null;
    /** Set by semantic retrieval, or merged on at dedupe when keyword and
     *  semantic search agree. Presence, not magnitude, is the lane tag. */
    semanticSimilarity?: number | null;
}

/** The pre-rerank window size. Was the literal `10` inside the caller. */
export const RERANK_POOL_LIMIT = 10;

/**
 * Which retrieval block a candidate came from, within its source.
 *
 * Presence of `semanticSimilarity`, not its magnitude, is the tag. Exported and
 * used by the grouping below, so the eval harness can reproduce a window without
 * transcribing the rule — a ported rule that drifts from this one silently
 * invalidates every number taken from it.
 */
export function laneMode(c: LaneTagged): 's' | 'k' {
    return c.semanticSimilarity != null ? 's' : 'k';
}

/**
 * Round-robin the candidates across their retrieval lanes, preserving each
 * lane's internal (gather) order, until `limit` is reached.
 *
 * Lane identity is the raw `source` string crossed with retrieval mode. An
 * absent or empty `source` is its own lane rather than an error: mis-tagging a
 * candidate must not be able to delete it, and a corpus where nothing is tagged
 * degenerates to the old behaviour (invariant 5) instead of behaving
 * unpredictably.
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
    //
    // TWO LEVELS, and the nesting is the whole design. The outer level is
    // `source`, so every source gets exactly the share it gets today. The inner
    // level is retrieval mode, so a source's own budget is split across its
    // blocks instead of being spent entirely on whichever block gather emitted
    // first. Flattening this to one round-robin over `source x mode` is the
    // obvious version and it is WRONG: it hands a split source two slots per
    // pass, which it takes from the sources that did not split. Measured
    // 2026-08-04 — that form moved 57 of 108 cold winners off FatSecret onto
    // OpenFoodFacts and pushed 29 rows into the no-serving-anchor tier family
    // against 6 out, because FatSecret rows are the ones carrying real label
    // servings. Identity improved and the billed number got worse.
    const sources = new Map<string, Map<string, T[]>>();
    for (const c of candidates) {
        const src = c.source ?? '';
        let modes = sources.get(src);
        if (!modes) { modes = new Map(); sources.set(src, modes); }
        const mode = laneMode(c);
        const bucket = modes.get(mode);
        if (bucket) bucket.push(c);
        else modes.set(mode, [c]);
    }

    // A single lane cannot be starved by definition, and round-robining it would
    // be an identity transform anyway. Return early so the degenerate case is
    // provably byte-identical to the old slice. "Single lane" now means one
    // source AND one mode — a lone source split across both blocks still needs
    // interleaving, which is the whole point.
    if (sources.size <= 1) {
        const only = sources.values().next().value;
        if (!only || only.size <= 1) return candidates.slice(0, limit);
    }

    const out: T[] = [];
    /** Per source: which mode to draw from next, and how far into each mode. */
    const modeCursor = new Map<string, number>();
    const cursors = new Map<string, number>();

    // Round-robin over SOURCES. A source that runs dry stops contributing and its
    // slots go to the sources that still have candidates — so a small source
    // never costs window capacity and the size invariant holds. Within a source,
    // rotate through its modes so neither block can monopolise its budget.
    let progressed = true;
    while (out.length < limit && progressed) {
        progressed = false;
        for (const [src, modes] of sources) {
            if (out.length >= limit) break;
            const modeKeys = [...modes.keys()];
            let taken = false;
            // Try each mode once, starting at this source's rotation point, so a
            // drained mode yields its turn to the other instead of the source
            // forfeiting the slot.
            for (let n = 0; n < modeKeys.length && !taken; n++) {
                const mk = modeKeys[((modeCursor.get(src) ?? 0) + n) % modeKeys.length];
                const ck = `${src} ${mk}`;
                const i = cursors.get(ck) ?? 0;
                const bucket = modes.get(mk)!;
                if (i >= bucket.length) continue;
                out.push(bucket[i]);
                cursors.set(ck, i + 1);
                modeCursor.set(src, ((modeCursor.get(src) ?? 0) + n + 1) % modeKeys.length);
                taken = true;
            }
            if (taken) progressed = true;
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
