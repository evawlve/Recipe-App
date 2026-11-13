import { assessRankTimePlausibility } from '../macro-plausibility';

/**
 * The diet and poured drink rank-time rules (cloud-42 F1-F3, D2): word lists match plural-folded, and the headLine exemptions are read
 * from its first clause only (a sibling item's word must not silence the item). RF1 / RF2 / RF3 / RD2 are the review's reproductions.
 */

const REG = { kcal: 42, protein: 0, carbs: 10.6, fat: 0 };
const dietReg = (q: string, head?: string) =>
    assessRankTimePlausibility(q, 'x', REG, head).reasons.some((r) => r.startsWith('rank:diet_drink_kcal_'));
const dietPanel = (kcal: number) => ({ kcal, protein: 5, carbs: (kcal * 0.6) / 4, fat: (kcal * 0.4) / 9 });
const dietAt = (q: string, kcal: number, head?: string) =>
    assessRankTimePlausibility(q, 'x', dietPanel(kcal), head).reasons.some((r) => r.startsWith('rank:diet_drink_kcal_'));
const pouredPanel = (kcal: number) => ({ kcal, protein: 1, carbs: (kcal * 0.6) / 4, fat: (kcal * 0.4) / 9 });
const poured = (q: string, head?: string, kcal = 241) =>
    assessRankTimePlausibility(q, 'x', pouredPanel(kcal), head).reasons.some((r) => r.startsWith('rank:poured_drink_'));

describe('RF1: diet drink plurals fire', () => {
    it.each(['diet cokes', '2 diet cokes', 'diet pepsis', 'coke zeros', 'diet sodas'])('fires: %s', (q) => {
        expect(dietReg('diet coke')).toBe(true);
        expect(dietReg(q)).toBe(true);
    });
});

describe('RF2: plural exempt words stay exempt', () => {
    it.each([
        ['sugar free monster cookies', 'sugar free monster cookie', 480],
        ['diet coke cakes', 'diet coke cake', 350],
        ['sugar free lemonade bars', 'sugar free lemonade bar', 400],
        ['sugar free lemonade mixes', 'sugar free lemonade mix', 300],
    ] as [string, string, number][])('silent: %s', (plural, singular, kcal) => {
        expect(dietAt(singular, kcal)).toBe(false);
        expect(dietAt(plural, kcal)).toBe(false);
    });
});

describe('RF3: a sibling item does not silence the diet item', () => {
    it.each(['diet coke and a protein bar', 'diet coke and a candy bar', 'diet coke with a cookie', 'a diet coke and a chocolate cake'])(
        'fires for item `diet coke` under headLine %s',
        (head) => {
            expect(dietReg('diet coke', 'diet coke, chips and salsa')).toBe(true);
            expect(dietReg('diet coke', head)).toBe(true);
        }
    );
});

describe('RD2: a sibling item does not silence the poured item', () => {
    it.each(['espresso and a protein bar', 'espresso and a piece of cake', 'espresso with a frozen yogurt'])(
        'fires for item `espresso` under headLine %s',
        (head) => {
            expect(poured('espresso', 'an espresso')).toBe(true);
            expect(poured('espresso', head)).toBe(true);
        }
    );
});

describe('controls that stay as today (diet)', () => {
    it('diet coke fires', () => expect(dietReg('diet coke')).toBe(true));
    it('powerade zero grape fires', () => expect(dietReg('powerade zero grape')).toBe(true));
    it('coke zero cake 350 is silent', () => expect(dietAt('coke zero cake', 350)).toBe(false));
    it('diet bread is silent', () => expect(dietReg('diet bread')).toBe(false));
    it('sugar free jello 20 is silent', () => expect(dietAt('sugar free jello', 20)).toBe(false));
    it('sugar free red bull 45 fires', () => expect(dietAt('sugar free red bull', 45)).toBe(true));
    it('coke under `coke with a diet pepsi` is silent', () => expect(dietReg('coke', 'coke with a diet pepsi')).toBe(false));
    it('diet coke float is silent', () => expect(dietReg('diet coke float')).toBe(false));
    it('zero sugar sports drinks fires (the list entry folds too)', () => expect(dietReg('zero sugar sports drinks')).toBe(true));
    it('diet celsius fires', () => expect(dietReg('diet celsius')).toBe(true));
    it('schweppes zero fires', () => expect(dietReg('schweppes zero')).toBe(true));
    it('diet coke candies 350 is silent (the ies->y form)', () => expect(dietAt('diet coke candies', 350)).toBe(false));
    it('diet coke floats 200 is silent', () => expect(dietAt('diet coke floats', 200)).toBe(false));
});

describe('controls that stay as today (poured)', () => {
    it('espresso 241 fires', () => expect(poured('espresso')).toBe(true));
    it('coffee cake 400 is silent', () => expect(poured('coffee cake', undefined, 400)).toBe(false));
    it('coffee under headLine `coffee cake` is silent (dropped-noun canonical)', () => expect(poured('coffee', 'coffee cake', 400)).toBe(false));
    it('espresso beans 500 is silent', () => expect(poured('espresso beans', undefined, 500)).toBe(false));
    it('chocolate covered espresso beans is silent', () => expect(poured('chocolate covered espresso beans', undefined, 500)).toBe(false));
    it('heavy cream in coffee 342 is silent', () => expect(poured('heavy cream in coffee', undefined, 342)).toBe(false));
    it('coffee in a mug 352 fires', () => expect(poured('coffee in a mug', undefined, 352)).toBe(true));
    it('coffee in k cups 352 is silent', () => expect(poured('coffee', 'coffee in k cups', 352)).toBe(false));
    it('protein bar under `espresso and a protein bar` 400 never fires', () => expect(poured('protein bar', 'espresso and a protein bar', 400)).toBe(false));
    it('coffee under headLine `coffee candies` 400 is silent (the ies->y form)', () => expect(poured('coffee', 'coffee candies', 400)).toBe(false));
    it('coffee with creamers 300 is silent', () => expect(poured('coffee with creamers', undefined, 300)).toBe(false));
    it('coffee under `coffee, instant` 352 is silent (comma modifier kept)', () => expect(poured('coffee', 'coffee, instant', 352)).toBe(false));
});
