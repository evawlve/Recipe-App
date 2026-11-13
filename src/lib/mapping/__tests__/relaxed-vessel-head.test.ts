/**
 * A trailing vessel word (`falafel plate`) is not the relaxed head noun (C70 S239).
 *
 * Mechanism: `falafel plate` -> must-have [falafel, plate]; strict admits 0; the relaxed pass kept
 * only `plate`, so the lone `Veal Breast (Plate Half...)` survived unscored. The relaxed block now
 * re-aims onto the food token with `plate` as the ordered fallback (non-monotone on its fire set,
 * NOT admit-only). Master's outputs below were read from the unedited code BEFORE the change and
 * are hard-coded; every control must equal them.
 */
import {
    filterCandidatesByTokens,
    VESSEL_WORDS,
    VESSEL_QUALIFIER_WORDS,
} from '../filter-candidates';

const mk = (name: string, brandName: string | null = null, source = 'fatsecret') =>
    ({ id: name, source, name, brandName, score: 1, rawData: null } as any);

const VEAL = 'Veal Breast (Plate Half, Cooked, Braised)';
const POOL = [
    mk(VEAL), mk('Falafel'), mk('Falafel Patties', 'Acme', 'openfoodfacts'),
    mk('Beef Plate (Cooked)'), mk('Hummus'), mk('Hummus Plate'), mk('Breakfast Plate'), mk('Charcuterie Plate'),
    mk('Short Rib Plate'), mk('Chicken Finger Plate', "Zaxby's"), mk('Mediterranean Hummus Plate'),
    mk('Spaghetti with Meat Sauce'), mk('Appetizer Sampler Platter'), mk('Fruit Platter'), mk('Cheese Platter'),
    mk('Seafood Platter'), mk('Dinner Plate'), mk('Dinner Ham'), mk('Dinner Roll'), mk('Kids Combo'),
    mk('Party Mix'), mk('Big Mac'), mk('Combo Plate'), mk('Kids Plate'), mk('Party Platter'), mk('Big Plate'),
    mk('Panda Express Plate', 'Panda Express'), mk('Skirt Steak'), mk('Chicken Finger', "Zaxby's"),
];
const relaxed = (line: string, pool = POOL) =>
    filterCandidatesByTokens(pool, line, { relaxed: true }).filtered.map((c: any) => c.name);

const PLATES = [
    VEAL, 'Hummus Plate', 'Charcuterie Plate', 'Short Rib Plate', 'Mediterranean Hummus Plate',
    'Combo Plate', 'Kids Plate', 'Big Plate', 'Panda Express Plate',
];
const PLATTERS = ['Appetizer Sampler Platter', 'Fruit Platter', 'Cheese Platter', 'Seafood Platter', 'Party Platter'];

