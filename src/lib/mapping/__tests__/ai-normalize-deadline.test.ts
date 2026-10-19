/**
 * aiNormalizeIngredient() has an overall deadline (AI_NORMALIZE_DEADLINE_MS). On expiry it must
 * produce the all-providers-failed outcome: { status: 'error' }, no cache write, and a reason that
 * is NOT the echo reason (the one error a caller acts on). It must clear its timer on every path.
 * LLM mocked at the callStructuredLlm() chokepoint; the cache helpers are mocked whole.
 */
const mockCallStructuredLlm = jest.fn();
const mockGetCache = jest.fn();
const mockSaveCache = jest.fn();

jest.mock('../validated-mapping-helpers', () => ({
    getAiNormalizeCache: (...a: unknown[]) => mockGetCache(...a),
    saveAiNormalizeCache: (...a: unknown[]) => mockSaveCache(...a),
}));
jest.mock('../../ai/structured-client', () => ({
    callStructuredLlm: (...a: unknown[]) => mockCallStructuredLlm(...a),
}));

import { logger } from '../../logger';
import {
    aiNormalizeIngredient,
    AI_NORMALIZE_DEADLINE_MS,
    AI_NORMALIZE_DEADLINE_REASON,
} from '../ai-normalize';
import { PROMPT_EXAMPLE_ECHO_REASON } from '../llm-output-guards';

const LINE = 'plain bagel';
const GOOD = {
    status: 'success',
    provider: 'openrouter',
    model: 'test-model',
    content: {
        normalized_name: 'plain bagel', canonical_base: 'plain bagel',
        prep_phrases: [], size_phrases: [], synonyms: [],
        cooking_modifier: null, nutrition_estimate: null,
        is_branded: false, is_multi_ingredient: false, split_ingredients: null, error: null,
    },
};
const ALL_FAILED = { status: 'error', error: 'HTTP 500', provider: 'openai', model: 'test-model' };

function deferred() {
    let resolve!: (v: unknown) => void;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

let warnSpy: jest.SpyInstance;

beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    mockCallStructuredLlm.mockReset();
    mockGetCache.mockReset().mockResolvedValue(null);
    mockSaveCache.mockReset().mockResolvedValue(undefined);
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
    warnSpy.mockRestore();
    jest.useRealTimers();
});

