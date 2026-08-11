/**
 * cache-validator tests — flag gating, experiment-parity inputs, fail-closed
 * verdict handling, and the tracked fire-and-forget contract.
 *
 * callStructuredLlm is stubbed at the single chokepoint (the sanctioned
 * pattern — there is deliberately no env-var bypass) and prisma is mocked, so
 * nothing in this file can dial out or touch a database. Config consts freeze
 * at import time, so every scenario re-imports the module via
 * jest.resetModules() with the env set first.
 */

const mockCall = jest.fn();
const mockCreate = jest.fn();

jest.mock('@/lib/ai/structured-client', () => ({
    callStructuredLlm: (...args: unknown[]) => mockCall(...args),
}));
jest.mock('@/lib/db', () => ({
    prisma: {
        mappingValidationVerdict: {
            create: (...args: unknown[]) => mockCreate(...args),
        },
    },
}));

type ValidatorModule = typeof import('../cache-validator');
type HydrationModule = typeof import('../deferred-hydration');

const INPUT = {
    phrase: '2 grilled chicken breasts',
    foodName: 'Chicken Breast, Grilled',
    brandName: null,
    source: 'fatsecret',
    recordId: 'fs_12345',
    billedGrams: 240,
    billedKcal: 396,
    servingTier: 'count_unit_ai',
};

const GOOD_ARGS = { skipSave: false, selectionReason: 'rerank_win', funnelStage: 'saved' };

/** Re-import cache-validator (+ the REAL deferred-hydration from the same
 *  module registry, so drain sees the validator's tasks) under a given env. */
function load(env: Record<string, string>): { cv: ValidatorModule; dh: HydrationModule } {
    jest.resetModules();
    process.env.CACHE_VALIDATOR_ENABLED = env.CACHE_VALIDATOR_ENABLED ?? '0';
    process.env.VALIDATOR_AI_MODEL = env.VALIDATOR_AI_MODEL ?? '';
    /* eslint-disable @typescript-eslint/no-var-requires */
    const cv = require('../cache-validator') as ValidatorModule;
    const dh = require('../deferred-hydration') as HydrationModule;
    /* eslint-enable @typescript-eslint/no-var-requires */
    return { cv, dh };
}

beforeEach(() => {
    mockCall.mockReset();
    mockCreate.mockReset();
});

describe('shouldRunCacheValidator gating', () => {
    it('flag off (default) → never runs, regardless of a configured model', () => {
        const { cv } = load({ CACHE_VALIDATOR_ENABLED: '0', VALIDATOR_AI_MODEL: 'anthropic/claude-sonnet-5' });
        expect(cv.shouldRunCacheValidator(GOOD_ARGS)).toBe(false);
    });

    it('flag on but model unset → fail-closed disabled (never the cheap tier)', () => {
        const { cv } = load({ CACHE_VALIDATOR_ENABLED: '1', VALIDATOR_AI_MODEL: '' });
        expect(cv.shouldRunCacheValidator(GOOD_ARGS)).toBe(false);
    });

    it('flag on + model → true only for a genuinely written save', () => {
        const { cv } = load({ CACHE_VALIDATOR_ENABLED: '1', VALIDATOR_AI_MODEL: 'anthropic/claude-sonnet-5' });
        expect(cv.shouldRunCacheValidator(GOOD_ARGS)).toBe(true);
        // cache-hit re-serve
        expect(cv.shouldRunCacheValidator({ ...GOOD_ARGS, selectionReason: 'normalized_cache_hit' })).toBe(false);
        // a save gate rejected the write (incl. both human-row branches)
        expect(cv.shouldRunCacheValidator({ ...GOOD_ARGS, funnelStage: 'save_rejected' })).toBe(false);
        // no telemetry (script callers) → conservative no
        expect(cv.shouldRunCacheValidator({ ...GOOD_ARGS, funnelStage: undefined })).toBe(false);
        // measurement run must not validate what it didn't write
        expect(cv.shouldRunCacheValidator({ ...GOOD_ARGS, skipSave: true })).toBe(false);
    });
});

