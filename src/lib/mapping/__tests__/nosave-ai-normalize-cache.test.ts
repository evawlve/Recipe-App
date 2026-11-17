/**
 * saveAiNormalizeCache() persists the model's reading of a line (AiNormalizeCache). Every later
 * request that misses FoodMapping reads that row, so a `nosave=1` request (a write policy
 * suppressing 'aiNormalizeCache') must not create it, and must not re-stamp a stale one either
 * (s461 NOSAVE-AINORMALIZE; the deleted `una corona` -> onion row was minted by a nosave probe).
 * The refused row is named on the receipt, and the request still uses the model's answer.
 * Without suppression the upsert runs exactly as before.
 */
import { saveAiNormalizeCache, computeNormalizedKey } from '../validated-mapping-helpers';
import { aiNormalizeIngredient } from '../ai-normalize';
import { aiSimplifyIngredient } from '../ai-simplify';
import { runWithWritePolicy, currentWriteReceipt } from '../../write-policy';

const mockUpsert = jest.fn().mockResolvedValue({});
jest.mock('@/lib/db', () => ({
    prisma: {
        // touchAndFetchCacheRow(): no row, so every lookup is a miss and the model runs.
        $queryRaw: jest.fn().mockResolvedValue([]),
        aiNormalizeCache: {
            findUnique: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
            upsert: (...args: unknown[]) => mockUpsert(...args),
        },
    },
}));

const mockLlm = jest.fn();
jest.mock('../../ai/structured-client', () => ({
    callStructuredLlm: (...args: unknown[]) => mockLlm(...args),
}));

const RAW = 'una corona';
const NOSAVE = ['aiServing', 'segmentationCache', 'aiNormalizeCache'] as const;

beforeEach(() => {
    mockUpsert.mockClear();
    mockLlm.mockReset();
});

describe('saveAiNormalizeCache under a write policy', () => {
    it('suppression ON: no upsert, and the receipt names the refused key', async () => {
        const receipt = await runWithWritePolicy({ suppress: [...NOSAVE], line: RAW }, async () => {
            await saveAiNormalizeCache(RAW, { normalizedName: 'corona beer', isBranded: true });
            await saveAiNormalizeCache(RAW, { normalizedName: 'corona beer' }, { namespace: 'ES:' });
            return currentWriteReceipt();
        });
        expect(mockUpsert).not.toHaveBeenCalled();
        expect(receipt?.refusedTotal).toBe(2);
        expect(receipt?.refused).toEqual([
            { kind: 'aiNormalizeCache', table: 'AiNormalizeCache', key: computeNormalizedKey(RAW), line: RAW },
            { kind: 'aiNormalizeCache', table: 'AiNormalizeCache', key: computeNormalizedKey(RAW, 'ES:'), line: RAW },
        ]);
    });

    it('a policy that suppresses only the OTHER kinds: the row is written, as today', async () => {
        const receipt = await runWithWritePolicy({ suppress: ['aiServing', 'segmentationCache'] }, async () => {
            await saveAiNormalizeCache(RAW, { normalizedName: 'corona beer' });
            return currentWriteReceipt();
        });
        expect(mockUpsert).toHaveBeenCalledTimes(1);
        expect(receipt?.refusedTotal).toBe(0);
        expect(receipt?.consulted).toBe(1);
    });

    it('no policy at all (scripts, warm jobs, save-mode routes): the row is written, as today', async () => {
        await saveAiNormalizeCache(RAW, { normalizedName: 'corona beer' });
        expect(mockUpsert).toHaveBeenCalledTimes(1);
        const arg = mockUpsert.mock.calls[0][0];
        expect(arg.where).toEqual({ normalizedKey: computeNormalizedKey(RAW) });
        expect(arg.create.normalizedName).toBe('corona beer');
        expect(arg.update.normalizedName).toBe('corona beer');
    });
});

describe('the two writers keep the model answer for the request that refused the row', () => {
    it('aiNormalizeIngredient: nosave returns the fresh answer and writes nothing', async () => {
        mockLlm.mockResolvedValue({
            status: 'success',
            content: {
                normalized_name: 'corona beer', canonical_base: 'beer',
                prep_phrases: [], size_phrases: [], synonyms: [], is_branded: true,
            },
        });
        const { r, receipt } = await runWithWritePolicy({ suppress: [...NOSAVE], line: RAW }, async () => ({
            r: await aiNormalizeIngredient(RAW),
            receipt: currentWriteReceipt(),
        }));
        expect(r).toMatchObject({ status: 'success', normalizedName: 'corona beer', isBranded: true });
        expect(mockUpsert).not.toHaveBeenCalled();
        expect(receipt?.refusedTotal).toBe(1);

        await aiNormalizeIngredient(RAW); // control: no policy, the same miss saves
        expect(mockUpsert).toHaveBeenCalledTimes(1);
    });

    it('aiSimplifyIngredient: nosave returns the fresh answer and writes nothing', async () => {
        mockLlm.mockResolvedValue({ status: 'success', content: { simplified: 'Beer', rationale: 'x' } });
        const { r, receipt } = await runWithWritePolicy({ suppress: [...NOSAVE], line: RAW }, async () => ({
            r: await aiSimplifyIngredient(RAW),
            receipt: currentWriteReceipt(),
        }));
        expect(r).toEqual({ simplified: 'Beer', rationale: 'x' });
        expect(mockUpsert).not.toHaveBeenCalled();
        expect(receipt?.refused[0]).toMatchObject({ kind: 'aiNormalizeCache', key: computeNormalizedKey(RAW, 'SIMPLIFY:') });
    });
});
