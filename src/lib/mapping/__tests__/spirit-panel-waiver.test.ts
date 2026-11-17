/**
 * The spirit-panel waiver in hasNullOrInvalidMacros() (s461 pd-ident, SPIRIT-PANEL).
 *
 * THE DEFECT (measured cold on deploy 46, 2026-11-16). FatSecret's generic Rum (fs_7582), Vodka (fs_7731), Gin (fs_7581)
 * and Tequila (fs_305929) come back from the FatSecret lane at API rank #1 for `rum` / `vodka` / `gin` / `tequila`, and
 * their stored panels are 231-263 kcal/100 g with protein = carbs = fat = 0: the energy is ethanol, which is not a macro.
 * The caloric branch ("P = 0, C = 0, fat explains < 50 %") deleted all four at the token filter, so `rum` and `shot of rum`
 * billed OFF "Rum ckae" (398 kcal/100 g). Whiskey (fs_7693) survived only because its panel carries carbs 0.1.
 * The waiver needs the LINE and the candidate NAME to both name a spirit, and fat = 0.
 */
import { hasNullOrInvalidMacros, filterCandidatesByTokens, isSpiritPanelForSpiritLine, SPIRIT_WORD_RE } from '../filter-candidates';
import type { UnifiedCandidate } from '../gather-candidates';
import { logger } from '../../logger';

// The stored FatSecretFood panels (read-only SELECT, 2026-11-16).
const RUM = { calories: 231, protein: 0, carbs: 0, fat: 0 };
const GIN = { calories: 263, protein: 0, carbs: 0, fat: 0 };

function cand(id: string, name: string, panel: { calories: number; protein: number; carbs: number; fat: number }, brandName?: string): UnifiedCandidate {
    return {
        id,
        source: 'fatsecret',
        name,
        brandName,
        score: 1,
        foodType: 'generic',
        nutrition: { per100g: true, kcal: panel.calories, protein: panel.protein, carbs: panel.carbs, fat: panel.fat } as any,
        rawData: { nutrientsPer100g: { ...panel } },
    } as unknown as UnifiedCandidate;
}

describe('SPIRIT_WORD_RE', () => {
    it.each(['rum', 'shot of rum', 'a vodka soda', 'gin and tonic', '2 shots of tequila', 'whiskey', 'bourbon', 'mezcal', 'Rum (90 Proof)', 'un ron', 'Ron Bacardi'])(
        'matches %s', (s) => expect(SPIRIT_WORD_RE.test(s)).toBe(true));
    it.each(['ginger', 'rump steak', 'a beer', 'a glass of red wine', 'a margarita', 'gingerbread', 'drum', 'iron', 'ronzoni penne'])(
        'does not match %s', (s) => expect(SPIRIT_WORD_RE.test(s)).toBe(false));
});

describe('hasNullOrInvalidMacros — the spirit-panel waiver needs the line, the name and fat = 0', () => {
    it.each([
        ['Rum', 'rum'], ['Rum', 'shot of rum'], ['Rum', '1.5 oz rum'], ['Vodka', 'a vodka soda'],
        ['Tequila', '2 shots of tequila'], ['Superior Rum', 'white rum'], ['Rum', 'un ron'],
    ])('(1) admits a 231/0/0/0 "%s" for `%s`', (name, line) => {
        expect(hasNullOrInvalidMacros(RUM, name, line)).toBe(false);
    });
    it('(2) admits the 263/0/0/0 "Gin" for `gin and tonic`', () => {
        expect(hasNullOrInvalidMacros(GIN, 'Gin', 'gin and tonic')).toBe(false);
    });
    it('(3) a caller with no line keeps today\'s rejection', () => {
        expect(hasNullOrInvalidMacros(RUM, 'Rum')).toBe(true);
        expect(hasNullOrInvalidMacros(RUM)).toBe(true);
    });
    it('(4) still rejects when the LINE names no spirit', () => {
        expect(hasNullOrInvalidMacros(RUM, 'Rum', 'a pirate drink')).toBe(true);
        expect(hasNullOrInvalidMacros(RUM, 'Rum', 'a margarita')).toBe(true);
    });
    it('(5) still rejects when the NAME names no spirit (a corrupt caloric row)', () => {
        expect(hasNullOrInvalidMacros({ calories: 314, protein: 0, carbs: 0, fat: 0 }, 'Red Lentils', 'rum and red lentils')).toBe(true);
        expect(hasNullOrInvalidMacros(RUM, 'Cola', 'rum and coke')).toBe(true);
    });
    it('(6) still rejects a spirit-named row that carries fat (not an ethanol-only panel)', () => {
        expect(hasNullOrInvalidMacros({ calories: 300, protein: 0, carbs: 0, fat: 5 }, 'Rum', 'rum')).toBe(true);
    });
    it('(7) the red-lentil true positive the branch was written for still fires', () => {
        expect(hasNullOrInvalidMacros({ calories: 314, protein: 0, carbs: 0, fat: 2.86 }, 'Red Lentils', 'red lentils')).toBe(true);
    });
    it('(8) isSpiritPanelForSpiritLine is the whole condition', () => {
        expect(isSpiritPanelForSpiritLine({ fat: 0 }, 'Vodka', 'vodka')).toBe(true);
        expect(isSpiritPanelForSpiritLine({ fat: null }, 'Vodka', 'vodka')).toBe(true);
        expect(isSpiritPanelForSpiritLine({ fat: 0 }, 'Vodka', undefined)).toBe(false);
        expect(isSpiritPanelForSpiritLine({ fat: 0 }, undefined, 'vodka')).toBe(false);
    });
});

describe('(9) through filterCandidatesByTokens(): the token filter passes the line', () => {
    let infoSpy: jest.SpyInstance;
    beforeEach(() => { infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => undefined); });
    afterEach(() => infoSpy.mockRestore());

    const macroDrops = (candidateName: string) => infoSpy.mock.calls.filter(
        ([msg, meta]) => msg === 'filter.candidates.null_or_invalid_macros' && meta?.candidate === candidateName);

    it.each([
        ['fs_7582', 'Rum', 'rum', RUM],
        ['fs_7731', 'Vodka', 'vodka', RUM],
        ['fs_7581', 'Gin', 'gin', GIN],
        ['fs_305929', 'Tequila', 'tequila', RUM],
    ])('%s "%s" is not dropped by the macro rule for `%s`', (id, name, line, panel) => {
        const { filtered } = filterCandidatesByTokens([cand(id, name, panel)], line, { rawLine: line, debug: true });
        expect(macroDrops(name)).toHaveLength(0);
        expect(filtered.map(c => c.id)).toContain(id);
    });

    it('the same Rum IS dropped by the macro rule when the line names no spirit (the spy can see a drop)', () => {
        filterCandidatesByTokens([cand('fs_7582', 'Rum', RUM)], 'rum', { rawLine: 'a pirate drink', debug: true });
        expect(macroDrops('Rum')).toHaveLength(1);
    });
});
