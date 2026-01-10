
import { parseIngredientLine } from '../ingredient-line';
import { parseQuantityTokens } from '../quantity';

describe('Mixed Fraction Parsing', () => {
    test('parses "4 1/2 cups quinoa"', () => {
        const res = parseIngredientLine('4 1/2 cups quinoa');
        expect(res).not.toBeNull();
        expect(res?.qty).toBe(4.5);
        expect(res?.unit).toBe('cup'); // or cup
        expect(res?.name).toBe('quinoa');
    });

    test('parses "1 1/4 cups water"', () => {
        const res = parseIngredientLine('1 1/4 cups water');
        expect(res?.qty).toBe(1.25);
    });

    test('parses "1 1/2 tsp vanilla"', () => {
        const res = parseIngredientLine('1 1/2 tsp vanilla');
        expect(res?.qty).toBe(1.5);
    });

    test('parses "10 1/2 oz"', () => {
        // unit can be parsed
        const res = parseIngredientLine('10 1/2 oz chocolate');
        expect(res?.qty).toBe(10.5);
        expect(res?.unit).toBe('oz');
    });

    test('does not break simpler things', () => {
        const res = parseIngredientLine('1 cup flour');
        expect(res?.qty).toBe(1);
    });
});
