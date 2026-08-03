/**
 * The identity discriminator must reach RETRIEVAL, not only the cache key.
 *
 * `extractUnitHint()` strips `white`/`yolk` off the name, so
 * `parseIngredientLine("egg whites")` yields `name: "egg"` with
 * `unitHint: "white"`. `baseName` — the primary search term — became bare `egg`.
 *
 * Measured cold on the box 2026-08-02: `MappingEventLog.normalizedForm` was
 * `egg` for BOTH `egg whites` and `egg yolk`, and both resolved to `fs_3092`
 * "Egg" (147 kcal, 9.9 g fat) — one record answering two opposite halves of a
 * food. Golden n-mq-31 wants fat100 in [0,1]; n-mq-32 wants [20,40]; a single
 * record cannot satisfy both.
 *
 * `deriveCacheKeyName()` already restores these hints via IDENTITY_UNIT_HINTS,
 * which is why the WARM keys `egg white` / `egg yolk` hold the right FDC records
 * and the warm gate is green. The only code that ever did the same for the QUERY
 * is `buildCoreQuery()` in query-builder.ts, which has no runtime importer.
 *
 * These tests assert the search term itself rather than the final pick: the pick
 * depends on corpus state, the search term is what this change controls. Each
 * names the mutation it kills.
 */

const mockGatherCandidates = jest.fn();

// Generic prisma stub: every model answers "nothing found" for any query verb.
// Enumerating models by hand made this file assert nothing once — the mapper hit
// an unmocked model, threw before retrieval, and the search-term list came back
// empty, which passed nothing and looked like a code failure.
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
async function searchTermsFor(line: string): Promise<string[]> {
    mockGatherCandidates.mockResolvedValue([]);
    await mapIngredientWithFallback(line, { skipCache: true, skipSave: true } as never)
        .catch(() => undefined);
    return mockGatherCandidates.mock.calls.map(c => String(c[2] ?? ''));
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('the parse layer really does strip the discriminator', () => {
    it('"egg whites" parses to name "egg" with unitHint "white"', () => {
        // Not a test of my change — it pins the PREMISE. If this ever stops
        // holding, the restoration below is solving a problem that moved.
        const p = parseIngredientLine('egg whites');
        expect(p?.name?.toLowerCase().trim()).toBe('egg');
        expect(p?.unitHint?.toLowerCase()).toBe('white');
    });

    it('"egg yolk" parses to name "egg" with unitHint "yolk"', () => {
        const p = parseIngredientLine('egg yolk');
        expect(p?.name?.toLowerCase().trim()).toBe('egg');
        expect(p?.unitHint?.toLowerCase()).toBe('yolk');
    });
});

describe('the discriminator reaches the search query', () => {
    it('"egg whites" searches for the WHITE, not bare egg', async () => {
        // MUTATION: delete the restoration block. Kills it — every search term
        // is bare "egg", which is what made n-mq-31 and n-mq-32 return one record.
        const terms = await searchTermsFor('egg whites');
        expect(terms.length).toBeGreaterThan(0);
        expect(terms.every(t => t.toLowerCase().includes('white'))).toBe(true);
    });

    it('"egg yolk" searches for the YOLK', async () => {
        // MUTATION: hardcode the restored hint to 'white'.
        const terms = await searchTermsFor('egg yolk');
        expect(terms.length).toBeGreaterThan(0);
        expect(terms.every(t => t.toLowerCase().includes('yolk'))).toBe(true);
    });

    it('the two lines no longer search for the same thing', async () => {
        // MUTATION: restore the hint but drop it from baseName. This is the whole
        // defect stated directly — one search term for two opposite foods.
        const whites = await searchTermsFor('egg whites');
        jest.clearAllMocks();
        const yolks = await searchTermsFor('egg yolk');
        expect(whites[0]).not.toBe(yolks[0]);
    });
});

describe('the restoration is bounded', () => {
    it('a PIECE hint is not an identity hint — "romaine leaves" is unchanged', async () => {
        // MUTATION: replace IDENTITY_UNIT_HINTS with "any unitHint". `leaf` is a
        // serving concern, not a different food, and must not enter the query.
        const terms = await searchTermsFor('5 romaine leaves');
        expect(terms.length).toBeGreaterThan(0);
        expect(terms.some(t => t.toLowerCase().includes('leaf')
            || t.toLowerCase().includes('leaves'))).toBe(false);
    });

    it('a line with no unit hint gains nothing', async () => {
        // MUTATION: append the hint unconditionally (undefined → "egg undefined").
        //
        // Asserts only that NO discriminator was added. An earlier version of this
        // test demanded every search term equal the raw line and failed on correct
        // code: the mapper legitimately issues several gathers with differently
        // derived terms, none of which this change controls.
        const terms = await searchTermsFor('chicken breast');
        expect(terms.length).toBeGreaterThan(0);
        for (const t of terms) {
            expect(t.toLowerCase()).not.toContain('undefined');
            expect(t.toLowerCase().split(/\s+/)).not.toContain('white');
            expect(t.toLowerCase().split(/\s+/)).not.toContain('yolk');
        }
    });

    it('does not double-append when the name already carries the word', async () => {
        // MUTATION: drop the `!baseName.split(...).includes(hint)` guard, which
        // would produce "egg white white" — canonicalizeCacheKey does not dedupe.
        const terms = await searchTermsFor('egg white');
        expect(terms.length).toBeGreaterThan(0);
        for (const t of terms) {
            const whites = t.toLowerCase().split(/\s+/).filter(w => w === 'white');
            expect(whites.length).toBeLessThanOrEqual(1);
        }
    });
});
