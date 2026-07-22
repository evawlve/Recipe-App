import { deriveMappingCacheKey, collapseAdjacentDuplicateTokens, BrandKeyInput } from '../cache-key';
import { canonicalizeCacheKey } from '../normalization-rules';
import type { ParsedIngredient } from '../../parse/ingredient-line';

/**
 * Round-trip property tests for cache-key read/write symmetry (Track 1c).
 *
 * The defect: the brand-prefix step used to live ONLY at the save site in
 * map-ingredient-with-fallback.ts, guarded by a substring includes() that
 * singularization defeats — querying "oikos" wrote key "oiko oiko" while
 * reads derived "oiko" (dead row, permanent cache miss). Live FoodMapping
 * also carries dup-token keys of the "canned canned kidney beans" /
 * "dry rolled rolled oats" class from key composition over already-doubled
 * normalized names.
 *
 * deriveMappingCacheKey is now THE single key function for both lookups and
 * the save. These tests pin the properties that make that safe:
 *   1. write key === read key for the same (normalizedName, parsed, brand)
 *   2. the key survives saveValidatedMapping's re-canonicalization unchanged
 *   3. no key ever contains the same token twice in a row
 *   4. idempotence: deriving from a line equal to a saved key yields that key
 */

function parsed(overrides: Partial<ParsedIngredient>): ParsedIngredient {
    return {
        qty: 1,
        multiplier: 1,
        name: '',
        ...overrides,
    };
}

const NO_BRAND: BrandKeyInput = { isBranded: false, matchedBrand: null };

interface MatrixCase {
    label: string;
    normalizedName: string;
    parsed: ParsedIngredient | null;
    brand: BrandKeyInput;
    expectedKey: string;
}

// The write/read matrix: plain, modifier-carrying, branded (brand in name and
// brand injected generically), brand-only, plural brands, doubled-token input.
const MATRIX: MatrixCase[] = [
    {
        label: 'plain: "kidney beans"',
        normalizedName: 'kidney beans',
        parsed: parsed({ name: 'kidney beans' }),
        brand: NO_BRAND,
        expectedKey: 'bean kidney',
    },
    {
        label: 'modifier-carrying: "canned kidney beans"',
        normalizedName: 'canned kidney beans',
        parsed: parsed({ name: 'canned kidney beans' }),
        brand: NO_BRAND,
        expectedKey: 'bean canned kidney',
    },
    {
        label: 'modifier-carrying: "dry rolled oats"',
        normalizedName: 'dry rolled oats',
        parsed: parsed({ name: 'dry rolled oats' }),
        brand: NO_BRAND,
        expectedKey: 'dry oat rolled',
    },
    {
        label: 'doubled-modifier input: "canned canned kidney beans" (AI-normalize class)',
        normalizedName: 'canned canned kidney beans',
        parsed: parsed({ name: 'canned canned kidney beans' }),
        brand: NO_BRAND,
        expectedKey: 'bean canned kidney',
    },
    {
        label: 'doubled-modifier input: "dry rolled rolled oats"',
        normalizedName: 'dry rolled rolled oats',
        parsed: parsed({ name: 'dry rolled rolled oats' }),
        brand: NO_BRAND,
        expectedKey: 'dry oat rolled',
    },
    {
        label: 'branded, brand in name: "oikos greek yogurt"',
        normalizedName: 'oikos greek yogurt',
        parsed: parsed({ name: 'oikos greek yogurt' }),
        brand: { isBranded: true, matchedBrand: 'Oikos' },
        expectedKey: 'greek oiko yogurt',
    },
    {
        label: 'brand-only: "oikos" (the historical "oiko oiko" trigger)',
        normalizedName: 'oikos',
        parsed: parsed({ name: 'oikos' }),
        brand: { isBranded: true, matchedBrand: 'Oikos' },
        expectedKey: 'oiko',
    },
    {
        label: 'branded, brand in name: "heinz tomato ketchup"',
        normalizedName: 'heinz tomato ketchup',
        parsed: parsed({ name: 'heinz tomato ketchup' }),
        brand: { isBranded: true, matchedBrand: 'Heinz' },
        expectedKey: 'heinz ketchup tomato',
    },
    {
        label: 'branded, generic name (AI stripped brand): "greek yogurt" + brand oikos → prefix fires',
        normalizedName: 'greek yogurt',
        parsed: parsed({ name: 'greek yogurt' }),
        brand: { isBranded: true, matchedBrand: 'Oikos' },
        expectedKey: 'greek oiko yogurt',
    },
    {
        label: 'plural brand token in name: "siggis yogurt"',
        normalizedName: 'siggis yogurt',
        parsed: parsed({ name: 'siggis yogurt' }),
        brand: { isBranded: true, matchedBrand: 'Siggis' },
        expectedKey: 'siggi yogurt',
    },
    {
        label: 'brand-only, plural brand: "siggis"',
        normalizedName: 'siggis',
        parsed: parsed({ name: 'siggis' }),
        brand: { isBranded: true, matchedBrand: 'Siggis' },
        expectedKey: 'siggi',
    },
    {
        label: 'multi-word brand, generic name: "protein bar" + brand "met rx"',
        normalizedName: 'protein bar',
        parsed: parsed({ name: 'protein bar' }),
        brand: { isBranded: true, matchedBrand: 'Met Rx' },
        expectedKey: 'bar met protein rx',
    },
];

