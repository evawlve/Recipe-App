import { servingAiCallForTier, SERVING_AI_TIERS } from '../serving-ai-tiers';

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
