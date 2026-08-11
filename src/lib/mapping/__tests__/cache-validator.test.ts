/**
 * cache-validator tests — flag gating, experiment-parity inputs, fail-closed
 * verdict handling, tier guarding, and the tracked fire-and-forget contract.
 *
 * callStructuredLlm is stubbed at the single chokepoint (the sanctioned
 * pattern — there is deliberately no env-var bypass) and prisma is mocked, so
 * nothing in this file can dial out or touch a database. Config consts freeze
 * at import time, so every scenario re-imports the module via
 * jest.resetModules() with the env set first. Env originals are restored in
 * afterAll so this file cannot leak validator flags into later suites in the
 * same worker.
 */

import * as fs from 'fs';
import * as path from 'path';

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
type LoggerModule = typeof import('../../logger');

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
const MODEL = 'anthropic/claude-sonnet-5';

const ORIGINAL_ENV = {
    CACHE_VALIDATOR_ENABLED: process.env.CACHE_VALIDATOR_ENABLED,
    VALIDATOR_AI_MODEL: process.env.VALIDATOR_AI_MODEL,
};

afterAll(() => {
    for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
});

/** Re-import cache-validator (+ the REAL deferred-hydration and logger from
 *  the same module registry, so drain sees the validator's tasks and spies see
 *  its log calls) under a given env. Pass `undefined` to DELETE a var — the
 *  default-off test must exercise getFlag's absent-env branch, not a '0'. */