function hasAdjacentDuplicateTokens(key: string): boolean {
    const tokens = key.split(/\s+/).filter(t => t.length > 0);
    return tokens.some((t, i) => i > 0 && tokens[i - 1] === t);
}

describe('deriveMappingCacheKey — read/write symmetry', () => {
    describe.each(MATRIX)('$label', (c) => {
        it('write key === read key', () => {
            // The save site and both lookup sites call the identical function
            // with the identical request-stable inputs.
            const writeKey = deriveMappingCacheKey(c.normalizedName, c.parsed, c.brand);
            const readKey = deriveMappingCacheKey(c.normalizedName, c.parsed, c.brand);
            expect(writeKey).toBe(c.expectedKey);
            expect(readKey).toBe(writeKey);
        });

        it('survives the save-side re-canonicalization unchanged', () => {
            // saveValidatedMapping does normalizedForm = canonicalizeCacheKey(canonicalBase);
            // the stored key must equal the derived key or writes drift again.
            const writeKey = deriveMappingCacheKey(c.normalizedName, c.parsed, c.brand);
            expect(canonicalizeCacheKey(writeKey)).toBe(writeKey);
        });

        it('survives the read-side re-canonicalization unchanged', () => {
            // getValidatedMappingByNormalizedName does canonicalizeCacheKey(normalizedName)
            // on the key it is handed before the exact-match lookup.
            const readKey = deriveMappingCacheKey(c.normalizedName, c.parsed, c.brand);
            expect(canonicalizeCacheKey(readKey)).toBe(readKey);
        });

        it('never contains the same token twice in a row', () => {
            const key = deriveMappingCacheKey(c.normalizedName, c.parsed, c.brand);
            expect(hasAdjacentDuplicateTokens(key)).toBe(false);
        });

        it('is idempotent: deriving from the saved key yields the same key', () => {
            // A later query whose normalized name equals the stored key (e.g.
            // the row's own normalizedForm fed back through the pipeline) must
            // derive the identical key — this is what makes saved rows
            // permanently reachable.
            const savedKey = deriveMappingCacheKey(c.normalizedName, c.parsed, c.brand);
            expect(deriveMappingCacheKey(savedKey, null, c.brand)).toBe(savedKey);
            // And stability under repeated derivation with the original parse:
            expect(deriveMappingCacheKey(savedKey, c.parsed, c.brand)).toBe(savedKey);
        });
    });

    describe('the historical includes() defeat (oikos → "oiko oiko")', () => {
        it('brand-only query no longer doubles the brand token', () => {
            // Old write path: cacheKey = "oiko"; "oiko".includes("oikos") === false
            // → prepend → canonicalize("oikos oiko") = "oiko oiko". Read path
            // derived "oiko" → row dead forever.
            const key = deriveMappingCacheKey('oikos', parsed({ name: 'oikos' }), {
                isBranded: true,
                matchedBrand: 'oikos',
            });
            expect(key).toBe('oiko');
            expect(key).not.toBe('oiko oiko');
        });

        it('brand stem-present-in-key skips the prefix (token stems, not substrings)', () => {
            const key = deriveMappingCacheKey(
                'oikos greek yogurt',
                parsed({ name: 'oikos greek yogurt' }),
                { isBranded: true, matchedBrand: 'oikos' },
            );
            expect(key).toBe('greek oiko yogurt');
            expect(key.split(' ').filter(t => t === 'oiko')).toHaveLength(1);
        });

        it('substring-only overlap does NOT count as brand presence', () => {
            // Brand "eat" is a substring of the token "meat" — the old
            // includes() guard would wrongly treat the brand as present and
            // skip the prefix. Stem-token comparison prefixes it.
            const key = deriveMappingCacheKey('meat snack', parsed({ name: 'meat snack' }), {
                isBranded: true,
                matchedBrand: 'eat',
            });
            expect(key).toBe('eat meat snack');
        });
    });

    describe('brand input edge cases', () => {
        it('isBranded=false ignores matchedBrand entirely', () => {
            const key = deriveMappingCacheKey('greek yogurt', parsed({ name: 'greek yogurt' }), {
                isBranded: false,
                matchedBrand: 'oikos',
            });
            expect(key).toBe('greek yogurt');
        });

        it('isBranded=true with no matchedBrand adds nothing', () => {
            const key = deriveMappingCacheKey('greek yogurt', parsed({ name: 'greek yogurt' }), {
                isBranded: true,
                matchedBrand: null,
            });
            expect(key).toBe('greek yogurt');
        });

        it('null/undefined brandDetection behaves like unbranded (legacy callers)', () => {
            expect(deriveMappingCacheKey('kidney beans', null, null)).toBe('bean kidney');
            expect(deriveMappingCacheKey('kidney beans', null, undefined)).toBe('bean kidney');
        });

        it('partial multi-word-brand presence skips the prefix (no half-doubled brands)', () => {
            // Key already carries "rx"; prepending "met rx" would double it.
            const key = deriveMappingCacheKey('met rx protein bar', parsed({ name: 'met rx protein bar' }), {
                isBranded: true,
                matchedBrand: 'met rx',
            });
            expect(key).toBe('bar met protein rx');
            expect(hasAdjacentDuplicateTokens(key)).toBe(false);
        });
    });

    describe('identity discriminators still compose symmetrically (PR D pt3 C1)', () => {
        it('"egg" + unitHint "white" round-trips with a brand', () => {
            const p = parsed({ name: 'egg', unitHint: 'white' });
            const brand = { isBranded: true, matchedBrand: 'vital farms' };
            const writeKey = deriveMappingCacheKey('egg', p, brand);
            expect(writeKey).toBe(canonicalizeCacheKey('vital farms egg white'));
            expect(deriveMappingCacheKey(writeKey, null, brand)).toBe(writeKey);
            expect(hasAdjacentDuplicateTokens(writeKey)).toBe(false);
        });
    });
});

describe('collapseAdjacentDuplicateTokens', () => {
    it('collapses runs of identical adjacent tokens', () => {
        expect(collapseAdjacentDuplicateTokens('oiko oiko')).toBe('oiko');
        expect(collapseAdjacentDuplicateTokens('bean canned canned kidney')).toBe('bean canned kidney');
        expect(collapseAdjacentDuplicateTokens('a a a b b c')).toBe('a b c');
    });

    it('leaves clean keys untouched', () => {
        expect(collapseAdjacentDuplicateTokens('bean canned kidney')).toBe('bean canned kidney');
        expect(collapseAdjacentDuplicateTokens('')).toBe('');
    });

    it('does not collapse non-adjacent duplicates (canonical keys are sorted, so this cannot occur post-canonicalize)', () => {
        expect(collapseAdjacentDuplicateTokens('oiko greek oiko')).toBe('oiko greek oiko');
    });
});
