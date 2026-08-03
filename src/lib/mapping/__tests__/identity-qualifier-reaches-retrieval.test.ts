/**
 * The identity QUALIFIER must reach RETRIEVAL, not only the cache key.
 *
 * Sibling of identity-hint-reaches-retrieval.test.ts, one set over. That file
 * covers IDENTITY_UNIT_HINTS ({white, yolk}); this one covers IDENTITY_QUALIFIERS
 * ({cooked, whole, raw, dried, canned}). The defect is identical in shape:
 * `deriveCacheKeyName()` restores BOTH into the cache key, and until now only the
 * unit hints were restored into the search term.
 *
 * Measured 2026-08-03 with scripts/filter-trace-probe.ts: on the query `quinoa`,
 * the FDC record "cooked quinoa" IS gathered and is then DROPPED by
 * `filterCandidatesByTokens` — its extra `cooked` token reads as bloat against a
 * bare query — leaving "uncooked quinoa" (368 kcal/100g) to answer `cooked quinoa`
 * (120 kcal/100g). On the query `cooked quinoa` it is kept. So the defect was
 * ADMISSION, not ranking: the pool never contained the right answer.
 *
 * These tests assert the SEARCH TERM, not the final pick. The pick depends on
 * corpus state; the search term is what this change controls. Each names the
 * mutation it kills.
 */

const mockGatherCandidates = jest.fn();

// Generic prisma stub: every model answers "nothing found" for any query verb.
// Same rationale as the sibling file — enumerating models by hand once made that
// file assert nothing, because the mapper hit an unmocked model and threw before
// retrieval, leaving an empty search-term list that passed vacuously.
jest.mock('../../db', () => {
    const emptyFor = (verb: string) =>
        jest.fn().mockResolvedValue(
            verb.startsWith('findMany') || verb === 'findMany' ? [] : null);
    const model = new Proxy({}, {
        get: (_t, verb: string) => emptyFor(verb),
    });
    return { prisma: new Proxy({}, { get: () => model }) };
});

jest.mock('../gather-candidates', () => {
    const actual = jest.requireActual('../gather-candidates');
    return { ...actual, gatherCandidates: (...a: unknown[]) => mockGatherCandidates(...a) };
});

jest.mock('../../search/query-embedding', () => ({
    SEMANTIC_SEARCH_ENABLED: false,
    CORPUS_POOLING: 'cls',
    warmupEmbedder: jest.fn(),
    embedQuery: jest.fn().mockResolvedValue(null),
}));

import { mapIngredientWithFallback } from '../map-ingredient-with-fallback';
import { parseIngredientLine } from '../../parse/ingredient-line';

/** Every search term handed to retrieval during one mapper call. */
async function searchTermsFor(line: string, options: Record<string, unknown> = {}): Promise<string[]> {
    mockGatherCandidates.mockResolvedValue([]);
    await mapIngredientWithFallback(line, { skipCache: true, skipSave: true, ...options } as never)
        .catch(() => undefined);
    return mockGatherCandidates.mock.calls.map(c => String(c[2] ?? ''));
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('the parse layer really does strip the qualifier', () => {
    it('"1 cup cooked quinoa" parses with `cooked` moved into qualifiers', () => {
        // Not a test of the change — it pins the PREMISE. If the parser stops
        // stripping `cooked`, the restoration below is solving a problem that moved.
        const p = parseIngredientLine('1 cup cooked quinoa');
        expect(p?.qualifiers?.map(q => q.toLowerCase())).toContain('cooked');
        expect(p?.name?.toLowerCase()).not.toContain('cooked');
    });
});

describe('the qualifier reaches the search query', () => {
    it('"1 cup cooked quinoa" searches for COOKED quinoa, not bare quinoa', async () => {
        // MUTATION: delete the restoration block. Kills it — every search term is
        // bare "quinoa", which is exactly what let "uncooked quinoa" win n-mq-35
        // and n-cook-05 at 368 kcal/100g against a [100,140] band.
        const terms = await searchTermsFor('1 cup cooked quinoa');
        expect(terms.length).toBeGreaterThan(0);
        expect(terms.every(t => t.toLowerCase().includes('cooked'))).toBe(true);
    });

    it('a cooked line and its bare form no longer search for the same thing', async () => {
        // MUTATION: restore the qualifier but drop it from baseName. This is the
        // defect stated directly — one search term for two different foods.
        const cooked = await searchTermsFor('1 cup cooked quinoa');
        jest.clearAllMocks();
        const bare = await searchTermsFor('1 cup quinoa');
        expect(cooked[0]).not.toBe(bare[0]);
    });

    it('restores `dried` too, not just `cooked`', async () => {
        // MUTATION: hardcode the restored qualifier to 'cooked'. The set has five
        // members and the fix must not special-case the one case that motivated it.
        const terms = await searchTermsFor('50g dried apricots');
        expect(terms.length).toBeGreaterThan(0);
        expect(terms.some(t => t.toLowerCase().includes('dried'))).toBe(true);
    });
});

describe('the restoration is bounded', () => {
    it('a NON-identity qualifier stays out of the query', async () => {
        // MUTATION: restore every parsed qualifier instead of only IDENTITY_QUALIFIERS.
        // `chopped` is a prep concern — it does not name a different food, and
        // widening the query with it would narrow the pool for no identity gain.
        const terms = await searchTermsFor('1 cup chopped onion');
        expect(terms.length).toBeGreaterThan(0);
        expect(terms.some(t => t.toLowerCase().includes('chopped'))).toBe(false);
    });

    it('a caller-supplied normalizedForm is left alone', async () => {
        // MUTATION: drop the `!options.normalizedForm` guard. A caller that has
        // already decided the search term owns it — golden n-serv-06 passes today
        // precisely because it supplies "cooked quinoa" itself.
        const terms = await searchTermsFor('1 cup cooked quinoa', { normalizedForm: 'quinoa' });
        expect(terms.length).toBeGreaterThan(0);
        expect(terms.every(t => t.toLowerCase().split(/\s+/).includes('cooked'))).toBe(false);
    });

    it('a line with no qualifier gains nothing', async () => {
        // MUTATION: append unconditionally (undefined → "quinoa undefined").
        const terms = await searchTermsFor('chicken breast');
        expect(terms.length).toBeGreaterThan(0);
        for (const t of terms) {
            expect(t.toLowerCase()).not.toContain('undefined');
            expect(t.toLowerCase().split(/\s+/)).not.toContain('cooked');
        }
    });

    it('does not duplicate a qualifier the name already carries', async () => {
        // MUTATION: drop the `!present.has(q)` check → "cooked cooked quinoa".
        const terms = await searchTermsFor('1 cup cooked quinoa');
        for (const t of terms) {
            const cookedCount = t.toLowerCase().split(/\s+/).filter(w => w === 'cooked').length;
            expect(cookedCount).toBeLessThanOrEqual(1);
        }
    });
});
