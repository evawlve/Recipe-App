/**
 * PUNCH #115 — the bare-query category detector must not read its category out of a claim that
 * the ingredient is ABSENT.
 *
 * `getBareQueryDefault()`'s sugars rule is /\b(sugar(?!\s*snap)|molasses)\b/ -> 4 g, and it could
 * not see that `sugar` is the FIRST word of `sugar free` or the SECOND of `zero sugar` /
 * `no sugar added`. The misread runs in BOTH directions, which is why the fix is not a lookahead:
 * measured over the 12 misread lines (2026-09-07), the followed shape is 2 lines and the preceded
 * shape is 4, so a lookahead alone — the idiom this file already uses for `sugar snap` and
 * `honey nut` — reaches 3 of 12 lines and 3 of 46 events.
 *
 * THE RULE IS NARROW ON PURPOSE and the third block below is what pins that. "a category detector
 * must never take its category from inside a modifier phrase" is too wide: `lactose free milk` IS
 * still milk. Only a word naming an ingredient a package advertises the ABSENCE of can be misread.
 */
import { getBareQueryDefault, maskAdvertisedAbsence } from '../ambiguous-serving-estimator';
import { capMayOverrideLabelServing } from '@/lib/servings/bare-query-guard';

const grams = (q: string) => getBareQueryDefault(maskAdvertisedAbsence(q))?.grams ?? null;
const rawGrams = (q: string) => getBareQueryDefault(q)?.grams ?? null;

describe('#115 — the misread population stops billing a teaspoon of sugar', () => {
    // The six lines measured in MappingEventLog over 60 days (19 events) whose category was read
    // out of an absence phrase in the QUERY. Every one billed 4 g before.
    it.each([
        ['pepsi zero sugar'],
        ['sprite zero sugar'],
        ['zero sugar pepsi'],
        ['no sugar added applesauce'],
        ['sugar free coke'],
        ['sugar free vanilla latte'],
    ])('%s no longer resolves to the 4 g sugars default', (line) => {
        expect(rawGrams(line)).toBe(4);
        expect(grams(line)).not.toBe(4);
    });

    it('a masked line falls to the rule the sugars rule was pre-empting, where one exists', () => {
        // Rule 4 sits above rule 17 (355 g beverages), so `coke` was unreachable. Blanking rather
        // than deleting is what lets the rest of the string still match.
        expect(grams('sugar free coke')).toBe(355);
        // `sprite` and `pepsi` are not in the beverage rule, so those fall through to null and the
        // serving cascade decides — measured, not assumed. See the report's grams table.
        expect(grams('sprite zero sugar')).toBeNull();
        expect(grams('pepsi zero sugar')).toBeNull();
    });

    it('the same misread in the SALT and OIL/BUTTER rules is fixed by the same predicate', () => {
        expect(rawGrams('no salt added')).toBe(2.5);
        expect(grams('no salt added')).toBeNull();
        expect(rawGrams('no oil added')).toBe(14);
        expect(grams('no oil added')).toBeNull();
        // popcorn: rule 3 (condiments, 14 g) was pre-empting rule 12 (snacks, 28 g).
        expect(rawGrams('butter free popcorn')).toBe(14);
        expect(grams('butter free popcorn')).toBe(28);
    });
});

describe('#115 — the genuine sugars stay at 4 g', () => {
    // Every GENUINE line in the 60-day tier population, plus the two the brief named as controls.
    it.each([
        ['sugar'], ['brown sugar'], ['granulated sugar'], ['icing sugar'],
        ['coconut sugar'], ['powdered sugar'], ['blackstrap molasses'], ['molasses'],
    ])('%s is still the 4 g category default', (line) => {
        expect(grams(line)).toBe(4);
    });

    it('the existing sugar-snap lookahead is untouched', () => {
        expect(grams('sugar snap peas')).toBeNull();
    });
});

