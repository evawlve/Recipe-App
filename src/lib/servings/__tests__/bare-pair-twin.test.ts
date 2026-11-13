/**
 * Bare-pair twin (C70 / S239): a bare plural of a countable prepared food is
 * served as its digit twin ("pancakes" === "2 pancakes"), kept only when the
 * twin billed PER PIECE. Pins barePairTwin() and the wrapper in
 * hydrateAndSelectServing().
 *
 * Unreachable-by-design note: the legacy branch of the dispatch mutates
 * `parsed.unit` for names ending bunch/head/stalk (TRAILING_UNIT_REGEX). Under
 * the twin that mutation lands on the LOCAL copy; no pair tail ends in those
 * words, so it stays unreachable.
 */
import { parseIngredientLine, type ParsedIngredient } from '../../parse/ingredient-line';
import { barePairTwin } from '../bare-query-guard';
import { hydrateAndSelectServing } from '../../mapping/serving/hydration-lane';
import { buildFatSecretResult } from '../../mapping/build-fatsecret-result';

jest.mock('../../db', () => ({ prisma: {} }));
jest.mock('../../mapping/build-fatsecret-result', () => ({
    buildFatSecretResult: jest.fn(),
}));

const mockedBuild = buildFatSecretResult as jest.Mock;

function twin(line: string): boolean {
    const parsed = parseIngredientLine(line);
    return barePairTwin(parsed, line);
}

describe('barePairTwin()', () => {
    it.each([
        'pancakes', 'buttermilk pancakes', 'blueberry pancakes', 'chocolate chip pancakes',
        'protein pancakes', 'hot dogs', 'scrambled eggs', 'hard boiled eggs', 'hard-boiled eggs',
        'fried eggs', 'poached eggs', 'over easy eggs', 'sunny side up eggs',
    ])('%j is a pair line', (line) => {
        expect(twin(line)).toBe(true);
    });

    it.each([
        'eggs', 'large eggs', 'organic eggs', 'quail eggs', 'cadbury mini eggs', 'deviled eggs',
        'steak and eggs', 'bacon and eggs', 'chicken and waffles', 'waffles', 'sausage links',
        'tortillas', 'hotcakes', 'flapjacks', 'hotdogs', 'silver dollar pancakes', 'ihop pancakes',
        'a stack of pancakes', 'a stack of three buttermilk pancakes', 'pancake mix',
        'hot dog buns', '2 pancakes', 'pancake', 'almonds', 'chips',
    ])('%j is not a pair line', (line) => {
        expect(twin(line)).toBe(false);
    });

    it('is false for null parsed and for a multiplier other than 1', () => {
        expect(barePairTwin(null, 'pancakes')).toBe(false);
        const parsed = parseIngredientLine('pancakes') as ParsedIngredient;
        expect(barePairTwin({ ...parsed, multiplier: 2 }, 'pancakes')).toBe(false);
    });
});

describe('hydrateAndSelectServing() bare-pair twin wrapper', () => {
    const candidate = { id: 'fs_123', source: 'fatsecret' as const, name: 'Pancakes', score: 1 } as any;
    const result = (over: Record<string, unknown>) => ({
        source: 'fatsecret', foodId: 'fs_123', foodName: 'Pancakes', grams: 76, kcal: 1,
        protein: 0, carbs: 0, fat: 0, confidence: 1, quality: 'high', rawLine: '2 pancakes', ...over,
    });

    beforeEach(() => mockedBuild.mockReset());

    it('hands the builder a qty-2 copy and "2 "-prefixed rawLine, keeps an allowed tier, restores rawLine', async () => {
        mockedBuild.mockResolvedValueOnce(result({ servingTier: 'seed_count_default' }));
        const parsed = parseIngredientLine('pancakes') as ParsedIngredient;
        const snapshot = JSON.parse(JSON.stringify(parsed));
        const out = await hydrateAndSelectServing(candidate, parsed, 0.9, 'pancakes');
        expect(mockedBuild).toHaveBeenCalledTimes(1);
        const [, seenParsed, , seenRaw] = mockedBuild.mock.calls[0];
        expect(seenParsed.qty).toBe(2);
        expect(seenRaw).toBe('2 pancakes');
        expect(out?.servingTier).toBe('seed_count_default');
        expect(out?.rawLine).toBe('pancakes');
        expect(parsed).toEqual(snapshot);
        expect(parsed.qty).toBe(1);
    });

    it.each(['fs_serving_macros_only', 'label_serving_default'])(
        'rejects twin tier %s and returns the bare result',
        async (tier) => {
            mockedBuild
                .mockResolvedValueOnce(result({ servingTier: tier }))
                .mockResolvedValueOnce(result({ servingTier: 'bare_plural_serving', rawLine: 'pancakes' }));
            const parsed = parseIngredientLine('pancakes') as ParsedIngredient;
            const out = await hydrateAndSelectServing(candidate, parsed, 0.9, 'pancakes');
            expect(mockedBuild).toHaveBeenCalledTimes(2);
            expect(mockedBuild.mock.calls[1][1].qty).toBe(1);
            expect(mockedBuild.mock.calls[1][3]).toBe('pancakes');
            expect(out?.servingTier).toBe('bare_plural_serving');
        },
    );

    it('rejects fs_default_serving on a "1 serving" description, keeps it on a per-piece one', async () => {
        mockedBuild
            .mockResolvedValueOnce(result({ servingTier: 'fs_default_serving', servingDescription: '1 serving' }))
            .mockResolvedValueOnce(result({ servingTier: 'bare_plural_serving' }));
        const parsed = parseIngredientLine('pancakes') as ParsedIngredient;
        const rejected = await hydrateAndSelectServing(candidate, parsed, 0.9, 'pancakes');
        expect(rejected?.servingTier).toBe('bare_plural_serving');

        mockedBuild.mockReset();
        mockedBuild.mockResolvedValueOnce(result({ servingTier: 'fs_default_serving', servingDescription: '1 large' }));
        const kept = await hydrateAndSelectServing(candidate, parsed, 0.9, 'pancakes');
        expect(mockedBuild).toHaveBeenCalledTimes(1);
        expect(kept?.servingDescription).toBe('1 large');
    });

    it('a null twin falls back to the bare dispatch', async () => {
        mockedBuild.mockResolvedValueOnce(null).mockResolvedValueOnce(result({ servingTier: 'bare_plural_serving' }));
        const parsed = parseIngredientLine('pancakes') as ParsedIngredient;
        const out = await hydrateAndSelectServing(candidate, parsed, 0.9, 'pancakes');
        expect(mockedBuild).toHaveBeenCalledTimes(2);
        expect(out?.servingTier).toBe('bare_plural_serving');
    });

    it('a non-pair line runs ONE dispatch with unchanged args', async () => {
        mockedBuild.mockResolvedValueOnce(result({ servingTier: 'bare_plural_serving', rawLine: 'almonds' }));
        const parsed = parseIngredientLine('almonds') as ParsedIngredient;
        await hydrateAndSelectServing(candidate, parsed, 0.9, 'almonds');
        expect(mockedBuild).toHaveBeenCalledTimes(1);
        const [, seenParsed, , seenRaw] = mockedBuild.mock.calls[0];
        expect(seenParsed).toBe(parsed);
        expect(seenRaw).toBe('almonds');
    });
});
