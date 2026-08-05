/**
 * The `scored_by_confidence` abstention leg's name-match term.
 *
 * ## Read this before trusting this file
 *
 * These tests DO NOT execute the leg. The leg lives inside
 * `mapIngredientWithFallback()` — a ~6,800-line function that pulls the prisma
 * client, three retrieval lanes and the LLM chokepoint through its import
 * chain — and its two thresholds are function-local `const`s, so there is no
 * exported predicate to call. What is tested here is the JUDGE
 * (`assessConfidence`) against the two threshold VALUES restated as literals.
 *
 * That means a mutation which deletes `&& fallbackNameMatch >= MIN_FALLBACK_NAME_MATCH`
 * from the caller leaves every test below GREEN. This file proves the judge
 * separates the population the way the caller assumes; it does not prove the
 * caller consults the judge. The caller-side proof is the live cold golden
 * gate (step 4 of the gate design), not a unit test.
 *
 * The literals below are duplicated from the caller on purpose and are the
 * reason this file is worth having: if someone moves MIN_FALLBACK_NAME_MATCH
 * in map-ingredient-with-fallback.ts, the drop-set claims recorded here stop
 * describing the shipped code, and the mismatch is at least visible in one
 * place rather than nowhere.
 */

import { assessConfidence, type UnifiedCandidate } from '../gather-candidates';

/**
 * Restated from the `else if (sortedFiltered.length > 0)` arm of
 * `mapIngredientWithFallback()`. NOT imported — they are function-local there.
 */
const MIN_FALLBACK_RAW_SCORE = 0.80;
const MIN_FALLBACK_NAME_MATCH = 0.60;

const candidate = (name: string, score: number, source: UnifiedCandidate['source'] = 'off'): UnifiedCandidate => ({
    id: 'test',
    source,
    name,
    score,
    rawData: {},
});

/** The predicate as the caller composes it, over the caller's own inputs. */
function callerAdmits(searchQuery: string, top: UnifiedCandidate): boolean {
    return top.score >= MIN_FALLBACK_RAW_SCORE
        && assessConfidence(searchQuery, top) >= MIN_FALLBACK_NAME_MATCH;
}

describe('T6 the fallback leg requires a name match, not just a score', () => {
    it('rejects a high-scoring candidate that shares no core token with the query', () => {
        // The headline outcome of the defect: `oatmeal` resolved to a Konjac
        // rice product. The raw OFF score clears 0.80 by a wide margin because
        // computeOffScore is unbounded additive — the raw floor is near-inert
        // for this source, which is exactly the gap the name-match term fills.
        const top = candidate('Konjac Cooked Rice oats', 9.0);

        expect(top.score).toBeGreaterThanOrEqual(MIN_FALLBACK_RAW_SCORE);
        expect(assessConfidence('oatmeal', top)).toBeLessThan(MIN_FALLBACK_NAME_MATCH);
        expect(callerAdmits('oatmeal', top)).toBe(false);
    });

    it('the raw floor alone admits it — the two terms are not redundant', () => {
        // If this ever fails, the name-match term has become dead weight and
        // the PR's narrowing claim is false.
        const top = candidate('Konjac Cooked Rice oats', 9.0);
        expect(top.score >= MIN_FALLBACK_RAW_SCORE).toBe(true);
    });

    it('still admits a candidate that genuinely covers the query', () => {
        // NARROWING-ONLY: nothing admitted before may be newly rejected unless
        // it fails the name match.
        const top = candidate('Rolled Oats', 5.9);
        expect(assessConfidence('rolled oats', top)).toBeGreaterThanOrEqual(MIN_FALLBACK_NAME_MATCH);
        expect(callerAdmits('rolled oats', top)).toBe(true);
    });

    it('the drop set is flat across [0.50, 0.60] for this case', () => {
        // The measured plateau (0.50 and 0.60 drop the identical 13 of 208)
        // is why 0.60 is not a tuned number. A case that separates the two
        // would falsify the plateau and should be added here.
        const top = candidate('Konjac Cooked Rice oats', 9.0);
        const nameMatch = assessConfidence('oatmeal', top);
        expect(nameMatch).toBeLessThan(0.50);
        expect(nameMatch).toBeLessThan(0.60);
    });

    it('the name-match term cannot LOOSEN admission — it is a conjunction', () => {
        // A candidate below the raw floor stays rejected however well it
        // matches by name, so this edit cannot admit anything baseline did not.
        const top = candidate('Rolled Oats', 0.4);
        expect(assessConfidence('rolled oats', top)).toBeGreaterThanOrEqual(MIN_FALLBACK_NAME_MATCH);
        expect(callerAdmits('rolled oats', top)).toBe(false);
    });
});
