/**
 * normalizeIngredientName's output must not depend on the database.
 *
 * Until 2026-08-01 refreshNormalizationRules() merged prepPhrases read out of
 * AiNormalizeCache into the module-scope list that normalizeIngredientName consumes — and
 * normalizeIngredientName computes the keys AiNormalizeCache is stored under. The table
 * mutated the function that keys it, so rows written with the loop armed became unreachable
 * when it was disarmed and vice versa. Nothing tested it, which is how it survived.
 *
 * The loop was not merely circular, it was destructive: the 22 phrases the live table held
 * include 'sandwich', 'fried' and 'breaded', which repoint specific queries onto bare
 * generic keys. That is the same class of repointing that broke five golden cases in PR #143.
 */

const mockFindMany = jest.fn();
jest.mock('../../db', () => ({
    prisma: { aiNormalizeCache: { findMany: (...args: unknown[]) => mockFindMany(...args) } },
}));

import * as fs from 'fs';
import * as path from 'path';
import {
    refreshNormalizationRules,
    getMergedPrepPhrases,
    normalizeIngredientName,
    clearRulesCache,
} from '../normalization-rules';

/** The 22 distinct phrases the live table holds. MEASURED 2026-08-01, re-derive with:
 *  ssh owner@192.168.1.133 'docker exec mealspire-db psql -U postgres -d mealspire -t -A -c
 *    "SELECT DISTINCT lower(trim(p)) FROM \"AiNormalizeCache\",
 *     jsonb_array_elements_text(\"prepPhrases\") AS p ORDER BY 1"' */
const LIVE_LEARNED_PHRASES = [
    'breaded', 'crumbled', 'crushed', 'dry', 'fried', 'grilled', 'homemade', 'hot',
    'mashed', 'melted', 'overnight', 'pan seared', 'pinch', 'sandwich', 'scrambled',
    'secret', 'spray', 'stir fry', 'with chicken', 'with honey', 'with strawberries',
    'with yogurt',
];

function staticPrepPhrases(): string[] {
    const raw = fs.readFileSync(
        path.resolve(process.cwd(), 'data/fatsecret/normalization-rules.json'),
        'utf8',
    );
    return JSON.parse(raw).prep_phrases as string[];
}

beforeEach(() => {
    mockFindMany.mockReset();
    clearRulesCache();
});

describe('refreshNormalizationRules reads the static file and nothing else', () => {
    it('never touches the database', async () => {
        await refreshNormalizationRules();

        expect(mockFindMany).not.toHaveBeenCalled();
    });

    it('produces exactly the static prep_phrases', async () => {
        await refreshNormalizationRules();

        expect(getMergedPrepPhrases()).toEqual([...new Set(staticPrepPhrases())]);
    });

    it('is idempotent — refreshing twice cannot grow the list', async () => {
        await refreshNormalizationRules();
        const first = getMergedPrepPhrases().length;
        await refreshNormalizationRules();

        expect(getMergedPrepPhrases().length).toBe(first);
    });
});

describe('a learned phrase cannot repoint a key onto a bare generic', () => {
    /** What computeNormalizedKey does to an already-parsed food name. */
    const key = (name: string) => normalizeIngredientName(name).cleaned.toLowerCase().trim();

    it('keeps chicken sandwich, fried rice and breaded chicken distinct', async () => {
        await refreshNormalizationRules();

        expect(key('chicken sandwich')).toBe('chicken sandwich');
        expect(key('fried rice')).toBe('fried rice');
        expect(key('breaded chicken')).toBe('breaded chicken');
    });

    it('guard: membership of this list IS what collapses a key', async () => {
        // Non-vacuity, in two halves.
        //
        // (a) The mechanism is real: 'grilled' is a static prep phrase, and a query
        //     carrying it loses it and lands on the bare generic.
        await refreshNormalizationRules();
        expect(staticPrepPhrases()).toContain('grilled');
        expect(key('grilled chicken')).toBe('chicken');

        // (b) 'sandwich', 'fried' and 'breaded' are live learned phrases that are NOT in the
        //     static file. The old refresh put them in exactly the position 'grilled'
        //     occupies above, which is how 'chicken sandwich' became 'chicken'.
        //     If this ever fails, the static file has absorbed one of them deliberately and
        //     the assertions above are no longer measuring the loop.
        const notStatic = LIVE_LEARNED_PHRASES.filter(p => !staticPrepPhrases().includes(p));
        expect(notStatic).toContain('sandwich');
        expect(notStatic).toContain('fried');
        expect(notStatic).toContain('breaded');
    });
});
