import { readFileSync } from 'fs';
import { join } from 'path';
import {
    servingAiCallForTier,
    SERVING_AI_TIERS,
    isReplayNondeterministicTier,
    REPLAY_NONDETERMINISTIC_SERVING_TIERS,
} from '../serving-ai-tiers';

/**
 * Each block names the mutation that must kill it. The mutations below were
 * actually applied and confirmed red before this file was committed — a test
 * written against its own author's mental model shares that model's blind spots.
 *
 * The defect class this guards is specific: the `servingTier` strings are NOT a
 * reliable guide to whether a model ran, in EITHER direction. Anyone who
 * "simplifies" the allowlist into a name pattern reintroduces both halves at once,
 * so the two traps get a test each.
 */

describe('servingAiCallForTier — tiers whose producer calls an LLM', () => {
    // MUTATION: delete `fdc_size_estimate` from SERVING_AI_TIERS, or replace the
    // allowlist with a /ai/ substring test. Either makes this red.
    it('reports the largest AI tier, whose name contains no "ai" at all', () => {
        // getOrCreateFdcSizeServings() has no cache — every event is a live call.
        expect(servingAiCallForTier('fdc_size_estimate')).toEqual({ called: true, type: 'produce' });
        expect(servingAiCallForTier('fdc_medium_estimate')).toEqual({ called: true, type: 'produce' });
    });

    it('reports the explicitly-named AI tiers with their purpose', () => {
        expect(servingAiCallForTier('count_unit_ai')).toEqual({ called: true, type: 'ambiguous' });
        expect(servingAiCallForTier('fdc_volume_ai')).toEqual({ called: true, type: 'weight' });
        expect(servingAiCallForTier('fdc_piece_ai')).toEqual({ called: true, type: 'produce' });
    });
});

describe('servingAiCallForTier — tiers that must NOT be reported', () => {
    // MUTATION: add `ai_generated_serving: 'ambiguous'` to SERVING_AI_TIERS — the
    // reading a name-based rule would produce. This is the over-reporting half:
    // getAiServingGrams() only reads AiGeneratedServing rows and does unit maths.
    it('does not invent a call for `ai_generated_serving`, which runs no model', () => {
        expect(servingAiCallForTier('ai_generated_serving')).toEqual({ called: false });
    });

    // MUTATION: map either cached sibling to its AI counterpart's type. These are
    // cache HITS of `count_unit_ai` / `fdc_volume_ai` and cost nothing.
    it('does not count the cached siblings of AI tiers', () => {
        expect(servingAiCallForTier('count_unit_cached')).toEqual({ called: false });
        expect(servingAiCallForTier('fdc_volume_cached')).toEqual({ called: false });
    });

    it('does not count deterministic label/weight tiers', () => {
        for (const tier of ['weight_unit', 'label_unit_match', 'bare_label_serving', 'flat_100g_default']) {
            expect(servingAiCallForTier(tier)).toEqual({ called: false });
        }
    });
});

describe('servingAiCallForTier — the legacy-cascade blind spot', () => {
    // MUTATION: return `{}` or `undefined` for an absent tier instead of
    // `{ called: false }`. The whole point of 0.5(b) is telling "resolved without a
    // model" apart from "never populated", and an absent field collapses them.
    it('returns an explicit called:false for an unstamped tier, never undefined', () => {
        expect(servingAiCallForTier(undefined)).toEqual({ called: false });
        expect(servingAiCallForTier(null)).toEqual({ called: false });
        expect(servingAiCallForTier('')).toEqual({ called: false });
    });

    it('has no `type` when nothing was called, so the log cannot imply a purpose', () => {
        expect(servingAiCallForTier('weight_unit').type).toBeUndefined();
    });
});

describe('SERVING_AI_TIERS — the table itself', () => {
    // MUTATION: drop Object.freeze. A caller mutating the shared table would
    // silently change every later line's telemetry in the same process.
    it('is frozen', () => {
        expect(Object.isFrozen(SERVING_AI_TIERS)).toBe(true);
    });

    // MUTATION: widen the union in serving-ai-tiers.ts without updating
    // mapping-logger.ts's `aiCalls.serving.type`. Types are erased at runtime, so
    // only an explicit assertion catches the drift.
    it('emits only the three purposes mapping-logger.ts declares', () => {
        expect(new Set(Object.values(SERVING_AI_TIERS)))
            .toEqual(new Set(['ambiguous', 'produce', 'weight']));
    });
});

