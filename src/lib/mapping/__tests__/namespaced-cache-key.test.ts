/**
 * The cache-key namespace is a PARAMETER, not a prefix on the food string.
 *
 * aiSimplifyIngredient used to build `'SIMPLIFY:' + rawLine` and hand the whole string to
 * computeNormalizedKey, which runs parseIngredientLine then normalizeIngredientName. Neither
 * knows the prefix is not food:
 *   - parseIngredientLine cannot parse "SIMPLIFY:1 cup rice", so it returns the whole line
 *     as `name` with unit=null and the quantity survives into the key. One food fragmented
 *     across three rows, and the fragments were HOT — 'simplify 1 cup rolled oats' has
 *     useCount=167 live.
 *   - normalizeIngredientName then rewrites INSIDE the prefix, so a brand-preserving key
 *     'SIMPLIFY:B:arbys:...' was stored as 'simplify b arbys ...' — a key no lookup can
 *     reach again (two such rows are live).
 *
 * These tests pin the shape, not the strings: the namespace is concatenated after
 * normalization and never enters the token stream.
 */

jest.mock('../../db', () => ({ prisma: {} }));

import { computeNormalizedKey } from '../validated-mapping-helpers';
import { parseIngredientLine } from '../../parse/ingredient-line';

describe('the namespace does not defeat quantity stripping', () => {
    it('collapses quantity variants of one food onto one key', () => {
        const keys = new Set([
            computeNormalizedKey('1 cup rice', 'SIMPLIFY:'),
            computeNormalizedKey('2 cups rice', 'SIMPLIFY:'),
            computeNormalizedKey('rice', 'SIMPLIFY:'),
        ]);

        expect([...keys]).toEqual(['SIMPLIFY:rice']);
    });

    it('is the parse, not the string, that used to fail — guard against a vacuous test', () => {
        // If parseIngredientLine ever learns to strip a "WORD:" prefix on its own, the test
        // above would pass for the wrong reason. Pin the input condition it rests on.
        expect(parseIngredientLine('1 cup rice')?.name).toBe('rice');
        expect(parseIngredientLine('SIMPLIFY:1 cup rice')?.name).toBe('SIMPLIFY:1 cup rice');
    });
});

describe('the namespace never enters the normalizer token stream', () => {
    it('keeps case, colons and order verbatim', () => {
        const key = computeNormalizedKey('jif peanut butter', 'SIMPLIFY:B:jif:');

        expect(key.startsWith('SIMPLIFY:B:jif:')).toBe(true);
        // The failure mode this replaces: the prefix degraded to lowercase space-separated
        // tokens, which is how 'simplify b arbys ...' got stored.
        expect(key).not.toMatch(/simplify/);
        expect(key).not.toMatch(/ b /);
    });

    it('applies to the B:<brand>: sub-namespace, not just SIMPLIFY:', () => {
        // A fix applied to SIMPLIFY: alone would leave brand-preserving keys still being
        // normalized as food. Quantity stripping has to work inside the brand namespace too.
        const scoop = computeNormalizedKey('2 scoops ghost protein', 'SIMPLIFY:B:ghost:');
        const bare = computeNormalizedKey('ghost protein', 'SIMPLIFY:B:ghost:');

        expect(scoop).toBe(bare);
        expect(scoop.startsWith('SIMPLIFY:B:ghost:')).toBe(true);
    });

    it('does not let a rewrite fire inside the prefix', () => {
        // 'cooked' -> 'rolled' is a real static rewrite. It must apply to the body and
        // leave the namespace alone, whatever the namespace happens to spell.
        const body = computeNormalizedKey('1 cup cooked oats');
        const namespaced = computeNormalizedKey('1 cup cooked oats', 'SIMPLIFY:');

        expect(namespaced).toBe(`SIMPLIFY:${body}`);
        expect(body).not.toMatch(/\bcup\b/);
        expect(body).not.toMatch(/\b1\b/);
    });
});

describe('an empty namespace is the un-namespaced key', () => {
    it('leaves every existing caller unchanged', () => {
        expect(computeNormalizedKey('2 tbsp jif peanut butter')).toBe(
            computeNormalizedKey('2 tbsp jif peanut butter', ''),
        );
    });
});
