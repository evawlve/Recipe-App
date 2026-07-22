import {
    deriveMappingCacheKey,
    collapseAdjacentDuplicateTokens,
    isMalformedCacheKey,
    BrandKeyInput,
} from '../cache-key';
import { canonicalizeCacheKey } from '../normalization-rules';
import { detectBrandInQuery } from '../brand-detector';
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
 * Regression (golden n-mq-30 "bell pepper"): the brand lexicon carries a bare
 * "bell" entry (Bell & Evans), so detectBrandInQuery("bell pepper") returns
 * matchedBrand "bell". Once AI normalize rewrote the name to "capsicum", an
 * UNCONDITIONAL brand prefix produced read/write key "bell capsicum" and
 * orphaned the live human-triage "capsicum" row. The prefix is therefore
 * gated on hasDecisiveBrandContext — the same "did the query really name a
 * brand" definition the brand-mismatch save gate and rerank already use:
 * multi-word brands count only as their full detected phrase; single-word
 * brands only next to a product-form token ("ghost whey", "ryse shake").
 *
 * deriveMappingCacheKey is THE single key function for both lookups and the
 * save. These tests pin the properties that make that safe:
 *   1. write key === read key for the same (normalizedName, parsed, brand, rawLine)
 *   2. the key survives saveValidatedMapping's re-canonicalization unchanged
 *   3. no key ever contains the same token twice in a row
 *   4. idempotence: deriving from a line equal to a saved key yields that key
 *   5. non-decisive brand hits NEVER alter the key
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
    rawLine: string;
    expectedKey: string;
}

