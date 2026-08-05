/**
 * Unit tests for the Phase 0.5(c) usage counters.
 *
 * The load-bearing pair is "a missing usage object is not a zero" + "an explicit zero usage IS a
 * zero". Those two together are the DNB-7 property: a missing MEASUREMENT and a real ZERO must not
 * read alike. Every fail-open instrument in this repo's history collapsed exactly that distinction.
 */

import {
    recordLlmResponse,
    recordLlmFailure,
    recordLlmLogicalSuccess,
    getLlmUsageSnapshot,
    resetLlmUsageMetrics,
} from '../llm-usage-metrics';
import { STRUCTURED_LLM_PURPOSES } from '../llm-purposes';

/**
 * A real OpenRouter body's `usage` block, shape and values as returned for a small
 * `openai/gpt-4o-mini` normalize call. `cost` is OpenRouter's own accounting field.
 */
const REAL_USAGE = {
    prompt_tokens: 41,
    completion_tokens: 6,
    total_tokens: 47,
    cost: 9.6525e-6,
};

beforeEach(() => {
    resetLlmUsageMetrics();
});

describe('llm-usage-metrics: the counter store', () => {
    it('pre-seeds byPurpose with exactly the 7 STRUCTURED_LLM_PURPOSES, all zeroed', () => {
        const snap = getLlmUsageSnapshot();
        expect(Object.keys(snap.byPurpose).sort()).toEqual([...STRUCTURED_LLM_PURPOSES].sort());
        expect(Object.keys(snap.byPurpose)).toHaveLength(7);
        for (const purpose of STRUCTURED_LLM_PURPOSES) {
            expect(snap.byPurpose[purpose]).toEqual({
                responses: 0,
                logicalSuccesses: 0,
                failures: 0,
                unparseableEnvelopes: 0,
                usageReported: 0,
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                costReported: 0,
                costUsd: 0,
            });
        }
        // A purpose present-and-zero is a different claim from a purpose absent. `produce` has no
        // call site at all (see llm-purposes.ts), so its zero is STRUCTURAL, not a measurement.
        expect(snap.byPurpose.produce).toBeDefined();
    });

    it('carries since and pid, which are how a reader detects a restart', () => {
        const snap = getLlmUsageSnapshot();
        expect(typeof snap.since).toBe('string');
        expect(Number.isNaN(Date.parse(snap.since))).toBe(false);
        expect(snap.pid).toBe(process.pid);
    });

    it('returns a deep copy, so a reader cannot mutate the live counters', () => {
        const snap = getLlmUsageSnapshot();
        snap.byPurpose.normalize.responses = 999;
        expect(getLlmUsageSnapshot().byPurpose.normalize.responses).toBe(0);
    });
});

