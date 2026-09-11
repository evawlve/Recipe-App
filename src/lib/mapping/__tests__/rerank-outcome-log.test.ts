/**
 * LOG-ONLY INSTRUMENT (2026-09-11, Lane A S47): the rerank outcome and the
 * scored pool are carried into the mapping-analysis entry.
 *
 * WHY THIS FILE EXISTS. The rerank scores were computed and dropped: the only
 * place they ever appeared was `logger.debug('simple_rerank.result', …)`, and
 * the box runs at `warn`. So "why did this record win" was unanswerable from
 * the corpus — the analysis file's `topCandidates[].score` is the raw RETRIEVAL
 * score, which the reranker clamps at `Math.min(score, 1) * ORIGINAL_SCORE`,
 * collapsing a whole band of above-1.0 retrieval scores onto one value.
 *
 * THE ONE PROPERTY THAT MATTERS, and the reason this is a test and not a
 * comment: a log that names a winner the function did not return is worse than
 * no log. That already happened in this file — `simple_rerank.sole_survivor`
 * was emitted ABOVE the confidence gate and reported `reason: sole_survivor` on
 * rows the function then returned as `confidence_below_threshold` with a null
 * winner, so it over-counted wins and hid the very property it was offered as
 * evidence for. The debug line still fires above the gate. `rerankOutcome` is
 * built BELOW it, and the first describe block pins that it can never disagree
 * with the return.
 */

import { simpleRerank, type RerankCandidate } from '../simple-rerank';

function cand(id: string, name: string, score: number, over: Partial<RerankCandidate> = {}): RerankCandidate {
    return { id, name, score, source: 'fatsecret', ...over };
}

describe('rerankOutcome agrees with the value simpleRerank actually returned', () => {
    // The invariant, asserted on every shape below rather than once: whatever
    // the function returns, the recorded outcome says the same thing.
    function assertAgrees(result: ReturnType<typeof simpleRerank>) {
        expect(result.rerankOutcome.winner).toBe(result.winner?.id ?? null);
        expect(result.rerankOutcome.confidence).toBe(result.confidence);
        expect(result.rerankOutcome.reason).toBe(result.reason);
    }

    it('agrees on a clean multi-candidate win', () => {
        const result = simpleRerank('almond milk', [
            cand('a', 'Almond Milk', 0.9),
            cand('b', 'Almond Cashew Milk Blend', 0.8),
        ], undefined, 'almond milk');
        expect(result.winner).not.toBeNull();
        assertAgrees(result);
    });

    it('agrees when the confidence gate REFUSES the top-scored candidate', () => {
        // A pool whose best retrieval score is low enough that
        // 0.5 + score*0.5 lands under MIN_RERANK_CONFIDENCE (0.70).
        const result = simpleRerank('burger relish', [
            cand('x', 'Black Bean Burger', 0.10),
            cand('y', 'Veggie Burger Patty', 0.08),
        ], undefined, 'burger relish');
        expect(result.winner).toBeNull();
        expect(result.reason).toBe('confidence_below_threshold');
        assertAgrees(result);

        // THE DISTINCTION THE DEBUG LINE CANNOT MAKE: the reranker DID rank
        // something first, and the gate refused it. `winner` is null; `winnerId`
        // names the refused candidate. That pair is the `under_gate:simple_rerank`
        // class, and reading `winnerId` as "what won" is the bug this pins.
        expect(result.rerankOutcome.winnerId).not.toBeNull();
        expect(result.rerankOutcome.winnerScore).not.toBeNull();
        expect(result.rerankOutcome.scoredCount).toBeGreaterThan(0);
    });

    it('agrees on the single-candidate short-circuit', () => {
        const result = simpleRerank('almond milk', [cand('solo', 'Almond Milk', 0.95)], undefined, 'almond milk');
        expect(result.reason).toBe('single_candidate');
        assertAgrees(result);
    });

    it('agrees on an empty pool', () => {
        const result = simpleRerank('almond milk', [], undefined, 'almond milk');
        expect(result.winner).toBeNull();
        assertAgrees(result);
        expect(result.rerankOutcome.reason).toBe('no_candidates');
    });
});

describe('rerankPool records what the reranker scored, not what retrieval ranked', () => {
    it('carries one entry per scored candidate, keyed by foodId', () => {
        const result = simpleRerank('almond milk', [
            cand('a', 'Almond Milk', 0.9),
            cand('b', 'Almond Cashew Milk Blend', 0.8),
            cand('c', 'Sweetened Almond Milk', 0.7),
        ], undefined, 'almond milk');

        expect(result.rerankPool).toHaveLength(result.rerankOutcome.scoredCount);
        expect(result.rerankPool.map(p => p.foodId).sort()).toEqual(['a', 'b', 'c']);
        // Every id is unique — the pool is keyed by foodId, so a duplicate would
        // make a census join silently double-count.
        expect(new Set(result.rerankPool.map(p => p.foodId)).size).toBe(result.rerankPool.length);
    });

    it('does NOT echo the retrieval score — the clamp is why this instrument exists', () => {
        // Two candidates whose RETRIEVAL scores differ above 1.0. The reranker
        // consumes `Math.min(score, 1) * ORIGINAL_SCORE`, so that difference is
        // gone by the time it ranks — which is exactly why reading
        // `topCandidates[].score` never answered "why did this one win".
        const hi = simpleRerank('almond milk', [
            cand('a', 'Almond Milk', 5.9),
            cand('b', 'Almond Milk', 1.4),
        ], undefined, 'almond milk');
        const poolA = hi.rerankPool.find(p => p.foodId === 'a')!;
        const poolB = hi.rerankPool.find(p => p.foodId === 'b')!;
        expect(poolA.score).not.toBe(5.9);
        expect(poolB.score).not.toBe(1.4);
        // Both retrieval scores are above the clamp, so their ORIGINAL_SCORE
        // contribution is identical and the pool cannot separate them on it.
        expect(poolA.score).toBeCloseTo(poolB.score, 10);
    });

    it('gap is winnerScore - effectiveRunnerUpScore, and the winner is in the pool', () => {
        const result = simpleRerank('almond milk', [
            cand('a', 'Almond Milk', 0.95),
            cand('b', 'Almond Cashew Milk Blend', 0.60),
        ], undefined, 'almond milk');
        const o = result.rerankOutcome;
        expect(o.gap).toBeCloseTo(o.winnerScore! - o.effectiveRunnerUpScore!, 10);
        const winnerEntry = result.rerankPool.find(p => p.foodId === o.winnerId);
        expect(winnerEntry).toBeDefined();
        expect(winnerEntry!.score).toBe(o.winnerScore);
    });

    it('is EMPTY with null scores on the short-circuit paths, and scoredCount says so', () => {
        // `scoredCount: 0` with `candidateCount > 0` means the reranker ran and
        // short-circuited on the raw retrieval score — NOT that it scored and
        // found nothing. A census that conflates the two mis-sizes every rate.
        const single = simpleRerank('almond milk', [cand('solo', 'Almond Milk', 0.95)], undefined, 'almond milk');
        expect(single.rerankPool).toEqual([]);
        expect(single.rerankOutcome.scoredCount).toBe(0);
        expect(single.rerankOutcome.candidateCount).toBe(1);
        expect(single.rerankOutcome.winnerScore).toBeNull();
        expect(single.rerankOutcome.gap).toBeNull();

        const none = simpleRerank('almond milk', [], undefined, 'almond milk');
        expect(none.rerankPool).toEqual([]);
        expect(none.rerankOutcome.scoredCount).toBe(0);
        expect(none.rerankOutcome.candidateCount).toBe(0);
    });
});
