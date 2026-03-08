import { normalizeIngredientName, clearRulesCache } from '../normalization-rules';
import { parseIngredientLine } from '../../parse/ingredient-line';

/**
 * Tests for normalization pipeline with dietary modifiers and cooking methods.
 * 
 * KEY PRINCIPLES:
 * 1. Dietary modifiers (sugar-free, low-fat) MUST be preserved - they affect nutrition
 * 2. Neutral cooking methods (scrambled, boiled) should be stripped - same nutrition as base food
 * 3. Nutrition-altering cooking methods (fried, breaded) should NOT be stripped
 */

beforeEach(() => {
    clearRulesCache();
});

describe('normalizeIngredientName', () => {
    // ======================================================================
    // SUGAR MODIFIERS - Must be PRESERVED (affect nutrition significantly)
    // ======================================================================
    describe('sugar modifiers (MUST preserve)', () => {
        const sugarModifiers = [
            'sugar-free',
            'sugar free',
            'sugarfree',
            'zero sugar',
            'no sugar',
            'no sugar added',
            'unsweetened',
            'reduced sugar',
            'low sugar',
            'less sugar',
        ];

        sugarModifiers.forEach(modifier => {
            it(`preserves "${modifier}" modifier`, () => {
                const input = `${modifier} pudding`;
                const result = normalizeIngredientName(input);
                // Sugar modifiers should NOT be stripped - check the first key word is present
                const firstWord = modifier.replace(/-/g, ' ').toLowerCase().trim().split(/\s+/)[0];
                expect(result.cleaned.toLowerCase()).toContain(firstWord);
            });
        });

        it('preserves "sugar-free" in context', () => {
            expect(normalizeIngredientName('sugar-free chocolate').cleaned.toLowerCase()).toContain('sugar');
            expect(normalizeIngredientName('zero sugar cola').cleaned.toLowerCase()).toContain('zero sugar');
            expect(normalizeIngredientName('no sugar added jam').cleaned.toLowerCase()).toContain('no sugar');
        });
    });

    // ======================================================================
    // FAT MODIFIERS - Must be PRESERVED (affect nutrition significantly)
    // ======================================================================
    describe('fat modifiers (MUST preserve)', () => {
        const fatModifiers = [
            'lowfat',
            'low-fat',
            'low fat',
            'reduced fat',
            'reduced-fat',
            'fat reduced',
            'fat-reduced',
            'lite',
            'light',
            'nonfat',
            'non-fat',
            'non fat',
            'fat-free',
            'fat free',
            'fatfree',
            'zero fat',
            'no fat',
        ];

        fatModifiers.forEach(modifier => {
            it(`preserves "${modifier}" modifier`, () => {
                const input = `${modifier} milk`;
                const result = normalizeIngredientName(input);
                // Fat modifiers should NOT be stripped - check first word of modifier is present
                const firstWord = modifier.replace(/-/g, ' ').toLowerCase().trim().split(/\s+/)[0];
                expect(result.cleaned.toLowerCase()).toContain(firstWord);
            });
        });

        it('preserves various fat modifier formats in context', () => {
            // 2% should be preserved (nutritionally significant)
            expect(normalizeIngredientName('2% milk').cleaned).toContain('2%');
            expect(normalizeIngredientName('skim milk').cleaned.toLowerCase()).toContain('skim');
            // "whole" is in prep phrases, but we should verify milk is there
            expect(normalizeIngredientName('whole milk').cleaned.toLowerCase()).toContain('milk');
        });
    });

    // ======================================================================
    // NEUTRAL COOKING METHODS - Should be STRIPPED (no nutrition change)
    // ======================================================================
    describe('neutral cooking methods (SHOULD strip)', () => {
        const neutralMethods = [
            { method: 'scrambled', food: 'eggs', expected: 'eggs' },
            { method: 'boiled', food: 'eggs', expected: 'eggs' },
            { method: 'hard-boiled', food: 'eggs', expected: 'eggs' },
            { method: 'poached', food: 'eggs', expected: 'eggs' },
            { method: 'steamed', food: 'broccoli', expected: 'broccoli' },
            { method: 'grilled', food: 'chicken', expected: 'chicken' },
            { method: 'baked', food: 'potato', expected: 'potato' },
            { method: 'roasted', food: 'vegetables', expected: 'vegetables' },
            { method: 'broiled', food: 'salmon', expected: 'salmon' },
            { method: 'microwaved', food: 'rice', expected: 'rice' },
        ];

        neutralMethods.forEach(({ method, food, expected }) => {
            it(`strips "${method}" from "${method} ${food}"`, () => {
                const result = normalizeIngredientName(`${method} ${food}`);
                expect(result.cleaned.toLowerCase()).toBe(expected.toLowerCase());
            });
        });

        it('strips "scrambled eggs until fluffy" to just "eggs"', () => {
            const result = normalizeIngredientName('scrambled eggs until fluffy');
            expect(result.cleaned).toBe('eggs');
        });
    });

    // ======================================================================
    // NUTRITION-ALTERING COOKING METHODS - Should NOT be stripped
    // ======================================================================
    describe('nutrition-altering cooking methods (should NOT strip)', () => {
        const alteringMethods = [
            { method: 'fried', food: 'chicken' },
            { method: 'deep-fried', food: 'fish' },
            { method: 'pan-fried', food: 'tofu' },
            { method: 'breaded', food: 'shrimp' },
            { method: 'battered', food: 'fish' },
            { method: 'candied', food: 'pecans' },
            { method: 'glazed', food: 'ham' },
            { method: 'buttered', food: 'noodles' },
            { method: 'creamed', food: 'spinach' },
        ];

        alteringMethods.forEach(({ method, food }) => {
            it(`preserves "${method}" in "${method} ${food}"`, () => {
                const result = normalizeIngredientName(`${method} ${food}`);
                // These methods change nutrition, so they should be preserved
                // Check that the core word (removing hyphen) is in the output
                const coreWord = method.split('-')[0]; // "deep-fried" → "deep"
                expect(result.cleaned.toLowerCase()).toContain(coreWord);
            });
        });
    });

    // ======================================================================
    // PHYSICAL PREP METHODS - Should be stripped (just cutting/shaping)
    // ======================================================================
    describe('physical prep methods (SHOULD strip)', () => {
        const prepMethods = [
            { prep: 'chopped', food: 'onions', expected: 'onions' },
            { prep: 'diced', food: 'tomatoes', expected: 'tomatoes' },
            { prep: 'minced', food: 'garlic', expected: 'garlic' },
            { prep: 'sliced', food: 'mushrooms', expected: 'mushrooms' },
            { prep: 'cubed', food: 'potatoes', expected: 'potatoes' },
            { prep: 'shredded', food: 'cheese', expected: 'cheese' },
            { prep: 'grated', food: 'parmesan', expected: 'parmesan' },
            { prep: 'mashed', food: 'bananas', expected: 'bananas' },
            { prep: 'crushed', food: 'pineapple', expected: 'pineapple' },
            { prep: 'julienned', food: 'carrots', expected: 'carrots' },
        ];

        prepMethods.forEach(({ prep, food, expected }) => {
            it(`strips "${prep}" from "${prep} ${food}"`, () => {
                const result = normalizeIngredientName(`${prep} ${food}`);
                expect(result.cleaned.toLowerCase()).toBe(expected.toLowerCase());
            });
        });
    });

    // ======================================================================
    // COMBINED SCENARIOS
    // ======================================================================
    describe('combined scenarios', () => {
        it('strips prep but preserves dietary modifier: "chopped sugar-free chocolate"', () => {
            const result = normalizeIngredientName('chopped sugar-free chocolate');
            expect(result.cleaned.toLowerCase()).toContain('sugar');
            expect(result.cleaned.toLowerCase()).toContain('chocolate');
            expect(result.cleaned.toLowerCase()).not.toContain('chopped');
        });

        it('strips neutral cooking but preserves dietary: "grilled lowfat cheese"', () => {
            const result = normalizeIngredientName('grilled lowfat cheese');
            expect(result.cleaned.toLowerCase()).toContain('lowfat');
            expect(result.cleaned.toLowerCase()).not.toContain('grilled');
        });

        it('preserves nutrition-altering method AND dietary modifier: "fried fat-free cheese"', () => {
            const result = normalizeIngredientName('fried fat-free cheese');
            expect(result.cleaned.toLowerCase()).toContain('fried');
            expect(result.cleaned.toLowerCase()).toContain('fat');
        });

        it('handles complex line: "2 cups boiled boneless skinless chicken breast"', () => {
            const parsed = parseIngredientLine('2 cups boiled boneless skinless chicken breast');
            expect(parsed).not.toBeNull();
            expect(parsed!.qty).toBe(2);
            expect(parsed!.unit).toBe('cup');

            // Name after parsing may already have some prep stripped
            const normalized = normalizeIngredientName(parsed!.name);
            expect(normalized.cleaned.toLowerCase()).toContain('chicken');
            expect(normalized.cleaned.toLowerCase()).toContain('breast');
        });
    });

    // ======================================================================
    // PART-WHOLE STRIPPING (when part is assumed)
    // ======================================================================
    describe('part-whole stripping', () => {
        it('strips "leaves" from "parsley leaves"', () => {
            expect(normalizeIngredientName('parsley leaves').cleaned).toBe('parsley');
        });

        it('strips "cloves" from "garlic cloves"', () => {
            expect(normalizeIngredientName('garlic cloves').cleaned).toBe('garlic');
        });

        it('strips "stalk" from "celery stalk"', () => {
            expect(normalizeIngredientName('celery stalk').cleaned).toBe('celery');
        });

        it('strips "stalks" from "celery stalks"', () => {
            expect(normalizeIngredientName('celery stalks').cleaned).toBe('celery');
        });

        it('converts "lemon zest" to "lemon peel"', () => {
            expect(normalizeIngredientName('lemon zest').cleaned).toBe('lemon peel');
        });

        it('handles herb leaves: "basil leaves" → "basil"', () => {
            expect(normalizeIngredientName('basil leaves').cleaned).toBe('basil');
        });

        it('handles herb leaves: "mint leaves" → "mint"', () => {
            expect(normalizeIngredientName('mint leaves').cleaned).toBe('mint');
        });
    });

    // ======================================================================
    // SYNONYM REWRITES
    // ======================================================================
    describe('synonym rewrites', () => {
        it('handles British terms', () => {
            expect(normalizeIngredientName('single cream').cleaned).toBe('light cream');
            expect(normalizeIngredientName('double cream').cleaned).toBe('heavy cream');
        });

        it('handles synonym rewrites resulting in different words', () => {
            // "stberry" → "strawberries" but then "halves" gets stripped
            const result = normalizeIngredientName('stberry halves');
            // The result should contain "strawberries" or close variant
            expect(result.cleaned.toLowerCase()).toContain('strawberr');
        });
    });
});