/**
 * THE REPLAY-NONDETERMINISM PREDICATE — the offline instruments' half.
 *
 * winner-diff.ts and correctness-screen.ts each carried a PRIVATE regex for this
 * (`/(^|_)ai(_|$)|estimate/i` and `/(^|_)ai(_|$)|estimat/i`). The visible symptom
 * was that they disagreed; the actual defect was the half they agreed on, because
 * a name pattern silently returns false for a tier it has never seen.
 */
describe('isReplayNondeterministicTier — the two tiers both regexes missed', () => {
    // MUTATION: delete 'discrete_unit_backfill' from the set. This goes red.
    // Producer: getOrCreateAmbiguousServing(), the SAME call as `count_unit_ai`,
    // but this branch stamps one name for both `success` and `cached`, so no
    // name-based rule can ever separate them. 1,269 of 69,529 events.
    it('flags `discrete_unit_backfill`, which neither retired regex matched', () => {
        expect(isReplayNondeterministicTier('discrete_unit_backfill')).toBe(true);
        expect(/(^|_)ai(_|$)|estimate/i.test('discrete_unit_backfill')).toBe(false);
        expect(/(^|_)ai(_|$)|estimat/i.test('discrete_unit_backfill')).toBe(false);
    });

    // MUTATION: delete 'fdc_size_qualifier'. Producer: getOrCreateFdcSizeServings(),
    // uncached by construction — the same function behind `fdc_size_estimate` and
    // `fdc_medium_estimate`, both of which the old regexes DID match on 'estimat'.
    // 345 events. Missing it was a pure naming accident.
    it('flags `fdc_size_qualifier`, off the same uncached producer as two members', () => {
        expect(isReplayNondeterministicTier('fdc_size_qualifier')).toBe(true);
        expect(/(^|_)ai(_|$)|estimate/i.test('fdc_size_qualifier')).toBe(false);
        expect(/(^|_)ai(_|$)|estimat/i.test('fdc_size_qualifier')).toBe(false);
    });
});

describe('isReplayNondeterministicTier — tiers an ADJACENCY scan wrongly nominates', () => {
    /**
     * These four were nominated by scanning for tier literals within 55 lines of an
     * AI producer call, and all four are REFUTED by reading the branch that stamps
     * them — each sits in a sibling `else` that never reads the AI result:
     *
     *   volume_unit         5,379  the `!volumeResolved` hardcoded-density fallback
     *   bare_plural_serving 2,268  the `!unit && integer qty` branch
     *   bare_sibling_serving 2,230 the (C2) same-brand sibling MEDIAN — a DB read
     *   bare_query_default    463  the bare-query inflation guard, a separate block
     *
     * Together they are 10,340 events. Marking them nondeterministic would silence
     * D5/D6 and winner-diff on 15% of the corpus — the instrument going quiet is the
     * expensive failure here, not the loud one.
     *
     * MUTATION: add any one of them to the set. This goes red.
     */
    it('does not flag the four sibling-branch tiers', () => {
        for (const tier of ['volume_unit', 'bare_plural_serving', 'bare_sibling_serving', 'bare_query_default']) {
            expect(isReplayNondeterministicTier(tier)).toBe(false);
        }
    });

    it('does not flag the cached siblings, which are pure row reads', () => {
        expect(isReplayNondeterministicTier('count_unit_cached')).toBe(false);
        expect(isReplayNondeterministicTier('fdc_volume_cached')).toBe(false);
    });

    it('treats an absent tier as deterministic, matching both retired regexes', () => {
        // The legacy cascade stamps no tier at all (535 live rows). Both instruments
        // read that as "judge it", and this edit deliberately does not change that —
        // flipping it is a separate decision with its own blast radius.
        expect(isReplayNondeterministicTier(null)).toBe(false);
        expect(isReplayNondeterministicTier(undefined)).toBe(false);
        expect(isReplayNondeterministicTier('')).toBe(false);
    });
});

