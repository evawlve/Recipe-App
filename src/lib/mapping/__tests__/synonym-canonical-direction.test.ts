/**
 * D-A9 (2026-08-24): the synonym canonicalizer runs British -> American ONLY.
 *
 * Before this, `findCanonicalName()` read the static map in both directions and
 * followed any LearnedSynonym row, and `saveSynonyms()` stored `synonym -> record
 * name` whichever side the record was named in. Live effect on the box
 * (3JD249AyleJUI2qu0ZERF): bare `ham` -> Morrison's Gammon, `ground beef` ->
 * generic "Beef" via the prep-stripped key `beef`, `baking soda` -> a soft drink.
 * Owner: sync-docs/reports/2026-08-24_the-canonicalizer-rewrites-us-staples-into-uk-vocabulary.md
 *
 * These pins are what would have caught it: they call the shipped functions, not a
 * replica, and assert the DIRECTION rather than any one pair.
 */

const mockFindMany = jest.fn();
const mockUpdate = jest.fn();
const mockUpsert = jest.fn();

jest.mock('../../db', () => ({
    prisma: {
        learnedSynonym: {
            findMany: (...args: unknown[]) => mockFindMany(...args),
            update: (...args: unknown[]) => mockUpdate(...args),
            upsert: (...args: unknown[]) => mockUpsert(...args),
        },
    },
}));

import {
    canonicalizeBritishTerm,
    findCanonicalName,
    getKnownSynonyms,
    isBritishKey,
    isCanonicalDirection,
    saveSynonyms,
} from '../ai-synonym-generator';

beforeEach(() => {
    jest.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockUpdate.mockResolvedValue({});
    mockUpsert.mockResolvedValue({});
});

describe('static direction', () => {
    it('canonicalizes a British key to its American term', () => {
        expect(canonicalizeBritishTerm('gammon')).toBe('ham');
        expect(canonicalizeBritishTerm('minced beef')).toBe('ground beef');
        expect(canonicalizeBritishTerm('bicarbonate of soda')).toBe('baking soda');
        expect(canonicalizeBritishTerm('  Courgette ')).toBe('zucchini');
    });

    it('returns null for an American term even though the reverse map knows it', () => {
        // The reverse map still exists for the WRITER — that is the whole point of the split.
        expect(getKnownSynonyms('ham')).toEqual(['gammon']);
        expect(getKnownSynonyms('ground beef')).toEqual(['minced beef', 'beef mince']);
        for (const us of ['ham', 'ground beef', 'ground chicken', 'baking soda', 'light corn syrup', 'shrimp', 'arugula', 'zucchini', 'eggplant', 'corn']) {
            expect(canonicalizeBritishTerm(us)).toBeNull();
        }
    });

    it('classifies keys and directions', () => {
        expect(isBritishKey('gammon')).toBe(true);
        expect(isBritishKey('ham')).toBe(false);
        expect(isBritishKey('prawns')).toBe(true);
        expect(isCanonicalDirection('gammon', 'ham')).toBe(true);
        expect(isCanonicalDirection('ham', 'gammon')).toBe(false);
        expect(isCanonicalDirection('shrimp', 'prawns')).toBe(false);
        // A pair the map does not know is not a direction question.
        expect(isCanonicalDirection('icing', 'powdered sugar')).toBe(true);
    });
});

describe('findCanonicalName()', () => {
    it('never rewrites a bare American term from the static map', async () => {
        for (const us of ['ham', 'ground beef', 'ground chicken', 'baking soda', 'light corn syrup']) {
            await expect(findCanonicalName(us)).resolves.toBeNull();
        }
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('still rewrites a bare British term to the American canonical', async () => {
        await expect(findCanonicalName('gammon')).resolves.toBe('ham');
        await expect(findCanonicalName('Minced Beef')).resolves.toBe('ground beef');
    });

    it('skips a LearnedSynonym row whose target is a British key and falls through', async () => {
        // The live shape on 2026-08-24: `ham -> gammon`, useCount 126.
        mockFindMany.mockResolvedValue([
            { id: 'row-1', sourceTerm: 'ham', targetTerm: 'gammon', useCount: 126 },
        ]);
        await expect(findCanonicalName('ham')).resolves.toBeNull();
        expect(mockUpdate).not.toHaveBeenCalled(); // a skipped row is not a hit: no useCount bump
    });

    it('follows a LearnedSynonym row that points at a canonical, and bumps its useCount', async () => {
        mockFindMany.mockResolvedValue([
            { id: 'row-wrong', sourceTerm: 'all-purpose flour', targetTerm: 'plain flour', useCount: 100 },
            { id: 'row-ai', sourceTerm: 'all-purpose flour', targetTerm: 'ap flour', useCount: 1 },
        ]);
        await expect(findCanonicalName('all-purpose flour')).resolves.toBe('ap flour');
        expect(mockUpdate).toHaveBeenCalledTimes(1);
        expect(mockUpdate.mock.calls[0][0]).toMatchObject({ where: { id: 'row-ai' } });
    });

    it('reads rows by the lower-cased trimmed term, highest useCount first', async () => {
        await findCanonicalName('  Prawns ');
        expect(mockFindMany).toHaveBeenCalledWith({
            where: { sourceTerm: 'prawns' },
            orderBy: { useCount: 'desc' },
        });
    });
});

describe('saveSynonyms()', () => {
    it('stores a record named with the British term as british -> american', async () => {
        // A resolution onto "Gammon" arrives as canonical=gammon, synonyms=['ham'].
        await expect(saveSynonyms('Gammon', ['ham'], 'known')).resolves.toBe(1);
        expect(mockUpsert).toHaveBeenCalledTimes(1);
        const call = mockUpsert.mock.calls[0][0];
        expect(call.create).toMatchObject({ sourceTerm: 'gammon', targetTerm: 'ham', source: 'known', confidence: 1.0 });
        expect(call.where).toEqual({ sourceTerm_targetTerm: { sourceTerm: 'gammon', targetTerm: 'ham' } });
    });

    it('stores a record named with the American term as british -> american, unchanged from before', async () => {
        await expect(saveSynonyms('Ground Beef', ['minced beef', 'beef mince'], 'known')).resolves.toBe(2);
        const pairs = mockUpsert.mock.calls.map((c) => [c[0].create.sourceTerm, c[0].create.targetTerm]);
        expect(pairs).toEqual([['minced beef', 'ground beef'], ['beef mince', 'ground beef']]);
    });

    it('never persists a British canonical, whichever side it arrives on', async () => {
        await saveSynonyms('gammon', ['ham'], 'known');
        await saveSynonyms('ham', ['gammon'], 'known');
        await saveSynonyms('prawns', ['shrimp'], 'known');
        for (const c of mockUpsert.mock.calls) {
            expect(isBritishKey(c[0].create.targetTerm)).toBe(false);
        }
        expect(mockUpsert).toHaveBeenCalledTimes(3);
    });

    it('drops a pair with no American side instead of storing an inverting row', async () => {
        await expect(saveSynonyms('mangetout', ['mange tout'], 'known')).resolves.toBe(0);
        expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('keeps the pre-existing skips (empty, same as canonical, too short)', async () => {
        await expect(saveSynonyms('ham', ['', 'ham', 'hm'], 'ai')).resolves.toBe(0);
        expect(mockUpsert).not.toHaveBeenCalled();
    });
});
