/**
 * N1 — a brand-led line is a PRODUCT NAME, so recipe-ingredient normalization yields to it.
 *
 * These pins exist because nothing else covers the brand-led branch: the whole 226-suite
 * backend gate stayed green when N1 shipped, which measures that the shipped tests only ever
 * call `normalizeIngredientName()` on generic ingredient lines.
 *
 * Both halves are load-bearing. The reverts below are the defect; the generic block under
 * them is what N1 must NOT touch — every one of those rewrites is a live rule with its own
 * owner, and a gate that widened the brand predicate would take them out silently.
 *
 * Owner of the measurement: sync-docs/reports/2026-08-25_n1-the-product-name-survives-normalization.md
 * (mobile repo). Population: 100 of 4,102 coverage-corpus lines change their normalized
 * string; 116 of 7,746 distinct MappingEventLog raw lines move their cache key.
 */
import { normalizeIngredientName, isBrandLedProductName } from '../normalization-rules';

const cleanedOf = (name: string) => normalizeIngredientName(name).cleaned;

describe('N1: brand-led product names survive normalization', () => {
    // Each row is a line the pre-N1 normalizer rewrote into a string the shopper never
    // typed. The comment is what it used to retrieve.
    const REVERTED: Array<[string, string]> = [
        ['dr pepper', 'dr pepper'],                                     // was: dr black pepper
        ['diet dr pepper', 'diet dr pepper'],                           // was: diet dr black pepper
        ['whataburger dr pepper shake', 'whataburger dr pepper shake'], // was: ... dr black pepper shake
        ['chobani vanilla', 'chobani vanilla'],                         // was: chobani vanilla extract
        ['premier protein shake vanilla', 'premier protein shake vanilla'],
        ['corona extra', 'corona extra'],                               // was: corona
        ['kfc extra crispy chicken', 'kfc extra crispy chicken'],       // was: kfc crispy chicken
        ['mcdonalds hamburger', 'mcdonalds hamburger'],                 // was: mcdonalds 85% lean 15% fat beef
        ['kirkland signature ground beef', 'kirkland signature ground beef'],
        ['tim hortons double double', 'tim hortons double double'],     // was: tim hortons double
        ['hooters hooters sauce', 'hooters hooters sauce'],             // was: hooters sauce
        ['bonefish grill bang bang shrimp', 'bonefish grill bang bang shrimp'],
        ['ihop 2 x 2 x 2', 'ihop 2 x 2 x 2'],                           // was: ihop 2 x 2
        ['pizza hut cinnamon sticks', 'pizza hut cinnamon sticks'],     // was: pizza hut cinnamon
        ['boston market mashed potatoes', 'boston market mashed potatoes'],
        ['lindt dark chocolate 70%', 'lindt dark chocolate 70%'],       // was: lindt dark chocolate
        ['tyson chicken breast fillets', 'tyson chicken breast fillets'],
        ['stouffer\'s lasagna', "stouffer's lasagna"],                  // was: stouffer's lasagna noodles
        ['cholula hot sauce', 'cholula hot sauce'],                     // was: cholula hot pepper sauce
        ['quaker oats old fashioned', 'quaker oats old fashioned'],     // was: quaker rolled oats old fashioned
    ];

    it.each(REVERTED)('keeps %j as typed', (input, expected) => {
        expect(cleanedOf(input)).toBe(expected);
        expect(isBrandLedProductName(input)).toBe(true);
    });

    it('returns nounOnly identical to cleaned on the brand-led path', () => {
        // The STOP_WORDS list drops `extra`, `boneless`, `skinless`, `sliced` — all identity
        // on a product name. Nothing outside this module consumes nounOnly today; the pin is
        // here so a future consumer cannot silently reintroduce the strip.
        for (const [input] of REVERTED) {
            const out = normalizeIngredientName(input);
            expect(out.nounOnly).toBe(out.cleaned);
            expect(out.stripped).toEqual([]);
        }
    });

    it('still folds accents and collapses punctuation on a brand-led name', () => {
        // The two steps N1 deliberately keeps. `&` becomes a space in collapseSpaces(), which
        // is why `m&ms peanut` is NOT in the reverted set above — that fold is not a rewrite.
        expect(cleanedOf('Häagen-Dazs vanilla')).toBe('Haagen-Dazs vanilla');
        expect(cleanedOf('m&ms peanut')).toBe('m ms peanut');
    });
});

describe('N1: recipe-ingredient lines are untouched', () => {
    // Every rewrite below is a shipped rule with its own owner. N1 must not reach any of them.
    const UNCHANGED: Array<[string, string]> = [
        ['pepper', 'black pepper'],
        ['vanilla', 'vanilla extract'],
        ['chicken breast', 'skinless chicken breast'],
        // `ground` is prep-stripped after the leanness injection — base behaviour, verified
        // against master the day this pin was written, not a consequence of N1.
        ['ground beef', '85% lean 15% fat beef'],
        ['red pepper', 'red bell pepper'],
        // The repeated-phrase dedupe N1 skips on brand-led lines still runs here (`cubes` is
        // then removed as a size phrase, which is why this reads `ice` and not `ice cubes`).
        ['ice cubes ice cubes', 'ice'],
    ];

    it.each(UNCHANGED)('normalizes %j the way it always did', (input, expected) => {
        expect(isBrandLedProductName(input)).toBe(false);
        expect(cleanedOf(input)).toBe(expected);
    });
});