describe('llm-usage-metrics: recording a billed response', () => {
    it('sums a full OpenRouter usage block into both byPurpose and byModel', () => {
        recordLlmResponse({ purpose: 'normalize', model: 'openai/gpt-4o-mini', usage: REAL_USAGE });
        const snap = getLlmUsageSnapshot();

        expect(snap.byPurpose.normalize).toMatchObject({
            responses: 1,
            usageReported: 1,
            promptTokens: 41,
            completionTokens: 6,
            totalTokens: 47,
            costReported: 1,
            costUsd: 9.6525e-6,
        });
        // byModel is keyed by the MODEL string, never provider.name — the box's `openai` provider
        // label is OpenRouter serving whatever model was asked for, so a provider-keyed cost
        // number would be wrong by construction.
        expect(snap.byModel['openai/gpt-4o-mini']).toMatchObject({
            responses: 1,
            usageReported: 1,
            totalTokens: 47,
        });
    });

    it('a missing usage object is not a zero', () => {
        // MUTATION TARGET: making `usageReported++` fire unconditionally kills this test.
        recordLlmResponse({ purpose: 'normalize', model: 'openai/gpt-4o-mini', usage: undefined });
        const snap = getLlmUsageSnapshot();
        expect(snap.byPurpose.normalize.responses).toBe(1);
        expect(snap.byPurpose.normalize.usageReported).toBe(0);
        expect(snap.byPurpose.normalize.totalTokens).toBe(0);
        // usageReported 0 with responses 1 reads as NO USAGE DATA, not as zero tokens.
    });

    it('an explicit zero usage IS a zero', () => {
        recordLlmResponse({
            purpose: 'normalize',
            model: 'openai/gpt-4o-mini',
            usage: { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 },
        });
        const snap = getLlmUsageSnapshot();
        expect(snap.byPurpose.normalize.responses).toBe(1);
        expect(snap.byPurpose.normalize.usageReported).toBe(1);
        expect(snap.byPurpose.normalize.totalTokens).toBe(0);
    });

    it('an unparseable envelope is a billed response with its own field, not a missing usage block', () => {
        // MUTATION TARGET: drop the `envelopeUnparsed` increment and this dies. The distinction it
        // buys: `usageReported < responses` normally means "the provider omitted usage", but for
        // these there was never a body to read, so the shortfall has a different cause and must
        // not be attributed to the provider.
        recordLlmResponse({
            purpose: 'normalize',
            model: 'openai/gpt-4o-mini',
            usage: undefined,
            envelopeUnparsed: true,
        });
        const b = getLlmUsageSnapshot().byPurpose.normalize;
        expect(b.responses).toBe(1);
        expect(b.unparseableEnvelopes).toBe(1);
        expect(b.usageReported).toBe(0);
        // Not a failure: the provider answered and billed for it.
        expect(b.failures).toBe(0);
    });

    it('a readable envelope leaves unparseableEnvelopes at zero', () => {
        recordLlmResponse({
            purpose: 'normalize',
            model: 'openai/gpt-4o-mini',
            usage: { total_tokens: 47 },
        });
        // MUTATION TARGET: making the increment unconditional kills this.
        expect(getLlmUsageSnapshot().byPurpose.normalize.unparseableEnvelopes).toBe(0);
    });

    it.each([
        ['a numeric string', '47'],
        ['null', null],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['an object', { value: 47 }],
        ['a boolean', true],
    ])('total_tokens as %s is not a measurement', (_label, value) => {
        recordLlmResponse({
            purpose: 'serving',
            model: 'openai/gpt-4o-mini',
            usage: { total_tokens: value },
        });
        const snap = getLlmUsageSnapshot();
        expect(snap.byPurpose.serving.responses).toBe(1);
        expect(snap.byPurpose.serving.usageReported).toBe(0);
        expect(snap.byPurpose.serving.totalTokens).toBe(0);
    });

    it('guards each token field independently', () => {
        // A provider may return the total without the split. The total must still land.
        recordLlmResponse({
            purpose: 'ambiguous',
            model: 'm',
            usage: { total_tokens: 12, prompt_tokens: 'nope' },
        });
        const b = getLlmUsageSnapshot().byPurpose.ambiguous;
        expect(b).toMatchObject({ responses: 1, usageReported: 1, totalTokens: 12, promptTokens: 0, completionTokens: 0 });
    });

    it('a usage block with no cost field leaves costReported at 0', () => {
        recordLlmResponse({
            purpose: 'normalize',
            model: 'm',
            usage: { total_tokens: 10, prompt_tokens: 8, completion_tokens: 2 },
        });
        const b = getLlmUsageSnapshot().byPurpose.normalize;
        expect(b.usageReported).toBe(1);
        expect(b.costReported).toBe(0);
        expect(b.costUsd).toBe(0);
    });

    it('a non-object usage value is tolerated and still counts the billed response', () => {
        recordLlmResponse({ purpose: 'normalize', model: 'm', usage: 'unexpected' });
        recordLlmResponse({ purpose: 'normalize', model: 'm', usage: null });
        const b = getLlmUsageSnapshot().byPurpose.normalize;
        expect(b.responses).toBe(2);
        expect(b.usageReported).toBe(0);
    });

    it('accumulates across responses', () => {
        recordLlmResponse({ purpose: 'normalize', model: 'openai/gpt-4o-mini', usage: REAL_USAGE });
        recordLlmResponse({ purpose: 'normalize', model: 'openai/gpt-4o-mini', usage: REAL_USAGE });
        const b = getLlmUsageSnapshot().byPurpose.normalize;
        expect(b.responses).toBe(2);
        expect(b.totalTokens).toBe(94);
        expect(b.costUsd).toBeCloseTo(1.9305e-5, 12);
    });
});

describe('llm-usage-metrics: failures and logical successes', () => {
    it('records failures separately in both dimensions', () => {
        recordLlmFailure({ purpose: 'parse', model: 'llama3' });
        const snap = getLlmUsageSnapshot();
        expect(snap.byPurpose.parse.failures).toBe(1);
        expect(snap.byPurpose.parse.responses).toBe(0);
        expect(snap.byModel.llama3.failures).toBe(1);
    });

    it('keeps responses and logicalSuccesses as separate numbers', () => {
        // Two billed HTTP 200s, one logical win — the retry/fallback shape. Quoting only one of
        // these is how `[AI:SERV]` became an upper bound that read as a count.
        recordLlmResponse({ purpose: 'serving', model: 'm', usage: REAL_USAGE });
        recordLlmResponse({ purpose: 'serving', model: 'm', usage: REAL_USAGE });
        recordLlmLogicalSuccess({ purpose: 'serving', model: 'm' });
        const b = getLlmUsageSnapshot().byPurpose.serving;
        expect(b.responses).toBe(2);
        expect(b.logicalSuccesses).toBe(1);
        expect(b.responses).toBeGreaterThanOrEqual(b.logicalSuccesses);
    });
});

describe('llm-usage-metrics: the globalThis backing', () => {
    it('survives jest.resetModules() and a re-require', () => {
        // This is the property that mitigates Next emitting src/lib/** into more than one server
        // chunk. Jest cannot reproduce Next's bundling, so this is the closest proxy available:
        // a fresh module instance must find the SAME store, not a new zeroed one.
        recordLlmResponse({ purpose: 'nutrition', model: 'openai/gpt-4o-mini', usage: REAL_USAGE });

        const before = require('../llm-usage-metrics') as typeof import('../llm-usage-metrics');
        jest.resetModules();
        const fresh = require('../llm-usage-metrics') as typeof import('../llm-usage-metrics');

        // Genuinely a different module instance — otherwise this test proves nothing.
        expect(fresh).not.toBe(before);
        const snap = fresh.getLlmUsageSnapshot();
        expect(snap.byPurpose.nutrition.responses).toBe(1);
        expect(snap.byPurpose.nutrition.totalTokens).toBe(47);
    });
});
