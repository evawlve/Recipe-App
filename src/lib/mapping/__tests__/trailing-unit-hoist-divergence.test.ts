import { TRAILING_UNIT_REGEX } from '../serving/hydration-lane';
import { WEIGHT_UNIT_REGEX, VOLUME_UNIT_REGEX } from '../map-ingredient-with-fallback';

/**
 * Pins the 1d hoist's latent divergence CLOSED (log/2026-08-07_0230, Findings).
 *
 * hydrateAndSelectServing() mutates parsed.unit — trailing-unit recovery sets
 * it from TRAILING_UNIT_REGEX when it was falsy — but the 1d-hoisted
 * isWeightUnit / isVolumeUnit flags in the mapper evaluate parsed.unit BEFORE
 * that mutation runs. The hoist is behaviour-preserving TODAY only because
 * every trailing-unit token fails both unit regexes: a pre-mutation `false`
 * and a post-mutation `false` agree. The moment the trailing-unit set gains a
 * token that reads as a weight or volume unit, the hoisted flags and the
 * pre-1d semantics diverge on live traffic with no test noticing — except
 * this one.
 *
 * All three operands are the REAL production symbols, exported from the
 * modules that execute them — never re-transcribed copies. A copy would pin
 * the author's snapshot, not the code, and drift silently when either side
 * moves: the exact class #249 killed for servingTier predicates.
 *
 * MUTATION (executed before commit, confirmed red): add a weight token to
 * TRAILING_UNIT_REGEX in hydration-lane.ts — e.g.
 * /\b(bunch|head|stalk|oz)\b/i — and the `oz` row of the disjointness test
 * dies. Equivalently, adding `bunch` to WEIGHT_UNIT_REGEX kills the `bunch`
 * row.
 */

/**
 * Extract the alternation tokens from a single-group regex like
 * /\b(bunch|head|stalk)\b/i. Reads the regex's own source so the tested set
 * IS the shipped set. Fails closed: no group, or a token that is not a plain
 * lowercase word, red-flags in the shape test below rather than passing
 * vacuously.
 */
function alternationTokens(re: RegExp): string[] {
    const group = re.source.match(/\(([^()]*)\)/);
    if (!group) return [];
    return group[1].split('|');
}

const trailingUnitTokens = alternationTokens(TRAILING_UNIT_REGEX);

describe('trailing-unit recovery set vs the 1d-hoisted unit-class flags', () => {
    it('extracts a non-empty set of plain-word tokens from the real regex (fail-closed)', () => {
        expect(trailingUnitTokens.length).toBeGreaterThan(0);
        for (const token of trailingUnitTokens) {
            // A token with regex metacharacters (e.g. `fl\s*oz`) would make the
            // per-token disjointness test below meaningless as a string probe —
            // force human attention instead of a vacuous green.
            expect(token).toMatch(/^[a-z]+$/);
        }
    });

    // The recovery site lowercases the matched token before assigning
    // parsed.unit, and both unit regexes are ^…$-anchored with /i — so
    // testing the bare token is exactly the predicate the hoisted flags
    // would apply post-mutation.
    it.each(trailingUnitTokens)(
        'trailing unit %j must match neither WEIGHT_UNIT_REGEX nor VOLUME_UNIT_REGEX',
        (token) => {
            expect(WEIGHT_UNIT_REGEX.test(token)).toBe(false);
            expect(VOLUME_UNIT_REGEX.test(token)).toBe(false);
        },
    );
});
