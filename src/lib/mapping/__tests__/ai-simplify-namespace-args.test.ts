/**
 * The F5a fix is only real at its CALLER.
 *
 * `namespaced-cache-key.test.ts` calls `computeNormalizedKey('1 cup rice', 'SIMPLIFY:')`
 * directly. That pins the helper's new CAPABILITY — it does not pin that anything uses it.
 * MEASURED 2026-08-01: reverting the three lines in `aiSimplifyIngredient()` to the old
 * concatenated key
 *     const cacheKey = CACHE_PREFIX + (brand ? `B:${brand.toLowerCase()}:` : '') + rawLine;
 *     getAiNormalizeCache(cacheKey) / saveAiNormalizeCache(cacheKey, {...})
 * left the entire suite green (137 suites / 2,942 tests passed) and `npx tsc --noEmit` at
 * exit 0, because both helper signatures still accept a single argument.
 *
 * A silent revert is not cosmetic AFTER the backfill has run: new writes would again land
 * at `normalizedKey='simplify 2 cup rice'` with `rawLine='SIMPLIFY:2 cups rice'`, so the
 * key the migration just collapsed 233 rows onto ('SIMPLIFY:rice', incl.
 * 'simplify 1 cup rolled oats' at useCount=167) is never read again, quantity
 * fragmentation restarts, and `splitNamespace()` in scripts/backfill-ai-normalize-keys.ts
 * re-classifies the new rows as LEGACY on its next run.
 *
 * So these tests assert the ARGUMENTS, which is what the fix actually changed.
 */

jest.mock('../../db', () => ({ prisma: {} }));
jest.mock('../validated-mapping-helpers', () => ({
    getAiNormalizeCache: jest.fn(),
    saveAiNormalizeCache: jest.fn(),
}));
jest.mock('../../ai/structured-client', () => ({ callStructuredLlm: jest.fn() }));

import { aiSimplifyIngredient } from '../ai-simplify';
import { getAiNormalizeCache, saveAiNormalizeCache } from '../validated-mapping-helpers';
import { callStructuredLlm } from '../../ai/structured-client';

beforeEach(() => {
    jest.clearAllMocks();
    (getAiNormalizeCache as jest.Mock).mockResolvedValue(null);
    (saveAiNormalizeCache as jest.Mock).mockResolvedValue(undefined);
    (callStructuredLlm as jest.Mock).mockResolvedValue({
        status: 'success',
        content: { simplified: 'protein powder', rationale: 'r' },
    });
});

describe('aiSimplifyIngredient passes the namespace as an OPTION, never concatenated', () => {
    it('reads the cache with a bare rawLine + namespace opt (no brand)', async () => {
        await aiSimplifyIngredient('2 cups rice');

        expect(getAiNormalizeCache).toHaveBeenCalledWith('2 cups rice', { namespace: 'SIMPLIFY:' });
        // The exact shape the revert reintroduces — assert it is NOT what we send.
        expect(getAiNormalizeCache).not.toHaveBeenCalledWith('SIMPLIFY:2 cups rice');
    });

    it('writes the cache with a bare rawLine + namespace opt (no brand)', async () => {
        await aiSimplifyIngredient('2 cups rice');

        expect(saveAiNormalizeCache).toHaveBeenCalledWith(
            '2 cups rice',
            expect.objectContaining({ normalizedName: 'protein powder' }),
            { namespace: 'SIMPLIFY:' },
        );
    });

    it('namespaces by brand without concatenating it onto the food string', async () => {
        await aiSimplifyIngredient('2 cups ghost protein', 'Ghost');

        expect(getAiNormalizeCache).toHaveBeenCalledWith(
            '2 cups ghost protein',
            { namespace: 'SIMPLIFY:B:ghost:' },
        );
        expect(saveAiNormalizeCache).toHaveBeenCalledWith(
            '2 cups ghost protein',
            expect.anything(),
            { namespace: 'SIMPLIFY:B:ghost:' },
        );
    });

    it('strips colons from the brand so the namespace grammar stays unambiguous', async () => {
        // Covers the `.replace(/:/g, '')`, which also survived the whole suite when
        // deleted. A colon in the brand would give the namespace TWO possible split
        // points, and NAMESPACE_RE in scripts/backfill-ai-normalize-keys.ts would split
        // at the wrong one — re-keying a reachable row onto an unreachable one.
        await aiSimplifyIngredient('1 scoop ryse loaded', 'Ryse: Loaded');

        expect(getAiNormalizeCache).toHaveBeenCalledWith(
            '1 scoop ryse loaded',
            { namespace: 'SIMPLIFY:B:ryse loaded:' },
        );
        const ns = (getAiNormalizeCache as jest.Mock).mock.calls[0][1].namespace;
        // Exactly three colons: the SIMPLIFY: terminator, the B: marker, and the
        // brand terminator. A fourth means the grammar is ambiguous.
        expect(ns.split(':').length - 1).toBe(3);
    });

    it('reads the cache before spending an LLM call, and returns the cached value', async () => {
        // Guards the ordering the namespace fix depends on: if the lookup key were
        // wrong, this cached row would be missed and the LLM would be called.
        (getAiNormalizeCache as jest.Mock).mockResolvedValue({ normalizedName: 'rice' });

        const result = await aiSimplifyIngredient('2 cups rice');

        expect(callStructuredLlm).not.toHaveBeenCalled();
        expect(result).toEqual({ simplified: 'rice', rationale: 'from_cache' });
    });
});
