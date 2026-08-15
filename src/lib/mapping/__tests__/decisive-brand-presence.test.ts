import { detectBrandInQuery } from '../brand-detector';
import { hasDecisiveBrandContext } from '../simple-rerank';
import { deriveMappingCacheKey } from '../cache-key';

/**
 * `hasDecisiveBrandContext()` used to be `if (brandTokens.length >= 2) return true`
 * — the text was never consulted. Any >= 2-word brand was decisive for a query
 * that never named it, and decisiveness is spent at six call sites, one of which
 * (`deriveMappingCacheKey`) PREFIXES the cache key with the brand.
 *
 * The multi-token brand does not always come from the text: `options.brand` is
 * the AI segmenter's own field, and live SegmentationCache rows show it emitting
 * "Noodles and Company" for an item whose rawText is "buttered noodles".
 *
 * These tests pin the presence test AND the two properties that make it safe.
 */
describe('hasDecisiveBrandContext: the multi-token branch tests presence', () => {
    it('DECLINES a >= 2-token brand absent from the text (the defect)', () => {
        // Live case, straight out of SegmentationCache.
        expect(hasDecisiveBrandContext('buttered noodles', 'Noodles and Company')).toBe(false);
        // The retailer-substitution shape: a private label the query never named.
        expect(hasDecisiveBrandContext('costco mini croissants', 'kirkland signature')).toBe(false);
        expect(hasDecisiveBrandContext('mini croissants', "member's mark")).toBe(false);
    });

    it('still accepts a >= 2-token brand the text does name', () => {
        expect(hasDecisiveBrandContext('noodles and company pad thai', 'Noodles and Company')).toBe(true);
        expect(hasDecisiveBrandContext('kirkland signature mini croissants', 'kirkland signature')).toBe(true);
        expect(hasDecisiveBrandContext('great value macaroni and cheese', 'Great Value')).toBe(true);
        expect(hasDecisiveBrandContext('365 everyday value peanut butter', '365 everyday value')).toBe(true);
    });

    it('requires ADJACENCY, not merely both tokens somewhere', () => {
        // An order-free "all tokens present" test would call these decisive.
        expect(hasDecisiveBrandContext('great big value pack', 'great value')).toBe(false);
        expect(hasDecisiveBrandContext('whole wheat market foods 365', '365 whole foods market')).toBe(false);
    });

    it('is indifferent to the "&" vs "and" spelling, in both directions', () => {
        // OFF carries 1,539 "&" against 299 "and" for this class of brand, and the
        // segmenter re-punctuates freely, so the two spellings must be one brand.
        expect(hasDecisiveBrandContext('ben and jerrys cherry garcia', "Ben & Jerry's")).toBe(true);
        expect(hasDecisiveBrandContext("ben & jerry's cherry garcia", 'ben and jerrys')).toBe(true);
        expect(hasDecisiveBrandContext('good and gather granola', 'Good & Gather')).toBe(true);
        expect(hasDecisiveBrandContext('good & gather granola', 'good and gather')).toBe(true);
    });

    it('folds apostrophes and a trailing plural/possessive s', () => {
        expect(hasDecisiveBrandContext('ben jerry', "Ben & Jerry's")).toBe(true);
        expect(hasDecisiveBrandContext("dave's killer bread white bread", 'daves killer bread')).toBe(true);
        expect(hasDecisiveBrandContext('m and ms peanut butter', "M&M's")).toBe(false); // single-token brand: unchanged branch
    });

    it('keeps short tokens addressable — the fold must not erase them', () => {
        // "ms" must not singularize to "m" and stop matching.
        expect(hasDecisiveBrandContext('m and ms peanut', 'm and ms')).toBe(true);
        // "el" (2 chars) survives the length filter.
        expect(hasDecisiveBrandContext('old el paso thick n chunky salsa', 'Old El Paso')).toBe(true);
    });

    it('declines on empty or brand-free text rather than short-circuiting', () => {
        expect(hasDecisiveBrandContext('', 'kirkland signature')).toBe(false);
        expect(hasDecisiveBrandContext('scrambled eggs', 'kirkland signature')).toBe(false);
    });

    it('leaves the SINGLE-token branch exactly as it was', () => {
        // Present + product-context adjacency => decisive.
        expect(hasDecisiveBrandContext('one bar birthday cake', 'one')).toBe(true);
        // Present, no product-context neighbour => not decisive (the refuted n-mq-30 case).
        expect(hasDecisiveBrandContext('bell pepper', 'bell')).toBe(false);
        // Absent => not decisive.
        expect(hasDecisiveBrandContext('scrambled eggs', 'ghost')).toBe(false);
        // Empty brand => not decisive.
        expect(hasDecisiveBrandContext('anything at all', '   ')).toBe(false);
    });
});