describe('the two predicates are related but NOT equal', () => {
    // MUTATION: replace isReplayNondeterministicTier's body with
    // `servingAiCallForTier(tier).called`. This goes red on both directions below.
    it('every BILLED tier is also replay-nondeterministic (billing ⊆ nondeterminism)', () => {
        // The durable invariant: a future addition to SERVING_AI_TIERS that is not
        // also added here would leave an instrument charging model noise to a change.
        for (const tier of Object.keys(SERVING_AI_TIERS)) {
            expect(isReplayNondeterministicTier(tier)).toBe(true);
        }
    });

    it('but not the reverse — three members bill nothing through SERVING_AI_TIERS', () => {
        // ai_generated_serving: runs no model, reads a model-WRITTEN row.
        // discrete_unit_backfill / fdc_size_qualifier: deliberately not added to the
        // billing allowlist (see the module header) — it has its own owner doc.
        for (const tier of ['ai_generated_serving', 'discrete_unit_backfill', 'fdc_size_qualifier']) {
            expect(isReplayNondeterministicTier(tier)).toBe(true);
            expect(servingAiCallForTier(tier).called).toBe(false);
        }
    });

    /**
     * The first cut of this exported it as `Object.freeze(new Set([...]))` and
     * asserted `Object.isFrozen()`. That assertion was GREEN and the guard did not
     * hold: freezing a Set stops nothing, because its contents are internal slots,
     * not own properties — `isFrozen` returns true and `.add()` still works. Asserted
     * here as BEHAVIOUR (does a mutation actually fail?) rather than as a property,
     * which is the only form that could have caught it.
     *
     * MUTATION: drop the Object.freeze wrapper in serving-ai-tiers.ts. Red.
     */
    it('rejects mutation for real, not just to Object.isFrozen', () => {
        expect(Object.isFrozen(REPLAY_NONDETERMINISTIC_SERVING_TIERS)).toBe(true);
        const before = REPLAY_NONDETERMINISTIC_SERVING_TIERS.length;
        expect(() => (REPLAY_NONDETERMINISTIC_SERVING_TIERS as string[]).push('x')).toThrow(TypeError);
        expect(REPLAY_NONDETERMINISTIC_SERVING_TIERS.length).toBe(before);
    });

    it('has no duplicate members', () => {
        expect(new Set(REPLAY_NONDETERMINISTIC_SERVING_TIERS).size)
            .toBe(REPLAY_NONDETERMINISTIC_SERVING_TIERS.length);
    });
});

/**
 * THE DURABLE HALF. Correcting two tiers is a one-off; this is the guard that makes
 * the NEXT missed tier impossible to add silently.
 *
 * An allowlist has the same failure mode as a regex — it returns false for a tier
 * nobody classified. What it cannot do on its own is notice that a new AI PRODUCER
 * appeared. So pin the call-site counts: adding a call to any of these four
 * functions trips this test, and whoever adds it must decide which tier it stamps
 * and whether that tier belongs in the set above.
 *
 * These counts are the reason this fix is not just "two more strings".
 */
describe('producer call-site census — the guard against the next silent miss', () => {
    const SRC = join(__dirname, '..', '..', '..', '..', 'src');

    // Counts measured 2026-08-05 on master @ 93a6219. Re-derive:
    //   grep -rn "await <fn>(" src/ | grep -v __tests__ | wc -l
    const EXPECTED: Record<string, number> = {
        getOrCreateAmbiguousServing: 7,
        getOrCreateFdcSizeServings: 3,
        insertFdcAiServing: 1,
        estimateAmbiguousServing: 4,
    };

    function countCallSites(fn: string): number {
        const out: string[] = [];
        const walk = (dir: string) => {
            for (const e of require('fs').readdirSync(dir, { withFileTypes: true })) {
                const p = join(dir, e.name);
                if (e.isDirectory()) {
                    if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p);
                } else if (e.name.endsWith('.ts')) {
                    out.push(p);
                }
            }
        };
        walk(SRC);
        let n = 0;
        for (const f of out) {
            for (const line of readFileSync(f, 'utf8').split('\n')) {
                if (line.includes(`await ${fn}(`)) n++;
            }
        }
        return n;
    }

    for (const [fn, expected] of Object.entries(EXPECTED)) {
        // MUTATION: add or remove any call to one of these functions in src/.
        it(`${fn} still has exactly ${expected} call site(s) outside tests`, () => {
            expect(countCallSites(fn)).toBe(expected);
        });
    }
});