// The write/read matrix: plain, modifier-carrying, branded (decisive and
// non-decisive), brand-only, plural brands, doubled-token input, and the
// n-mq-30 false-positive class.
const MATRIX: MatrixCase[] = [
    {
        label: 'plain: "kidney beans"',
        normalizedName: 'kidney beans',
        parsed: parsed({ name: 'kidney beans' }),
        brand: NO_BRAND,
        rawLine: 'kidney beans',
        expectedKey: 'bean kidney',
    },
    {
        label: 'modifier-carrying: "canned kidney beans"',
        normalizedName: 'canned kidney beans',
        parsed: parsed({ name: 'canned kidney beans' }),
        brand: NO_BRAND,
        rawLine: 'canned kidney beans',
        expectedKey: 'bean canned kidney',
    },
    {
        label: 'modifier-carrying: "dry rolled oats"',
        normalizedName: 'dry rolled oats',
        parsed: parsed({ name: 'dry rolled oats' }),
        brand: NO_BRAND,
        rawLine: 'dry rolled oats',
        expectedKey: 'dry oat rolled',
    },
    {
        label: 'doubled-modifier input: "canned canned kidney beans" (AI-normalize class)',
        normalizedName: 'canned canned kidney beans',
        parsed: parsed({ name: 'canned canned kidney beans' }),
        brand: NO_BRAND,
        rawLine: 'canned kidney beans',
        expectedKey: 'bean canned kidney',
    },
    {
        label: 'doubled-modifier input: "dry rolled rolled oats"',
        normalizedName: 'dry rolled rolled oats',
        parsed: parsed({ name: 'dry rolled rolled oats' }),
        brand: NO_BRAND,
        rawLine: 'dry rolled oats',
        expectedKey: 'dry oat rolled',
    },
    {
        label: 'n-mq-30: "bell pepper" with false-positive lexicon brand "bell" — key untouched',
        normalizedName: 'bell pepper',
        parsed: parsed({ name: 'bell pepper' }),
        brand: { isBranded: true, matchedBrand: 'bell' },
        rawLine: 'bell pepper',
        expectedKey: 'bell pepper',
    },
    {
        label: 'n-mq-30 regression: AI-rewritten "capsicum" + false-positive brand "bell" — NO prefix',
        normalizedName: 'capsicum',
        parsed: parsed({ name: 'bell pepper' }),
        brand: { isBranded: true, matchedBrand: 'bell' },
        rawLine: 'bell pepper',
        expectedKey: 'capsicum',
    },
    {
        label: '"dr pepper" — genuine multi-word brand, tokens already in name',
        normalizedName: 'dr pepper',
        parsed: parsed({ name: 'dr pepper' }),
        brand: { isBranded: true, matchedBrand: 'dr pepper' },
        rawLine: 'dr pepper',
        expectedKey: 'dr pepper',
    },
    {
        label: '"dr pepper" AI-stripped to "soda" — multi-word brand decisive, prefix fires',
        normalizedName: 'soda',
        parsed: parsed({ name: 'dr pepper' }),
        brand: { isBranded: true, matchedBrand: 'dr pepper' },
        rawLine: 'dr pepper',
        expectedKey: 'dr pepper soda',
    },
    {
        label: '"taco bell burrito" with detector 1-gram hit "bell" (non-decisive) — key untouched',
        normalizedName: 'taco bell burrito',
        parsed: parsed({ name: 'taco bell burrito' }),
        brand: { isBranded: true, matchedBrand: 'bell' },
        rawLine: 'taco bell burrito',
        expectedKey: 'bell burrito taco',
    },
    {
        label: '"taco bell burrito" with full brand "taco bell" — tokens present, prefix skipped',
        normalizedName: 'taco bell burrito',
        parsed: parsed({ name: 'taco bell burrito' }),
        brand: { isBranded: true, matchedBrand: 'taco bell' },
        rawLine: 'taco bell burrito',
        expectedKey: 'bell burrito taco',
    },
    {
        label: 'branded, brand in name: "oikos greek yogurt" (single-word, non-decisive)',
        normalizedName: 'oikos greek yogurt',
        parsed: parsed({ name: 'oikos greek yogurt' }),
        brand: { isBranded: true, matchedBrand: 'Oikos' },
        rawLine: 'oikos greek yogurt',
        expectedKey: 'greek oiko yogurt',
    },
    {
        label: 'brand-only: "oikos" (the historical "oiko oiko" trigger)',
        normalizedName: 'oikos',
        parsed: parsed({ name: 'oikos' }),
        brand: { isBranded: true, matchedBrand: 'Oikos' },
        rawLine: 'oikos',
        expectedKey: 'oiko',
    },
    {
        label: 'branded, brand in name: "heinz tomato ketchup"',
        normalizedName: 'heinz tomato ketchup',
        parsed: parsed({ name: 'heinz tomato ketchup' }),
        brand: { isBranded: true, matchedBrand: 'Heinz' },
        rawLine: 'heinz tomato ketchup',
        expectedKey: 'heinz ketchup tomato',
    },
    {
        label: 'single-word brand + product-form context: "ghost whey" AI-normalized to "whey protein" — decisive, prefix fires',
        normalizedName: 'whey protein',
        parsed: parsed({ name: 'ghost whey' }),
        brand: { isBranded: true, matchedBrand: 'ghost' },
        rawLine: 'ghost whey',
        expectedKey: 'ghost protein whey',
    },
    {
        label: 'non-decisive stripped brand: "oikos greek yogurt" AI-normalized to "greek yogurt" — no prefix (matches legacy read reality)',
        normalizedName: 'greek yogurt',
        parsed: parsed({ name: 'greek yogurt' }),
        brand: { isBranded: true, matchedBrand: 'Oikos' },
        rawLine: 'oikos greek yogurt',
        expectedKey: 'greek yogurt',
    },
    {
        label: 'plural brand token in name: "siggis yogurt"',
        normalizedName: 'siggis yogurt',
        parsed: parsed({ name: 'siggis yogurt' }),
        brand: { isBranded: true, matchedBrand: 'Siggis' },
        rawLine: 'siggis yogurt',
        expectedKey: 'siggi yogurt',
    },
    {
        label: 'brand-only, plural brand: "siggis"',
        normalizedName: 'siggis',
        parsed: parsed({ name: 'siggis' }),
        brand: { isBranded: true, matchedBrand: 'Siggis' },
        rawLine: 'siggis',
        expectedKey: 'siggi',
    },
    {
        label: 'multi-word brand, generic name: "protein bar" + brand "met rx" — decisive, prefix fires',
        normalizedName: 'protein bar',
        parsed: parsed({ name: 'protein bar' }),
        brand: { isBranded: true, matchedBrand: 'Met Rx' },
        rawLine: 'met rx protein bar',
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
            const writeKey = deriveMappingCacheKey(c.normalizedName, c.parsed, c.brand, c.rawLine);
            const readKey = deriveMappingCacheKey(c.normalizedName, c.parsed, c.brand, c.rawLine);
            expect(writeKey).toBe(c.expectedKey);
            expect(readKey).toBe(writeKey);
        });

        it('survives the save-side re-canonicalization unchanged', () => {
            // saveValidatedMapping does normalizedForm = canonicalizeCacheKey(canonicalBase);
            // the stored key must equal the derived key or writes drift again.
            const writeKey = deriveMappingCacheKey(c.normalizedName, c.parsed, c.brand, c.rawLine);
            expect(canonicalizeCacheKey(writeKey)).toBe(writeKey);
        });

        it('survives the read-side re-canonicalization unchanged', () => {
            // getValidatedMappingByNormalizedName does canonicalizeCacheKey(normalizedName)
            // on the key it is handed before the exact-match lookup.
            const readKey = deriveMappingCacheKey(c.normalizedName, c.parsed, c.brand, c.rawLine);
            expect(canonicalizeCacheKey(readKey)).toBe(readKey);
        });

        it('never contains the same token twice in a row', () => {
            const key = deriveMappingCacheKey(c.normalizedName, c.parsed, c.brand, c.rawLine);
            expect(hasAdjacentDuplicateTokens(key)).toBe(false);
            expect(isMalformedCacheKey(key)).toBe(false);
        });

        it('is idempotent: deriving from the saved key yields the same key', () => {
            // A later query whose normalized name equals the stored key (e.g.
            // the row's own normalizedForm fed back through the pipeline) must
            // derive the identical key — this is what makes saved rows
            // permanently reachable.
            const savedKey = deriveMappingCacheKey(c.normalizedName, c.parsed, c.brand, c.rawLine);
            expect(deriveMappingCacheKey(savedKey, null, c.brand, c.rawLine)).toBe(savedKey);
            // And stability under repeated derivation with the original parse:
            expect(deriveMappingCacheKey(savedKey, c.parsed, c.brand, c.rawLine)).toBe(savedKey);
        });
    });

    describe('n-mq-30 "bell pepper" false-positive brand (lexicon "bell" 1-gram)', () => {
        it('the real detector flags "bell pepper" as branded via the bare lexicon entry', () => {
            // Documents the trigger: brand-lexicon.json carries "bell"
            // (Bell & Evans), and the 1-gram scan returns it for produce.
            const det = detectBrandInQuery('bell pepper');
            expect(det.isBranded).toBe(true);
            expect(det.matchedBrand?.toLowerCase()).toBe('bell');
        });

        it('non-decisive detector hit does not alter the AI-rewritten key (the orphaned-"capsicum" regression)', () => {
            const det = detectBrandInQuery('bell pepper');
            const brand = { isBranded: det.isBranded, matchedBrand: det.matchedBrand };
            // AI normalize rewrote "bell pepper" → "capsicum"; the stored
            // human-triage row lives at key "capsicum" and MUST stay reachable.
            const key = deriveMappingCacheKey('capsicum', parsed({ name: 'bell pepper' }), brand, 'bell pepper');
            expect(key).toBe('capsicum');
            expect(key).not.toBe('bell capsicum');
        });

        it('"dr pepper" keeps its brand handling (multi-word = decisive full phrase)', () => {
            const det = detectBrandInQuery('dr pepper');
            expect(det.matchedBrand?.toLowerCase()).toBe('dr pepper');
            const brand = { isBranded: det.isBranded, matchedBrand: det.matchedBrand };
            expect(deriveMappingCacheKey('dr pepper', parsed({ name: 'dr pepper' }), brand, 'dr pepper')).toBe('dr pepper');
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
            }, 'oikos');
            expect(key).toBe('oiko');
            expect(key).not.toBe('oiko oiko');
        });

        it('decisive brand already present as stem in key skips the prefix (token stems, not substrings)', () => {
            // "ghost whey": decisive (product-form adjacency); name kept the
            // brand token, so the prefix must skip on stem presence.
            const key = deriveMappingCacheKey(
                'ghost whey',
                parsed({ name: 'ghost whey' }),
                { isBranded: true, matchedBrand: 'ghost' },
                'ghost whey',
            );
            expect(key).toBe('ghost whey');
            expect(key.split(' ').filter(t => t === 'ghost')).toHaveLength(1);
        });

        it('substring-only overlap does NOT count as brand presence (decisive multi-word brand)', () => {
            // Brand token "eat" is a substring of the key token "meat" — the
            // old includes() guard would wrongly treat the brand as present
            // and skip the prefix. Stem-token comparison prefixes it.
            const key = deriveMappingCacheKey('meat snack', parsed({ name: 'meat snack' }), {
                isBranded: true,
                matchedBrand: 'eat protein',
            }, 'eat protein meat snack');
            expect(key).toBe(canonicalizeCacheKey('eat protein meat snack'));
            expect(key.split(' ')).toContain('eat');
        });
    });

    describe('brand input edge cases', () => {
        it('isBranded=false ignores matchedBrand entirely', () => {
            const key = deriveMappingCacheKey('greek yogurt', parsed({ name: 'greek yogurt' }), {
                isBranded: false,
                matchedBrand: 'oikos',
            }, 'oikos greek yogurt');
            expect(key).toBe('greek yogurt');
        });

        it('isBranded=true with no matchedBrand adds nothing', () => {
            const key = deriveMappingCacheKey('greek yogurt', parsed({ name: 'greek yogurt' }), {
                isBranded: true,
                matchedBrand: null,
            }, 'greek yogurt');
            expect(key).toBe('greek yogurt');
        });

        it('null/undefined brandDetection behaves like unbranded (legacy callers)', () => {
            expect(deriveMappingCacheKey('kidney beans', null, null)).toBe('bean kidney');
            expect(deriveMappingCacheKey('kidney beans', null, undefined)).toBe('bean kidney');
        });

        it('partial multi-word-brand presence skips the prefix (no half-doubled brands)', () => {
            // Key already carries "rx" and "met"; prepending "met rx" would
            // double them.
            const key = deriveMappingCacheKey('met rx protein bar', parsed({ name: 'met rx protein bar' }), {
                isBranded: true,
                matchedBrand: 'met rx',
            }, 'met rx protein bar');
            expect(key).toBe('bar met protein rx');
            expect(hasAdjacentDuplicateTokens(key)).toBe(false);
        });
    });

    describe('identity discriminators still compose symmetrically (PR D pt3 C1)', () => {
        it('"egg" + unitHint "white" round-trips with a decisive multi-word brand', () => {
            const p = parsed({ name: 'egg', unitHint: 'white' });
            const brand = { isBranded: true, matchedBrand: 'vital farms' };
            const writeKey = deriveMappingCacheKey('egg', p, brand, 'vital farms egg whites');
            expect(writeKey).toBe(canonicalizeCacheKey('vital farms egg white'));
            expect(deriveMappingCacheKey(writeKey, null, brand, 'vital farms egg whites')).toBe(writeKey);
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

describe('isMalformedCacheKey (shared by legacy-read fallback + cleanup script)', () => {
    it('flags adjacent duplicate tokens', () => {
        expect(isMalformedCacheKey('oiko oiko')).toBe(true);
        expect(isMalformedCacheKey('bean canned canned kidney')).toBe(true);
        expect(isMalformedCacheKey('oat rolled rolled')).toBe(true);
    });

    it('flags stem-space duplicates (plural/singular doubled brand, legacy unsorted keys)', () => {
        expect(isMalformedCacheKey('ree rees')).toBe(true);
        expect(isMalformedCacheKey('oikos greek oiko yogurt')).toBe(true);
    });

    it('passes clean keys', () => {
        expect(isMalformedCacheKey('bell pepper')).toBe(false);
        expect(isMalformedCacheKey('capsicum')).toBe(false);
        expect(isMalformedCacheKey('dr pepper')).toBe(false);
        expect(isMalformedCacheKey('bean canned kidney')).toBe(false);
        expect(isMalformedCacheKey('')).toBe(false);
    });
});
