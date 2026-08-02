import { applyOffBareQueryGuard } from '../bare-query-guard';
import type { ParsedIngredient } from '../../parse/ingredient-line';

/**
 * Dose-count reconciliation — the rule that replaced a floor direction.
 *
 * The floor was rejected on measurement, and these tests encode WHY, because
 * the reasons are what stop it being reintroduced:
 *   - it does not fire on its own motivating case (16 is exactly 32/2, and the
 *     condition would be `< def/2`);
 *   - measured over 18,456 FatSecret default servings, 660 rows sit below half
 *     the category default and most of them are the RECORD being right. A floor
 *     takes `flour tortilla` 13g -> 120g on the lexicon's "flour", `water
 *     spinach` -> 240g, `milk bread` -> 240g, `lemonade powder` -> 355g. All are
 *     <=2-token names, so the existing token gate cannot block a single one.
 *
 * The reconciliation never reads the lexicon's GRAMS — only its COUNT, applied
 * to the record's own per-unit weight. Requiring the same spoon/scoop word on
 * both sides is what makes those four hijacks impossible rather than unlikely.
 */

function bare(name: string): ParsedIngredient {
    return { qty: 1, multiplier: 1, unit: null, name } as ParsedIngredient;
}

describe('fires for the nut-butter dose disagreement', () => {
    it('peanut butter: 1 tbsp declared -> 2 tbsp requested, using the RECORD\'s 16g', () => {
        const r = applyOffBareQueryGuard({
            grams: 16, servingTier: 'label_serving_default',
            parsed: bare('peanut butter'), rawLine: 'peanut butter',
            queryName: 'peanut butter', foodName: 'Peanut Butter',
            servingDescription: '1 tbsp',
        });
        expect(r).not.toBeNull();
        expect(r!.grams).toBe(32);
        expect(r!.servingTier).toBe('bare_dose_count_reconciled');
    });

    it('scales the RECORD\'s number, not the lexicon\'s', () => {
        // A record declaring a 20g tablespoon must yield 40g, not the lexicon's
        // 32g. MUTATION: return queryDefault.grams instead of scaling -> red.
        const r = applyOffBareQueryGuard({
            grams: 20, servingTier: 'label_serving_default',
            parsed: bare('peanut butter'), rawLine: 'peanut butter',
            queryName: 'peanut butter', foodName: 'Peanut Butter',
            servingDescription: '1 tbsp',
        });
        expect(r!.grams).toBe(40);
    });
});

describe('the hijacks a floor would have caused are structurally unreachable', () => {
    // Each of these has a lexicon entry whose grams are far above the billed
    // number, so a floor fires on every one.
    //
    // WHICH guard blocks them, measured rather than assumed: it is the LEXICON
    // side that fails to parse, not the record side. Their bare-query defaults
    // are "1 cup" (flour tortilla 120g, water spinach 240g, milk bread 240g),
    // "1 can" (lemonade 355g) and "1 oz" (saltine crackers, bacon, both 28g) —
    // none is a spoon/scoop dose, so the rule exits before the record is ever
    // consulted. Mutating away the same-unit-word check leaves all six GREEN;
    // it is a different guard doing the work here.
    //
    // That is the real safety property, and it is stronger than the one first
    // written down: the rule is confined by the LEXICON, and only the
    // nut-butter category expresses a spoon dose with a count above 1.
    it.each([
        ['flour tortilla', 13, '1 tortilla (approx 4" dia)', 'Flour Tortilla'],
        ['water spinach', 30, '1 cup', 'Water Spinach'],
        ['milk bread', 36, '1 medium slice', 'Milk Bread'],
        ['lemonade', 18, '1 packet', 'Lemonade Powder'],
        ['saltine crackers', 3, '1 cracker', 'Saltine Crackers'],
        ['bacon', 5, '1 thin slice', 'Bacon'],
    ])('%s is left alone', (q, grams, desc, food) => {
        const r = applyOffBareQueryGuard({
            grams, servingTier: 'label_serving_default',
            parsed: bare(q), rawLine: q, queryName: q, foodName: food,
            servingDescription: desc,
        });
        expect(r?.servingTier).not.toBe('bare_dose_count_reconciled');
    });
});