describe('aiNormalizeIngredient overall deadline', () => {
    it('is 10 s', () => {
        expect(AI_NORMALIZE_DEADLINE_MS).toBe(10_000);
        expect(AI_NORMALIZE_DEADLINE_REASON).not.toBe(PROMPT_EXAMPLE_ECHO_REASON);
    });

    it('on expiry returns the all-providers-failed outcome: error, no save, timer cleared', async () => {
        // Arm A: the path that exists today - every provider failed.
        mockCallStructuredLlm.mockResolvedValueOnce(ALL_FAILED);
        const failed = await aiNormalizeIngredient(LINE);

        // Arm B: the call never settles.
        mockCallStructuredLlm.mockReturnValueOnce(new Promise(() => undefined));
        let settled = false;
        const pending = aiNormalizeIngredient(LINE).then((r) => { settled = true; return r; });
        await jest.advanceTimersByTimeAsync(AI_NORMALIZE_DEADLINE_MS);
        expect(settled).toBe(true);
        const expired = await pending;

        expect(failed).toEqual({ status: 'error', reason: 'HTTP 500' });
        expect(expired).toEqual({ status: 'error', reason: AI_NORMALIZE_DEADLINE_REASON });
        expect(Object.keys(expired).sort()).toEqual(Object.keys(failed).sort());
        expect(mockSaveCache).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
            'ai_normalize.deadline_exceeded',
            expect.objectContaining({ rawLine: LINE, deadlineMs: AI_NORMALIZE_DEADLINE_MS }),
        );
    });

    it('one ms before the deadline the call is still awaited, and a then-answer is used and saved', async () => {
        const d = deferred();
        mockCallStructuredLlm.mockReturnValueOnce(d.promise);
        let settled = false;
        const p = aiNormalizeIngredient(LINE).then((r) => { settled = true; return r; });

        await jest.advanceTimersByTimeAsync(AI_NORMALIZE_DEADLINE_MS - 1);
        expect(settled).toBe(false);

        d.resolve(GOOD);
        const r = await p;
        expect(r.status).toBe('success');
        expect(mockSaveCache).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('a fast success is unchanged and leaves no timer behind', async () => {
        mockCallStructuredLlm.mockResolvedValueOnce(GOOD);
        const r = await aiNormalizeIngredient(LINE);

        expect(r).toEqual({
            status: 'success',
            normalizedName: 'plain bagel',
            canonicalBase: 'plain bagel',
            prepPhrases: [], sizePhrases: [], synonyms: [],
            cookingModifier: undefined,
            nutritionEstimate: undefined,
            isBranded: false,
            isMultiIngredient: false,
            splitIngredients: undefined,
        });
        expect(mockSaveCache).toHaveBeenCalledTimes(1);
        expect(mockSaveCache.mock.calls[0][0]).toBe(LINE);
        expect(jest.getTimerCount()).toBe(0);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('a late answer after expiry is dropped: no cache write', async () => {
        const d = deferred();
        mockCallStructuredLlm.mockReturnValueOnce(d.promise);
        let settled = false;
        const p = aiNormalizeIngredient(LINE).then((r) => { settled = true; return r; });
        await jest.advanceTimersByTimeAsync(AI_NORMALIZE_DEADLINE_MS);
        expect(settled).toBe(true);
        expect(await p).toEqual({ status: 'error', reason: AI_NORMALIZE_DEADLINE_REASON });

        d.resolve(GOOD);
        await jest.advanceTimersByTimeAsync(0);  // flush the orphan's continuation
        expect(mockSaveCache).not.toHaveBeenCalled();
    });

    it('a throw before the deadline still lands in the existing catch, timer cleared', async () => {
        mockCallStructuredLlm.mockRejectedValueOnce(new Error('boom'));
        expect(await aiNormalizeIngredient(LINE)).toEqual({ status: 'error', reason: 'boom' });
        expect(jest.getTimerCount()).toBe(0);
    });

    it('a cache hit never arms a timer and never calls the LLM', async () => {
        mockGetCache.mockResolvedValueOnce({
            normalizedName: 'plain bagel', canonicalBase: 'plain bagel',
            synonyms: [], prepPhrases: [], sizePhrases: [],
            isBranded: false, isMultiIngredient: false,
        });
        const r = await aiNormalizeIngredient(LINE);
        expect(r.status).toBe('success');
        expect(mockCallStructuredLlm).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('expiry aborts the signal it handed to callStructuredLlm', async () => {
        mockCallStructuredLlm.mockReturnValueOnce(new Promise(() => undefined));
        const p = aiNormalizeIngredient(LINE);
        await jest.advanceTimersByTimeAsync(AI_NORMALIZE_DEADLINE_MS - 1);

        expect(mockCallStructuredLlm).toHaveBeenCalledTimes(1);
        const { signal } = mockCallStructuredLlm.mock.calls[0][0] as { signal?: AbortSignal };
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal?.aborted).toBe(false);

        await jest.advanceTimersByTimeAsync(1);
        expect(signal?.aborted).toBe(true);
        expect(await p).toEqual({ status: 'error', reason: AI_NORMALIZE_DEADLINE_REASON });
    });

    it('a call that settles in time leaves its signal un-aborted', async () => {
        mockCallStructuredLlm.mockResolvedValueOnce(GOOD);
        expect((await aiNormalizeIngredient(LINE)).status).toBe('success');
        const { signal } = mockCallStructuredLlm.mock.calls[0][0] as { signal?: AbortSignal };
        expect(signal?.aborted).toBe(false);
        await jest.advanceTimersByTimeAsync(AI_NORMALIZE_DEADLINE_MS);
        expect(signal?.aborted).toBe(false);
    });
});
