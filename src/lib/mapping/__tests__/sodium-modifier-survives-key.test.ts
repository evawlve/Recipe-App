import { normalizeIngredientName, clearRulesCache } from '../normalization-rules';
import { parseIngredientLine } from '../../parse/ingredient-line';
import { deriveCacheKeyName } from '../cache-key-core';
import { RULES_VERSION } from '../validated-mapping-helpers';
import rulesJson from '../../../../data/fatsecret/normalization-rules.json';

/**
 * A sodium modifier must survive into the FoodMapping cache key.
 *
 * The defect this pins, MEASURED live on the box before the fix (build
 * szIZeR6Ah_JBjJL3xHs5K, 2026-08-14): 'low sodium' and 'less sodium' were in
 * prep_phrases, so normalizeIngredientName() deleted them from normalizedName --
 * the string deriveMappingCacheKey() keys on. 'low sodium soy sauce' therefore
 * collided with bare 'soy sauce' and served its cached row,
 * off_0074261182164 (4.467 g Na/100 g), at funnelStage=cache_hit, on the SOLO
 * and the COMPOSITE path alike. Genuine reduced-sodium soy sauce measures
 * 2.85-3.58 g Na/100 g, so the collision over-billed sodium ~1.4x warm and
 * ~1.8x cold -- on the single nutrient the modifier exists to name.
 *
 * This is the same defect class as the cooking verbs (PR #211) and the same
 * class as the nutrition modifiers restored in PR #316. #316 deliberately
 * carved this family out because it is dropped by a THIRD writer -- this
 * deterministic prep_phrases strip -- rather than by the AI segmenter, and so
 * needs the RULES_VERSION bump rather than a guard at the LLM output.
 *
 * The counts below are asserted EXACTLY, not with toBeGreaterThan, so that
 * reverting the rule change fails loudly rather than silently thinning
 * coverage. Non-vacuity was proven by reverting: on master all 6 TARGETS
 * collide with their bare form and PRESERVED reads 0.
 */

// Inputs whose modifier MUST survive normalization and MUST split the key away
// from the bare food. Every one measured collapsing on master.
const TARGETS: { input: string; bare: string }[] = [
    { input: 'low sodium soy sauce', bare: 'soy sauce' },
    { input: 'less sodium soy sauce', bare: 'soy sauce' },
    { input: 'low sodium chicken broth', bare: 'chicken broth' },
    { input: 'low sodium bacon', bare: 'bacon' },
    { input: 'low sodium cottage cheese', bare: 'cottage cheese' },
    { input: 'low sodium turkey breast', bare: 'turkey breast' },
];

// Inputs whose normalized output must be BYTE-IDENTICAL to master's. These are
// the blast radius: other prep phrases, the modifier families that were already
// safe and are deliberately untouched, and the two context-aware rewrites that
// share the synonym_rewrites loop this PR edits.
const SENTINELS: { input: string; cleaned: string }[] = [
    // the bare foods the targets used to collide with - must not move
    { input: 'soy sauce', cleaned: 'soy sauce' },
    { input: 'bacon', cleaned: 'bacon' },
    { input: 'cottage cheese', cleaned: 'cottage cheese' },
    // sodium/fat siblings already preserved before this PR - nothing to do
    { input: 'reduced sodium soy sauce', cleaned: 'reduced sodium soy sauce' },
    { input: 'sodium free broth', cleaned: 'sodium free broth' },
    { input: 'no salt added black beans', cleaned: 'no salt added black beans' },
    { input: 'low fat milk', cleaned: 'low fat milk' },
    { input: 'reduced fat peanut butter', cleaned: 'reduced fat peanut butter' },
    { input: 'fat free milk', cleaned: 'fat free milk' },
    { input: 'unsalted butter', cleaned: 'unsalted butter' },
    // other prep_phrases must still strip exactly as before
    { input: 'lightly salted almonds', cleaned: 'salted almonds' },
    { input: 'fancy shredded cheese', cleaned: 'cheese' },
    { input: 'extra virgin olive oil', cleaned: 'virgin olive oil' },
    { input: 'low-moisture mozzarella', cleaned: 'mozzarella' },
    // PR #211's cooking verbs and the protected 'whole' must be untouched
    { input: 'grilled chicken', cleaned: 'grilled chicken' },
    { input: 'whole milk', cleaned: 'whole milk' },
    { input: 'dried apricots', cleaned: 'dried apricots' },
    { input: 'canned pineapple', cleaned: 'canned pineapple' },
    // context-aware rewrites downstream of the synonym loop this PR edits
    { input: 'vanilla', cleaned: 'vanilla extract' },
    { input: 'chicken breast', cleaned: 'skinless chicken breast' },
    { input: 'green beans', cleaned: 'green string beans' },
];

