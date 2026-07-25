import { deriveCacheKeyName } from '../cache-key';
import { canonicalizeCacheKey } from '../normalization-rules';
import { parseIngredientLine } from '../../parse/ingredient-line';
import type { ParsedIngredient } from '../../parse/ingredient-line';

/**
 * Tests for identity-preserving cache keys (PR D pt3, Lever C — C1).
 * Golden watch: n-mq-31/32/33/34/35 (egg white/yolk/base-egg, whole milk,
 * cooked quinoa), n-tot-02 (white rice via unit-hint scoping).
 */

function parsed(overrides: Partial<ParsedIngredient>): ParsedIngredient {
    return {
        qty: 1,
        multiplier: 1,
        name: '',
        ...overrides,
    };
}

afterEach(() => {
    delete process.env.CACHE_KEY_DISCRIMINATORS;
});

describe('deriveCacheKeyName', () => {
    // ======================================================================
    // UNIT-HINT DISCRIMINATORS (egg parts)
    // ======================================================================
    describe('unit-hint discriminators', () => {
        it('"3 egg whites" → key "egg white" (hint re-attached)', () => {
            const p = parseIngredientLine('3 egg whites')!;
            expect(p.name).toBe('egg');
            expect(p.unitHint).toBe('white');
            expect(deriveCacheKeyName(p.name, p)).toBe('egg white');
        });

        it('"2 egg yolks" → key includes yolk', () => {
            const p = parseIngredientLine('2 egg yolks')!;
            expect(p.name).toBe('egg');
            expect(p.unitHint).toBe('yolk');
            expect(deriveCacheKeyName(p.name, p)).toBe('egg yolk');
        });

        it('piece-like hints (leaf, clove, slice) are NOT identity discriminators', () => {
            const p = parseIngredientLine('5 romaine leaves')!;
            expect(p.unitHint).toBe('leaf');
            expect(deriveCacheKeyName(p.name, p)).toBe(canonicalizeCacheKey(p.name));
            expect(deriveCacheKeyName(p.name, p)).not.toContain('leaf');
        });
    });

    // ======================================================================
    // IDENTITY QUALIFIERS (cooked, whole)
    // ======================================================================
    describe('identity qualifiers', () => {
        it('"whole milk" → key "milk whole"', () => {
            const p = parseIngredientLine('1 cup whole milk')!;
            expect(p.qualifiers).toContain('whole');
            expect(deriveCacheKeyName(p.name, p)).toBe('milk whole');
        });

        it('"cooked quinoa" → key includes cooked', () => {
            const p = parseIngredientLine('1 cup cooked quinoa')!;
            expect(p.qualifiers).toContain('cooked');
            expect(deriveCacheKeyName(p.name, p)).toBe('cooked quinoa');
        });

        it('non-identity qualifiers (chopped, large, fresh) are ignored', () => {
            const p = parsed({ name: 'onion', qualifiers: ['chopped', 'large', 'fresh'] });
            expect(deriveCacheKeyName('onion', p)).toBe('onion');
        });
    });

    // ======================================================================
    // DEDUPE (canonicalizeCacheKey does NOT dedupe — must happen here)
    // ======================================================================
    describe('set-dedupe before canonicalize', () => {
        it('"whole milk" already containing "whole" + qualifier "whole" ≠ "milk whole whole"', () => {
            // Segmenter path: normalizedName may already carry the qualifier text
            const p = parsed({ name: 'whole milk', qualifiers: ['whole'] });
            const key = deriveCacheKeyName('whole milk', p);
            expect(key).toBe('milk whole');
            expect(key).not.toBe('milk whole whole');
        });

        it('plural-form duplicate: "egg whites" + hint "white" ≠ "egg white white"', () => {
            const p = parsed({ name: 'egg whites', unitHint: 'white' });
            const key = deriveCacheKeyName('egg whites', p);
            expect(key).toBe('egg white');
            expect(key).not.toContain('white white');
        });

        it('duplicate discriminators collapse (qualifiers ["whole", "whole"])', () => {
            const p = parsed({ name: 'milk', qualifiers: ['whole', 'whole'] });
            expect(deriveCacheKeyName('milk', p)).toBe('milk whole');
        });
    });

    // ======================================================================
    // NO-DISCRIMINATOR PASSTHROUGH (bare senses keep their base key)
    // ======================================================================
    describe('bare names unchanged', () => {
        it.each(['egg', 'milk', 'rice'])('bare "%s" → plain canonical key', (name) => {
            const p = parsed({ name });
            expect(deriveCacheKeyName(name, p)).toBe(canonicalizeCacheKey(name));
        });

        it('"white rice" (post unit-hint scoping, "white" stays in name) → "rice white" via plain canonicalize', () => {
            const p = parseIngredientLine('1 cup white rice')!;
            expect(p.name).toBe('white rice');
            expect(p.unitHint).toBeNull();
            expect(deriveCacheKeyName(p.name, p)).toBe('rice white');
            expect(deriveCacheKeyName(p.name, p)).toBe(canonicalizeCacheKey('white rice'));
        });

        it('null parsed → plain canonicalize', () => {
            expect(deriveCacheKeyName('whole milk', null)).toBe(canonicalizeCacheKey('whole milk'));
        });
    });

    // ======================================================================
    // KILL-SWITCH
    // ======================================================================
    describe('kill-switch CACHE_KEY_DISCRIMINATORS=0', () => {
        it('returns plain canonicalizeCacheKey, discriminators ignored', () => {
            process.env.CACHE_KEY_DISCRIMINATORS = '0';
            const eggWhites = parsed({ name: 'egg', unitHint: 'white' });
            expect(deriveCacheKeyName('egg', eggWhites)).toBe(canonicalizeCacheKey('egg'));

            const wholeMilk = parsed({ name: 'milk', qualifiers: ['whole'] });
            expect(deriveCacheKeyName('milk', wholeMilk)).toBe(canonicalizeCacheKey('milk'));
        });
    });

    // ======================================================================
    // POSSESSIVE BRAND SPELLINGS
    // Three spellings of one brand used to address three different cache rows:
    // "mcdonald's" -> "mcdonald'" (apostrophe kept, then fed to singularize),
    // "mcdonald’s" -> "mcdonald s" (curly form split into a stray token), and
    // "mcdonalds"  -> "mcdonald". Since the key basis is whatever spelling the
    // LLM emitted, which row a user hit was effectively random — live on the box
    // "mcdonalds fries" returned McDonald's Fries Medium (114g) while
    // "mcdonald's fries" returned a generic unbranded Fries (250g).
    // ======================================================================
    describe('possessive apostrophes collapse to one key', () => {
        it.each([
            ["mcdonald's fries", 'mcdonalds fries'],
            ['mcdonald’s fries', 'mcdonalds fries'],
            ["trader joe's orange chicken", 'trader joes orange chicken'],
            ["stouffer's lasagna", 'stouffers lasagna'],
            ["jimmy john's turkey tom", 'jimmy johns turkey tom'],
        ])('%s === %s', (withApostrophe, without) => {
            expect(canonicalizeCacheKey(withApostrophe)).toBe(canonicalizeCacheKey(without));
        });

        it('leaves no dangling apostrophe in the key', () => {
            expect(canonicalizeCacheKey("mcdonald's fries")).toBe('fry mcdonald');
            expect(canonicalizeCacheKey("portillo's hot dog")).toBe('dog hot portillo');
        });

        it('is a fixed point, so migrating a stored key is one-shot', () => {
            for (const q of ["moe's chips", 'mcdonald’s fries', "trader joe's mandarin orange chicken"]) {
                const once = canonicalizeCacheKey(q);
                expect(canonicalizeCacheKey(once)).toBe(once);
            }
        });

        it('does not fuse words across a non-possessive apostrophe', () => {
            // "it's-it" is a real ice cream brand: dropping the apostrophe must not
            // merge it into neighbouring tokens or drop the hyphen.
            expect(canonicalizeCacheKey("it's-it ice cream sandwich")).toBe('cream ice its-it sandwich');
        });

        it('is inert on names without apostrophes', () => {
            for (const q of ['impossible burger patty', '2% milk', 'half-and-half', 'greek yogurt']) {
                expect(canonicalizeCacheKey(q)).toBe(canonicalizeCacheKey(q.replace(/'/g, '')));
            }
        });
    });
});