describe('vessel head re-aim', () => {
    it('falafel plate admits the falafel records and NOT the veal cut', () => {
        const out = relaxed('falafel plate');
        expect(out).toEqual(['Falafel']);
        expect(out).not.toContain(VEAL);
    });

    it('falls back to master when the food token admits nothing (mezze platter)', () => {
        expect(relaxed('mezze platter')).toEqual(PLATTERS);
    });

    it.each([
        ['dinner plate', ['Dinner Plate']],
        ['combo plate', ['Combo Plate']],
        ['kids plate', ['Kids Plate']],
        ['party platter', ['Party Platter']],
        ['big plate', ['Big Plate']],
    ])('qualifier line %s equals master', (line) => {
        // master: the relaxed pass keeps the [plate]/[platter] admission, never the qualifier food token
        const expected = line.endsWith('platter') ? PLATTERS : [
            VEAL, 'Hummus Plate', 'Charcuterie Plate', 'Short Rib Plate', 'Mediterranean Hummus Plate',
            ...(line === 'dinner plate' ? ['Dinner Plate'] : []),
            'Combo Plate', 'Kids Plate', 'Big Plate', 'Panda Express Plate',
        ];
        const exp = line === 'dinner plate'
            ? [VEAL, 'Hummus Plate', 'Charcuterie Plate', 'Short Rib Plate', 'Mediterranean Hummus Plate', 'Dinner Plate', 'Combo Plate', 'Kids Plate', 'Big Plate', 'Panda Express Plate']
            : expected;
        expect(relaxed(line)).toEqual(exp);
    });

    it('brand lines equal master', () => {
        expect(relaxed('zaxbys chicken finger plate')).toEqual(['Chicken Finger Plate', 'Chicken Finger']);
        expect(relaxed('panda express plate')).toEqual(['Panda Express Plate']);
    });

    it('controls equal master', () => {
        // Lines whose STRICT pass admits >= 1 never reach the relaxed pass (the caller retries relaxed
        // only on an empty strict pool), so for them the pin is: strict is unchanged and non-empty.
        const strict = (line: string) =>
            filterCandidatesByTokens(POOL, line, { relaxed: false }).filtered.map((c: any) => c.name);
        expect(strict('beef plate')).toEqual(['Beef Plate (Cooked)']);
        expect(strict('hummus plate')).toEqual(['Hummus Plate', 'Mediterranean Hummus Plate']);
        expect(strict('breakfast plate')).toEqual(['Breakfast Plate']);
        expect(strict('charcuterie plate')).toEqual(['Charcuterie Plate']);
        expect(strict('sampler platter')).toEqual(['Appetizer Sampler Platter']);
        expect(strict('fruit platter')).toEqual(['Fruit Platter']);
        expect(strict('cheese platter')).toEqual(['Cheese Platter']);
        expect(strict('seafood platter')).toEqual(['Seafood Platter']);
        expect(strict('a dinner plate of spaghetti')).toEqual(['Dinner Plate']);
        expect(strict('chicken finger plate')).toEqual(['Chicken Finger Plate', 'Chicken Finger']);
        // Lines the rule never fires on (last required token is not a vessel word / not the last word):
        expect(relaxed('plate short rib')).toEqual(['Short Rib Plate']);
        expect(relaxed('veal breast plate')).toEqual([VEAL]);
        expect(relaxed('mediterranean hummus plate')).toEqual(['Hummus', 'Hummus Plate', 'Mediterranean Hummus Plate']);
        expect(relaxed('chicken finger plate')).toEqual(['Chicken Finger Plate', 'Chicken Finger']);
        expect(relaxed('a dinner plate of spaghetti')).toEqual(
            [VEAL, 'Hummus Plate', 'Charcuterie Plate', 'Short Rib Plate', 'Mediterranean Hummus Plate', 'Dinner Plate', 'Combo Plate', 'Kids Plate', 'Big Plate', 'Panda Express Plate']);
        expect(relaxed('skirt steak')).toEqual(['Skirt Steak']);
    });

    it('a non-qualifier food token in a vessel line re-aims (spaghetti plate)', () => {
        expect(relaxed('spaghetti plate')).toEqual(['Spaghetti with Meat Sauce']);
    });

    it('membership pins', () => {
        expect([...VESSEL_WORDS].sort()).toEqual(['plate', 'plates', 'platter', 'platters']);
        // `bowl` is a dish head (burrito bowl, poke bowl); `basket`, `box`, `board`, `combo` likewise.
        for (const w of ['bowl', 'basket', 'box', 'board', 'combo']) expect(VESSEL_WORDS.has(w)).toBe(false);
        // removing `dinner` re-opens `dinner plate` -> Dinner Ham / Dinner Roll
        for (const w of ['dinner', 'combo', 'kids', 'party', 'sampler', 'breakfast', 'big']) {
            expect(VESSEL_QUALIFIER_WORDS.has(w)).toBe(true);
        }
        expect(VESSEL_QUALIFIER_WORDS.size).toBe(37);
    });
});