const keyFor = (line: string): string => {
    const parsed = parseIngredientLine(line);
    return deriveCacheKeyName(normalizeIngredientName(parsed.name).cleaned, parsed);
};

beforeEach(() => {
    clearRulesCache();
});

describe('sodium modifiers survive into the cache key', () => {
    it('preserves the modifier in the normalized name on every target', () => {
        const preserved = TARGETS.filter(({ input }) =>
            /\bsodium\b/i.test(normalizeIngredientName(input).cleaned)
        );
        // Exact count. On master this is 0 of 6.
        expect(preserved).toHaveLength(6);
        expect(preserved).toHaveLength(TARGETS.length);
    });

    it('splits every target away from its bare food at the cache key', () => {
        const split = TARGETS.filter(({ input, bare }) => keyFor(input) !== keyFor(bare));
        // Exact count. On master this is 0 of 6 - all six collide.
        expect(split).toHaveLength(6);
        expect(split).toHaveLength(TARGETS.length);
    });

    it('keys the flagship pair apart from bare soy sauce', () => {
        // The exact keys, so a change in tokenisation is visible here too.
        expect(keyFor('soy sauce')).toBe('sauce soy');
        expect(keyFor('low sodium soy sauce')).toBe('low sauce sodium soy');
    });

    it('canonicalises the two shopper spellings onto ONE key', () => {
        // 'less sodium' is the spelling the OFF corpus actually uses (Publix,
        // Kroger, Kikkoman, Market Basket); 'low sodium' is what FatSecret uses.
        // They are the same product, so they keep sharing a key - as they did
        // before this PR, which means no NEW collision is introduced.
        expect(keyFor('less sodium soy sauce')).toBe(keyFor('low sodium soy sauce'));
    });

    it('leaves every sentinel byte-identical', () => {
        const unchanged = SENTINELS.filter(
            ({ input, cleaned }) => normalizeIngredientName(input).cleaned === cleaned
        );
        // Exact count. Must be ALL of them, on master and on this branch alike.
        expect(unchanged).toHaveLength(21);
        expect(unchanged).toHaveLength(SENTINELS.length);
    });

    it('leaves the sentinels that are modifier-bearing split from their bare food', () => {
        // These already split before this PR; the PR must not merge them.
        expect(keyFor('low fat milk')).not.toBe(keyFor('milk'));
        expect(keyFor('reduced sodium soy sauce')).not.toBe(keyFor('soy sauce'));
        expect(keyFor('grilled chicken')).not.toBe(keyFor('chicken'));
        expect(keyFor('whole milk')).not.toBe(keyFor('milk'));
    });
});

describe('the rules change ships with its cache invalidation', () => {
    // Paired guard, exactly like cooking-verbs-out-of-prep-phrases-and-cache-bumped.
    // Removing a strip rule WITHOUT bumping RULES_VERSION leaves AiNormalizeCache
    // replaying the old collapse while every test above stays green, because they
    // call the normalizer directly and never touch the cache.
    it('has no sodium modifier left in prep_phrases', () => {
        const offenders = rulesJson.prep_phrases.filter((p: string) =>
            ['low sodium', 'less sodium'].includes(p.trim().toLowerCase())
        );
        expect(offenders).toHaveLength(0);
    });

    it('has dropped the word-order rewrite whose only consumer was that strip', () => {
        const shuffle = rulesJson.synonym_rewrites.filter(
            (r: { from: string; to: string }) => r.to === 'soy sauce low sodium'
        );
        expect(shuffle).toHaveLength(0);
    });

    it('keeps the less->low canonicalisation', () => {
        const canon = rulesJson.synonym_rewrites.filter(
            (r: { from: string; to: string }) =>
                r.from === 'less sodium soy sauce' && r.to === 'low sodium soy sauce'
        );
        expect(canon).toHaveLength(1);
    });

    it('bumped RULES_VERSION to at least 3', () => {
        expect(RULES_VERSION).toBeGreaterThanOrEqual(3);
    });
});
