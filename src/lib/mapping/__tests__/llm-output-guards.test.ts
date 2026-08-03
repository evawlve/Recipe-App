import { stripIntroducedFoodTokens, resolveIsBrandedQuery } from '../llm-output-guards';

/**
 * Guards the flavour-word promotion measured 2026-08-03: ai-normalize appends
 * `extract` to a trailing flavour word, turning a yogurt or a protein shake
 * into a 288 kcal/100g, 34%-alcohol ingredient.
 *
 * The live evidence, cold and repeated:
 *   vanilla yogurt        -> "Vanilla Extract"  288 kcal/100g, 4.2 g
 *   vanilla protein shake -> "Vanilla extract"  286 kcal/100g, 150 g = 429 kcal
 *
 * The golden gate cannot see any of this: `n-supp-15` is the only vanilla case
 * and it carries a brand (`orgain`), which recovers the pick on its own.
 */
describe('stripIntroducedFoodTokens', () => {
    describe('fires when the model introduced the token', () => {
        it.each([
            // [raw input, LLM output, expected repair]
            ['vanilla yogurt', 'vanilla yogurt extract', 'vanilla yogurt'],
            ['vanilla protein shake', 'vanilla protein shake extract', 'vanilla protein shake'],
            // the real rows, highest-traffic first (AiNormalizeCache, 2026-08-03)
            [
                'orgain organic protein powder vanilla',
                'orgain organic protein powder vanilla extract',
                'orgain organic protein powder vanilla',
            ],
            ['haagen dazs vanilla', 'haagen dazs vanilla extract', 'haagen dazs vanilla'],
            ['chobani zero sugar vanilla', 'chobani zero sugar vanilla extract', 'chobani zero sugar vanilla'],
            // inserted mid-string, not appended
            [
                'orgain organic protein vanilla bean',
                'orgain organic protein vanilla extract bean',
                'orgain organic protein vanilla bean',
            ],
            // the two REPLACE-shaped rows: stripping cannot restore the lost
            // noun, but removing the head noun is still strictly better
            ['latte vanilla', 'vanilla extract', 'vanilla'],
        ])('%s -> %s', (raw, llm, expected) => {
            const r = stripIntroducedFoodTokens(raw, llm);
            expect(r.cleaned).toBe(expected);
            expect(r.removed).toEqual(['extract']);
        });
    });

    describe('does NOT fire', () => {
        it('when the user actually typed the token', () => {
            const r = stripIntroducedFoodTokens('vanilla extract', 'vanilla extract');
            expect(r.cleaned).toBe('vanilla extract');
            expect(r.removed).toEqual([]);
        });

        it('when the user typed it with different casing or punctuation', () => {
            const r = stripIntroducedFoodTokens('1 tsp Vanilla Extract', 'vanilla extract');
            expect(r.cleaned).toBe('vanilla extract');
            expect(r.removed).toEqual([]);
        });

        it('on a substring — "extracted" is not "extract"', () => {
            const r = stripIntroducedFoodTokens('cold extracted olive oil', 'cold extracted olive oil');
            expect(r.cleaned).toBe('cold extracted olive oil');
            expect(r.removed).toEqual([]);
        });

        it('on the qualifiers the normalizer is SUPPOSED to introduce', () => {
            // `rolled` (18 rows) and `skinless` (16 rows) refine the same food.
            // A blanket "token absent from input" rule would revert both; this
            // guard is an allowlist precisely so it does not.
            expect(stripIntroducedFoodTokens('oatmeal', 'rolled oats').cleaned).toBe('rolled oats');
            expect(stripIntroducedFoodTokens('chicken breast', 'skinless chicken breast').cleaned).toBe(
                'skinless chicken breast',
            );
        });
    });

    describe('safety properties', () => {
        it('never empties the query', () => {
            const r = stripIntroducedFoodTokens('vanilla', 'extract');
            expect(r.cleaned).toBe('extract');
            expect(r.removed).toEqual([]);
        });

        it('leaves apostrophes alone — the possessive cache-key fork must not return', () => {
            const r = stripIntroducedFoodTokens("ben and jerry's vanilla", "ben and jerry's vanilla extract");
            expect(r.cleaned).toBe("ben and jerry's vanilla");
        });

        it('tolerates null and empty output', () => {
            expect(stripIntroducedFoodTokens('vanilla', null).cleaned).toBe('');
            expect(stripIntroducedFoodTokens('vanilla', undefined).removed).toEqual([]);
            expect(stripIntroducedFoodTokens('vanilla', '').cleaned).toBe('');
        });

        it('is idempotent', () => {
            const once = stripIntroducedFoodTokens('vanilla yogurt', 'vanilla yogurt extract').cleaned;
            const twice = stripIntroducedFoodTokens('vanilla yogurt', once).cleaned;
            expect(twice).toBe(once);
        });
    });
});

/**
 * The branded-query flag when the static detector and the model disagree.
 *
 * MEASURED 2026-08-03 over the 2,881 user-namespace AiNormalizeCache rows on
 * the live box: the model downgrades a static `true` on 56 of them, and on 42
 * — carrying 292 of the population's 310 reads — the static detector is the one
 * that is wrong. So this is deliberately NOT a plain upgrade-only rule. See
 * resolveIsBrandedQuery()'s comment for the full split (and for why a bare "56"
 * is ambiguous in this population) and for what a false positive costs.
 */
describe('resolveIsBrandedQuery', () => {
    it('lets the model UPGRADE unconditionally — the documented intent', () => {
        expect(resolveIsBrandedQuery(false, true, false)).toBe(true);
        expect(resolveIsBrandedQuery(false, true, true)).toBe(true);
    });

    it('REFUSES a downgrade when the static brand evidence is decisive', () => {
        // `just bare chicken breast strips`, `diet dr pepper`, `once again
        // cashew butter` — real brands the model answered `false` on.
        expect(resolveIsBrandedQuery(true, false, true)).toBe(true);
        expect(resolveIsBrandedQuery(true, undefined, true)).toBe(true);
    });

    it('ALLOWS a downgrade when the static hit is not decisive', () => {
        // `greek yogurt with granola` (148 reads), `mirin` (44), `bell pepper`,
        // `roasted brussels sprouts`, `pico de gallo`. The detector matched a
        // common food word; the model is correcting it, and preserving the
        // static `true` would newly reject these rows through `brand_guard`.
        expect(resolveIsBrandedQuery(true, false, false)).toBe(false);
        expect(resolveIsBrandedQuery(true, undefined, false)).toBe(false);
    });

    it('stays false when neither signal says branded', () => {
        expect(resolveIsBrandedQuery(false, false, false)).toBe(false);
        // Decisiveness alone is not a brand signal: it is only a tiebreak, so it
        // must never manufacture a `true` the static detector never produced.
        expect(resolveIsBrandedQuery(false, false, true)).toBe(false);
        expect(resolveIsBrandedQuery(false, undefined, true)).toBe(false);
    });
});