/**
 * The safety property the design rests on. `detectBrandInQuery()` returns
 * `originalTokens.slice(i, i + size).join(' ')` — a phrase rebuilt from the
 * query's OWN tokens, using the same delimiter class and the same `length > 1`
 * filter the presence test uses. So for every brand the DETECTOR produced, the
 * presence test is true by construction and this change is a no-op.
 *
 * Measured over 7,145 distinct live MappingEventLog lines: 912 hit the
 * multi-token branch, 0 flipped. This test is that invariant in miniature — if
 * someone changes either tokenizer without changing the other, it fails here
 * instead of silently narrowing cache keys in production.
 */
describe('presence is a no-op on detector-derived brands (the blast-radius bound)', () => {
    const LINES = [
        'noodles and company pad thai',
        'kirkland signature mini croissants',
        'great value macaroni and cheese',
        '1 scoop optimum nutrition cookies and cream',
        'jack in the box bacon ultimate cheeseburger',
        'chicken of the sea chunk light tuna',
        'old el paso thick n chunky salsa',
        "dave's killer bread 21 whole grains and seeds",
        'cape cod sea salt and vinegar',
        'a jersey mikes giant club sub',
        'trader joes dark chocolate peanut butter cups',
        'lean cuisine spaghetti with meat sauce',
        '1 met rx big 100 colossal bar',
        "boar's head deluxe oven roasted turkey breast",
        'hillshire farm ultra thin oven roasted turkey',
    ];

    it.each(LINES)('a multi-token brand detected in %p stays decisive', (line) => {
        const det = detectBrandInQuery(line);
        if (!det.isBranded || !det.matchedBrand) return;
        const brand = det.matchedBrand.trim();
        if (brand.split(/\s+/).filter(Boolean).length < 2) return;
        expect(hasDecisiveBrandContext(line, brand)).toBe(true);
    });

    it('covers at least one genuinely multi-token detection', () => {
        const multi = LINES
            .map(l => detectBrandInQuery(l).matchedBrand?.trim())
            .filter((b): b is string => !!b && b.split(/\s+/).filter(Boolean).length >= 2);
        // Guards against the suite passing vacuously if the lexicon changes.
        expect(multi.length).toBeGreaterThan(4);
    });
});

/**
 * The consumer that makes this more than tidiness. A decisive brand is prefixed
 * onto the FoodMapping read/write key, and the brandless `legacyKey` fallback
 * cannot rescue an orphaned row because it derives from `normalizedName`, which
 * carries the query's own words rather than the substituted brand.
 */
describe('deriveMappingCacheKey no longer prefixes a brand the line never named', () => {
    it('does not prefix when the multi-token brand is absent from the raw line', () => {
        const absent = deriveMappingCacheKey(
            'croissants', null,
            { isBranded: true, matchedBrand: 'kirkland signature' },
            'costco mini croissants',
        );
        expect(absent).not.toContain('kirkland');
    });

    it('still prefixes when the line does name the brand', () => {
        const present = deriveMappingCacheKey(
            'croissants', null,
            { isBranded: true, matchedBrand: 'kirkland signature' },
            'kirkland signature mini croissants',
        );
        expect(present).toContain('kirkland');
    });
});