describe('#115 — the rule is NARROW, and this is the block that says so', () => {
    /**
     * Each of these is a category word inside a modifier phrase, and each is CORRECT today. A fix
     * written to the wide rule breaks all of them. Measured 2026-09-07 by calling the shipped
     * function on each; they are the reason ABSENCE_ADVERTISED_CATEGORY_WORDS is four words and
     * not "any modifier".
     */
    it.each([
        ['lactose free milk', 240],
        ['unsweetened almond milk', 240],
        ['caffeine free coke', 355],
        ['gluten free flour', 120],
        ['fat free cheese', 28],
        ['light corn syrup', 14],
        ['low sodium bacon', 28],
        ['peanut butter', 32],
        ['sea salt', 2.5],
        ['olive oil', 14],
        ['butter', 14],
    ])('%s is unmoved at %i g', (line, want) => {
        expect(rawGrams(line)).toBe(want);
        expect(grams(line)).toBe(want);
    });
});

describe('#115 — THE WIRING, which is where the first revision of this fix broke something', () => {
    /**
     * The mask is scoped to ONE lexicon read inside applyOffBareQueryGuard(). An earlier revision
     * shadowed `queryName` for the WHOLE function, and that regressed `sugar free bbq sauce` on 20
     * measured events: maskAdvertisedAbsence() BLANKS rather than deletes, but queryTokens() splits
     * on /[^a-z]+/ and drops the blanks, so the token COUNT fell 4 -> 2 and flipped
     * capMayOverrideLabelServing() false -> true — capping that line's declared 30/36/39 g label
     * serving to the 14 g condiment default, a 2.1x-2.8x under-bill. Blanking preserves token
     * POSITIONS, not token COUNT.
     *
     * These two pin the property directly on the predicate the regression ran through, so the
     * scoping cannot be widened again by accident.
     */
    it('a 4-token absence line still counts as a PRODUCT query, so its declared label serving wins', () => {
        expect(capMayOverrideLabelServing('sugar free bbq sauce', 'label_serving_default')).toBe(false);
    });

    it('and the masked form would NOT have — this is the regression, pinned', () => {
        expect(capMayOverrideLabelServing(maskAdvertisedAbsence('sugar free bbq sauce'), 'label_serving_default')).toBe(true);
    });
});

describe('#115 — the record name keeps today’s read', () => {
    /**
     * `trident spearmint gum` carries no `sugar` token; its 4 g comes from the matched RECORD's
     * name via applyOffBareQueryGuard()'s `queryDefault ?? getBareQueryDefault(foodName)`. 4 g is
     * ~2 sticks of gum — nearly right — and suppressing it drops the line to the flat 100 g
     * default (~262 kcal of chewing gum). So the fallback is NOT masked. DNB-9's lesson read
     * backwards: the counterfactual for a rule that stops firing is whatever bills instead.
     */
    it('the record-name lexicon read is unchanged when it is not masked', () => {
        expect(rawGrams('trident spearmint gum')).toBeNull();
        expect(rawGrams('Sugar Free Spearmint Gum')).toBe(4);
    });

    it('masking IS what would break it, which is why the fallback does not mask', () => {
        expect(grams('Sugar Free Spearmint Gum')).toBeNull();
    });
});

describe('maskAdvertisedAbsence — the pure helper', () => {
    it('blanks rather than deletes, so token positions are preserved', () => {
        expect(maskAdvertisedAbsence('sugar free coke')).toBe('           coke');
        expect(maskAdvertisedAbsence('sugar free coke').length).toBe('sugar free coke'.length);
    });

    it('is case-insensitive and handles the hyphen and the closed spelling', () => {
        expect(maskAdvertisedAbsence('Sugar-Free Coke').trim()).toBe('Coke');
        expect(maskAdvertisedAbsence('SUGARFREE COKE').trim()).toBe('COKE');
    });

    it('leaves a string with no absence frame byte-identical', () => {
        for (const q of ['brown sugar', 'olive oil', 'peanut butter', 'sea salt', 'banana']) {
            expect(maskAdvertisedAbsence(q)).toBe(q);
        }
    });

    it('is a no-op on empty input', () => {
        expect(maskAdvertisedAbsence('')).toBe('');
    });
});