function load(env: Record<string, string | undefined>): { cv: ValidatorModule; dh: HydrationModule; log: LoggerModule } {
    jest.resetModules();
    for (const k of ['CACHE_VALIDATOR_ENABLED', 'VALIDATOR_AI_MODEL'] as const) {
        const v = env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    /* eslint-disable @typescript-eslint/no-var-requires */
    const cv = require('../cache-validator') as ValidatorModule;
    const dh = require('../deferred-hydration') as HydrationModule;
    const log = require('../../logger') as LoggerModule;
    /* eslint-enable @typescript-eslint/no-var-requires */
    return { cv, dh, log };
}

beforeEach(() => {
    mockCall.mockReset();
    mockCreate.mockReset();
});

describe('shouldRunCacheValidator gating', () => {
    it('BOTH env vars absent → off (the shipped default, not a configured 0)', () => {
        const { cv } = load({ CACHE_VALIDATOR_ENABLED: undefined, VALIDATOR_AI_MODEL: undefined });
        expect(cv.shouldRunCacheValidator(GOOD_ARGS)).toBe(false);
    });

    it('flag explicitly 0 → off, regardless of a configured model', () => {
        const { cv } = load({ CACHE_VALIDATOR_ENABLED: '0', VALIDATOR_AI_MODEL: MODEL });
        expect(cv.shouldRunCacheValidator(GOOD_ARGS)).toBe(false);
    });

    it('flag on but model unset → fail-closed disabled (never the cheap tier)', () => {
        const { cv } = load({ CACHE_VALIDATOR_ENABLED: '1', VALIDATOR_AI_MODEL: undefined });
        expect(cv.shouldRunCacheValidator(GOOD_ARGS)).toBe(false);
    });

    it('flag on + model → true only for a genuinely written save', () => {
        const { cv } = load({ CACHE_VALIDATOR_ENABLED: '1', VALIDATOR_AI_MODEL: MODEL });
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
        const { cv, dh } = load({ CACHE_VALIDATOR_ENABLED: '1', VALIDATOR_AI_MODEL: MODEL });
        mockCall.mockResolvedValue({
            status: 'success',
            provider: 'openrouter',
            model: MODEL,
            content: { verdict: 'SUSPECT', axis: 'serving', reason: 'test row' },
        });
        mockCreate.mockResolvedValue({});

        const ret = cv.kickCacheValidation(INPUT, 'Grilled Chicken  Breasts');
        expect(ret).toBeUndefined();          // void, synchronous
        expect(mockCreate).not.toHaveBeenCalled(); // nothing awaited inline
        await dh.drainPendingBackgroundTasks();

        expect(mockCall).toHaveBeenCalledTimes(1);
        const opts = mockCall.mock.calls[0][0];
        expect(opts.purpose).toBe('cache_validate');
        expect(opts.maxTokens).toBe(2000);
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
        expect(data.model).toBe(MODEL);
        expect(data.billedGrams).toBe(240);
        expect(data.billedKcal).toBe(396);
        // the stored key is the pipeline's own canonical form of the raw key
        const { canonicalizeCacheKey } = jest.requireActual('../normalization-rules') as typeof import('../normalization-rules');
        expect(data.normalizedForm).toBe(canonicalizeCacheKey('Grilled Chicken  Breasts'));
    });

    it('OK verdicts are written too (false-flag denominator)', async () => {
        const { cv, dh } = load({ CACHE_VALIDATOR_ENABLED: '1', VALIDATOR_AI_MODEL: MODEL });
        mockCall.mockResolvedValue({
            status: 'success', provider: 'openrouter', model: MODEL,
            content: { verdict: 'OK', axis: 'none', reason: 'bill matches phrase' },
        });
        mockCreate.mockResolvedValue({});
        cv.kickCacheValidation(INPUT, 'chicken');
        await dh.drainPendingBackgroundTasks();
        expect(mockCreate).toHaveBeenCalledTimes(1);
        expect(mockCreate.mock.calls[0][0].data.verdict).toBe('OK');
    });

    it('LLM error → no verdict row, task resolves (never throws)', async () => {
        const { cv, dh } = load({ CACHE_VALIDATOR_ENABLED: '1', VALIDATOR_AI_MODEL: MODEL });
        mockCall.mockResolvedValue({ status: 'error', provider: 'openrouter', model: MODEL, error: 'timeout' });
        cv.kickCacheValidation(INPUT, 'chicken');
        await expect(dh.drainPendingBackgroundTasks()).resolves.toBeUndefined();
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('a verdict from any OTHER model than the configured tier is dropped, never persisted', async () => {
        const { cv, dh, log } = load({ CACHE_VALIDATOR_ENABLED: '1', VALIDATOR_AI_MODEL: MODEL });
        const warn = jest.spyOn(log.logger, 'warn').mockImplementation(() => undefined);
        mockCall.mockResolvedValue({
            status: 'success', provider: 'openrouter', model: 'openai/gpt-4o-mini',
            content: { verdict: 'OK', axis: 'none', reason: 'cheap-tier verdict' },
        });
        cv.kickCacheValidation(INPUT, 'chicken');
        await dh.drainPendingBackgroundTasks();
        expect(mockCreate).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith('cache_validator.wrong_tier_dropped', expect.objectContaining({ model: 'openai/gpt-4o-mini' }));
        warn.mockRestore();
    });

    it('malformed verdict enum → dropped fail-closed, no row', async () => {
        const { cv, dh } = load({ CACHE_VALIDATOR_ENABLED: '1', VALIDATOR_AI_MODEL: MODEL });
        mockCall.mockResolvedValue({
            status: 'success', provider: 'openrouter', model: MODEL,
            content: { verdict: 'MAYBE', axis: 'serving', reason: 'x' },
        });
        cv.kickCacheValidation(INPUT, 'chicken');
        await dh.drainPendingBackgroundTasks();
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('incoherent verdict/axis pairs (OK+serving, SUSPECT+none) are dropped', async () => {
        const { cv, dh } = load({ CACHE_VALIDATOR_ENABLED: '1', VALIDATOR_AI_MODEL: MODEL });
        for (const content of [
            { verdict: 'OK', axis: 'serving', reason: 'x' },
            { verdict: 'SUSPECT', axis: 'none', reason: 'x' },
        ]) {
            mockCall.mockResolvedValue({ status: 'success', provider: 'openrouter', model: MODEL, content });
            cv.kickCacheValidation(INPUT, 'chicken');
            await dh.drainPendingBackgroundTasks();
        }
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('a throwing verdict write is swallowed AND takes the handled path (write_failed logged)', async () => {
        const { cv, dh, log } = load({ CACHE_VALIDATOR_ENABLED: '1', VALIDATOR_AI_MODEL: MODEL });
        const warn = jest.spyOn(log.logger, 'warn').mockImplementation(() => undefined);
        mockCall.mockResolvedValue({
            status: 'success', provider: 'openrouter', model: MODEL,
            content: { verdict: 'OK', axis: 'none', reason: 'x' },
        });
        mockCreate.mockRejectedValue(new Error('db down'));
        cv.kickCacheValidation(INPUT, 'chicken');
        await expect(dh.drainPendingBackgroundTasks()).resolves.toBeUndefined();
        // Not vacuous: proves the rejection was caught by runCacheValidation's
        // own handler (allSettled in drain would mask an unhandled one).
        expect(warn).toHaveBeenCalledWith('cache_validator.write_failed', expect.objectContaining({ error: 'db down' }));
        warn.mockRestore();
    });
});

describe('hook-site shape (source pin — the mapper is not mockable at unit scale)', () => {
    it('finalizeAndSaveResult calls kickCacheValidation exactly once, after the save await, gated on telemetry funnelStage', () => {
        const src = fs.readFileSync(
            path.resolve(__dirname, '../map-ingredient-with-fallback.ts'),
            'utf8',
        );
        const kicks = src.match(/kickCacheValidation\(/g) ?? [];
        expect(kicks).toHaveLength(1);
        expect(src).not.toContain('await kickCacheValidation');
        // gate reads the post-save funnel stage, so rejected writes never validate
        expect(src).toContain('shouldRunCacheValidator({ skipSave, selectionReason, funnelStage: telemetry?.funnelStage })');
        // the hook sits AFTER the save call in the same function body
        const saveIdx = src.indexOf('if (!skipSave) await saveValidatedMapping(rawLine, result,');
        const kickIdx = src.indexOf('kickCacheValidation(');
        expect(saveIdx).toBeGreaterThan(-1);
        expect(kickIdx).toBeGreaterThan(saveIdx);
    });
});