describe('kickCacheValidation', () => {
    it('happy path: exactly one chokepoint call with experiment-parity inputs, verdict row written', async () => {
        const { cv, dh } = load({ CACHE_VALIDATOR_ENABLED: '1', VALIDATOR_AI_MODEL: 'anthropic/claude-sonnet-5' });
        mockCall.mockResolvedValue({
            status: 'success',
            provider: 'openrouter',
            model: 'anthropic/claude-sonnet-5',
            content: { verdict: 'SUSPECT', axis: 'serving', reason: '396 kcal for 2 breasts is fine; test row' },
        });
        mockCreate.mockResolvedValue({});

        const ret = cv.kickCacheValidation(INPUT, 'Grilled Chicken  Breasts');
        expect(ret).toBeUndefined();          // void, synchronous
        expect(mockCreate).not.toHaveBeenCalled(); // nothing awaited inline
        await dh.drainPendingBackgroundTasks();

        expect(mockCall).toHaveBeenCalledTimes(1);
        const opts = mockCall.mock.calls[0][0];
        expect(opts.purpose).toBe('cache_validate');
        expect(opts.maxTokens).toBe(600);
        // parity inputs present…
        for (const needle of ['2 grilled chicken breasts', 'Chicken Breast, Grilled', 'fatsecret', 'fs_12345', '240 g', '396 kcal', '165 kcal/100g', 'count_unit_ai']) {
            expect(opts.userPrompt).toContain(needle);
        }
        // …and nothing beyond parity (pin: widening inputs voids the measured rates)
        expect(opts.userPrompt.toLowerCase()).not.toContain('confidence');
        expect(opts.userPrompt.toLowerCase()).not.toContain('selectionreason');

        expect(mockCreate).toHaveBeenCalledTimes(1);
        const data = mockCreate.mock.calls[0][0].data;
        expect(data.verdict).toBe('SUSPECT');
        expect(data.axis).toBe('serving');
        expect(data.foodId).toBe('fs_12345');
        expect(data.model).toBe('anthropic/claude-sonnet-5');
        expect(data.billedGrams).toBe(240);
        expect(data.billedKcal).toBe(396);
        // the stored key is the pipeline's own canonical form of the raw key
        const { canonicalizeCacheKey } = jest.requireActual('../normalization-rules') as typeof import('../normalization-rules');
        expect(data.normalizedForm).toBe(canonicalizeCacheKey('Grilled Chicken  Breasts'));
    });

    it('OK verdicts are written too (false-flag denominator)', async () => {
        const { cv, dh } = load({ CACHE_VALIDATOR_ENABLED: '1', VALIDATOR_AI_MODEL: 'anthropic/claude-sonnet-5' });
        mockCall.mockResolvedValue({
            status: 'success', provider: 'openrouter', model: 'anthropic/claude-sonnet-5',
            content: { verdict: 'OK', axis: 'none', reason: 'bill matches phrase' },
        });
        mockCreate.mockResolvedValue({});
        cv.kickCacheValidation(INPUT, 'chicken');
        await dh.drainPendingBackgroundTasks();
        expect(mockCreate).toHaveBeenCalledTimes(1);
        expect(mockCreate.mock.calls[0][0].data.verdict).toBe('OK');
    });

    it('LLM error → no verdict row, task resolves (never throws)', async () => {
        const { cv, dh } = load({ CACHE_VALIDATOR_ENABLED: '1', VALIDATOR_AI_MODEL: 'anthropic/claude-sonnet-5' });
        mockCall.mockResolvedValue({ status: 'error', provider: 'openrouter', model: 'anthropic/claude-sonnet-5', error: 'timeout' });
        cv.kickCacheValidation(INPUT, 'chicken');
        await expect(dh.drainPendingBackgroundTasks()).resolves.toBeUndefined();
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('malformed verdict enum → dropped fail-closed, no row', async () => {
        const { cv, dh } = load({ CACHE_VALIDATOR_ENABLED: '1', VALIDATOR_AI_MODEL: 'anthropic/claude-sonnet-5' });
        mockCall.mockResolvedValue({
            status: 'success', provider: 'openrouter', model: 'anthropic/claude-sonnet-5',
            content: { verdict: 'MAYBE', axis: 'serving', reason: 'x' },
        });
        cv.kickCacheValidation(INPUT, 'chicken');
        await dh.drainPendingBackgroundTasks();
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('a throwing verdict write is swallowed (no unhandled rejection)', async () => {
        const { cv, dh } = load({ CACHE_VALIDATOR_ENABLED: '1', VALIDATOR_AI_MODEL: 'anthropic/claude-sonnet-5' });
        mockCall.mockResolvedValue({
            status: 'success', provider: 'openrouter', model: 'anthropic/claude-sonnet-5',
            content: { verdict: 'OK', axis: 'none', reason: 'x' },
        });
        mockCreate.mockRejectedValue(new Error('db down'));
        cv.kickCacheValidation(INPUT, 'chicken');
        await expect(dh.drainPendingBackgroundTasks()).resolves.toBeUndefined();
    });
});
