/**
 * Prep Phrase Separation Tests
 * 
 * Tests for the new prep phrase separation feature that:
 * 1. Separates prep instructions like "stirred until fluffy" from ingredient names
 * 2. Preserves dietary modifiers like "fat free" in the ingredient name
 */

import { parseIngredientLine } from '../ingredient-line';

describe('Prep phrase separation', () => {
    describe('Basic prep phrase detection', () => {
        test('egg whites, stirred until fluffy - separates prep phrase', () => {
            const p = parseIngredientLine('2 egg whites, stirred until fluffy')!;
            expect(p).not.toBeNull();
            expect(p.name).toBe('egg');
            expect(p.unitHint).toBe('white');
            expect(p.prepPhrases).toContain('stirred until fluffy');
        });

        test('cottage cheese, drained - separates drained as prep', () => {
            const p = parseIngredientLine('2 cups cottage cheese, drained')!;
            expect(p).not.toBeNull();
            expect(p.name).toBe('cottage cheese');
            expect(p.prepPhrases).toContain('drained');
        });

        test('fresh basil leaves, torn - separates torn as prep', () => {
            const p = parseIngredientLine('1/4 cup fresh basil leaves, torn')!;
            expect(p).not.toBeNull();
            expect(p.name.toLowerCase()).toContain('basil');
            expect(p.prepPhrases).toContain('torn');
        });

        test('chicken breast, grilled - separates grilled as prep', () => {
            const p = parseIngredientLine('1 chicken breast, grilled')!;
            expect(p).not.toBeNull();
            expect(p.name.toLowerCase()).toContain('chicken breast');
            expect(p.prepPhrases).toContain('grilled');
        });

        test('onion, divided - separates divided as prep', () => {
            const p = parseIngredientLine('1 cup onion, divided')!;
            expect(p).not.toBeNull();
            expect(p.name).toBe('onion');
            expect(p.prepPhrases).toContain('divided');
        });
    });

    describe('Dietary modifier preservation (critical!)', () => {
        test('cheddar cheese, fat free - keeps fat free in name', () => {
            const p = parseIngredientLine('1 cup cheddar cheese, fat free')!;
            expect(p).not.toBeNull();
            expect(p.name.toLowerCase()).toContain('cheddar cheese');
            expect(p.name.toLowerCase()).toContain('fat free');
            // Should NOT be in prepPhrases
            expect(p.prepPhrases || []).not.toContain('fat free');
        });

        test('milk, low fat - keeps low fat in name', () => {
            const p = parseIngredientLine('1 cup milk, low fat')!;
            expect(p).not.toBeNull();
            expect(p.name.toLowerCase()).toContain('milk');
            expect(p.name.toLowerCase()).toContain('low fat');
        });

        test('yogurt, unsweetened - keeps unsweetened in name', () => {
            const p = parseIngredientLine('1 cup yogurt, unsweetened')!;
            expect(p).not.toBeNull();
            expect(p.name.toLowerCase()).toContain('yogurt');
            expect(p.name.toLowerCase()).toContain('unsweetened');
        });

        test('cream cheese, reduced fat - keeps reduced fat in name', () => {
            const p = parseIngredientLine('2 tbsp cream cheese, reduced fat')!;
            expect(p).not.toBeNull();
            expect(p.name.toLowerCase()).toContain('cream cheese');
            expect(p.name.toLowerCase()).toContain('reduced fat');
        });

        test('peanut butter, organic - keeps organic in name', () => {
            const p = parseIngredientLine('2 tbsp peanut butter, organic')!;
            expect(p).not.toBeNull();
            expect(p.name.toLowerCase()).toContain('peanut butter');
            expect(p.name.toLowerCase()).toContain('organic');
        });

        test('low fat milk (modifier before core) - preserves modifier', () => {
            const p = parseIngredientLine('1 cup low fat milk')!;
            expect(p).not.toBeNull();
            expect(p.name.toLowerCase()).toContain('low fat');
            expect(p.name.toLowerCase()).toContain('milk');
        });

        test('fat free cottage cheese - preserves modifier', () => {
            const p = parseIngredientLine('2 cups fat free cottage cheese')!;
            expect(p).not.toBeNull();
            expect(p.name.toLowerCase()).toContain('fat free');
            expect(p.name.toLowerCase()).toContain('cottage cheese');
        });
    });

    describe('Multiple comma segments', () => {
        test('chicken, boneless, skinless, grilled - separates prep from qualifiers', () => {
            const p = parseIngredientLine('2 chicken breasts, boneless, skinless, grilled')!;
            expect(p).not.toBeNull();
            // boneless and skinless are qualifiers
            expect(p.qualifiers).toContain('boneless');
            expect(p.qualifiers).toContain('skinless');
            // grilled is prep phrase
            expect(p.prepPhrases).toContain('grilled');
        });

        test('mushrooms, sliced, sauteed - separates sauteed as prep', () => {
            const p = parseIngredientLine('1 cup mushrooms, sliced, sauteed')!;
            expect(p).not.toBeNull();
            expect(p.qualifiers).toContain('sliced');
            expect(p.prepPhrases).toContain('sauteed');
        });
    });

    describe('Edge cases', () => {
        test('no prep phrases - prepPhrases is undefined', () => {
            const p = parseIngredientLine('1 cup flour')!;
            expect(p).not.toBeNull();
            expect(p.prepPhrases).toBeUndefined();
        });

        test('ingredient with parentheses and prep - handles both', () => {
            const p = parseIngredientLine('1 cup onion (diced), sauteed')!;
            expect(p).not.toBeNull();
            expect(p.qualifiers).toContain('diced');
            expect(p.prepPhrases).toContain('sauteed');
        });
    });
});