// ======================================================================
// END-TO-END: Parse + Normalize
// ======================================================================
describe('end-to-end: parse and normalize', () => {
    it('handles "3 scrambled eggs"', () => {
        const parsed = parseIngredientLine('3 scrambled eggs');
        expect(parsed).not.toBeNull();
        expect(parsed!.qty).toBe(3);

        const normalized = normalizeIngredientName(parsed!.name);
        expect(normalized.cleaned.toLowerCase()).toBe('eggs');
    });

    it('handles "1 cup sugar-free pudding mix"', () => {
        const parsed = parseIngredientLine('1 cup sugar-free pudding mix');
        expect(parsed).not.toBeNull();
        expect(parsed!.qty).toBe(1);
        expect(parsed!.unit).toBe('cup');

        const normalized = normalizeIngredientName(parsed!.name);
        expect(normalized.cleaned.toLowerCase()).toContain('sugar');
        expect(normalized.cleaned.toLowerCase()).toContain('pudding');
    });

    it('handles "2 tbsp reduced fat mayonnaise"', () => {
        const parsed = parseIngredientLine('2 tbsp reduced fat mayonnaise');
        expect(parsed).not.toBeNull();
        expect(parsed!.qty).toBe(2);
        expect(parsed!.unit).toBe('tbsp');

        const normalized = normalizeIngredientName(parsed!.name);
        expect(normalized.cleaned.toLowerCase()).toContain('reduced');
        expect(normalized.cleaned.toLowerCase()).toContain('mayonnaise');
    });

    it('handles "4 large hard-boiled eggs, chopped"', () => {
        const parsed = parseIngredientLine('4 large hard-boiled eggs, chopped');
        expect(parsed).not.toBeNull();
        expect(parsed!.qty).toBe(4);

        // After full normalization, should just be "eggs"
        const normalized = normalizeIngredientName(parsed!.name);
        expect(normalized.cleaned.toLowerCase()).toBe('eggs');
    });
});