describe('the gates', () => {
    it('does not fire when the counts already agree (olive oil, 1 tbsp = 1 tbsp)', () => {
        const r = applyOffBareQueryGuard({
            grams: 14, servingTier: 'label_serving_default',
            parsed: bare('olive oil'), rawLine: 'olive oil',
            queryName: 'olive oil', foodName: 'Olive Oil',
            servingDescription: '1 tbsp',
        });
        expect(r?.servingTier).not.toBe('bare_dose_count_reconciled');
    });

    it('never scales DOWN — the record already exceeding the lexicon is kept', () => {
        // ghost pre workout: record 2 scoops vs lexicon 1 scoop. MUTATION: drop
        // the `lexCount > recCount` guard -> this halves a correct serving.
        const r = applyOffBareQueryGuard({
            grams: 32.5, servingTier: 'label_serving_default',
            parsed: bare('ghost pre workout'), rawLine: 'ghost pre workout',
            queryName: 'ghost pre workout', foodName: 'Ghost Pre Workout',
            servingDescription: '2 scoops',
        });
        expect(r?.servingTier).not.toBe('bare_dose_count_reconciled');
    });

    it('requires the SAME unit word on both sides', () => {
        // Lexicon says 2 tbsp; record declares teaspoons. Cross-unit scaling
        // would be inventing a conversion. MUTATION: drop the lex[2]===rec[2]
        // check -> this returns 32.
        const r = applyOffBareQueryGuard({
            grams: 16, servingTier: 'label_serving_default',
            parsed: bare('peanut butter'), rawLine: 'peanut butter',
            queryName: 'peanut butter', foodName: 'Peanut Butter',
            servingDescription: '1 tsp',
        });
        expect(r?.servingTier).not.toBe('bare_dose_count_reconciled');
    });

    it('a non-bare line is out of scope entirely (digit gate)', () => {
        const r = applyOffBareQueryGuard({
            grams: 16, servingTier: 'label_serving_default',
            parsed: { qty: 1, multiplier: 1, unit: 'tbsp', name: 'peanut butter' } as ParsedIngredient,
            rawLine: '1 tbsp peanut butter',
            queryName: 'peanut butter', foodName: 'Peanut Butter',
            servingDescription: '1 tbsp',
        });
        expect(r).toBeNull();
    });

    it('a long product query is blocked by the existing token gate', () => {
        // "a tbsp of peanut butter" reaches the guard as bare (the parser does
        // not lift the unit), and must NOT be doubled — the user said one.
        const r = applyOffBareQueryGuard({
            grams: 16, servingTier: 'label_serving_default',
            parsed: bare('a tbsp of peanut butter'), rawLine: 'a tbsp of peanut butter',
            queryName: 'a tbsp of peanut butter', foodName: 'Peanut Butter',
            servingDescription: '1 tbsp',
        });
        expect(r?.servingTier).not.toBe('bare_dose_count_reconciled');
    });

    it('a caller that omits servingDescription loses this rule and nothing else', () => {
        const r = applyOffBareQueryGuard({
            grams: 16, servingTier: 'label_serving_default',
            parsed: bare('peanut butter'), rawLine: 'peanut butter',
            queryName: 'peanut butter', foodName: 'Peanut Butter',
        });
        expect(r?.servingTier).not.toBe('bare_dose_count_reconciled');
    });

    it('the existing kill switch covers it', () => {
        const prev = process.env.OFF_BARE_SERVING_GUARD;
        process.env.OFF_BARE_SERVING_GUARD = '0';
        try {
            expect(applyOffBareQueryGuard({
                grams: 16, servingTier: 'label_serving_default',
                parsed: bare('peanut butter'), rawLine: 'peanut butter',
                queryName: 'peanut butter', foodName: 'Peanut Butter',
                servingDescription: '1 tbsp',
            })).toBeNull();
        } finally {
            if (prev === undefined) delete process.env.OFF_BARE_SERVING_GUARD;
            else process.env.OFF_BARE_SERVING_GUARD = prev;
        }
    });
});
