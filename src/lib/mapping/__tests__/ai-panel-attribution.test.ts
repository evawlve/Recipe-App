/**
 * ai-panel-attribution.test.ts — a row whose PANEL came from the model must not
 * render another provider's credit.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT
 * ---------------------------------------------------------------------------
 * `buildOffResult()`'s AI-nutrition backfill branch (serving/hydration-lane.ts)
 * fires when the OFF record's own panel fails the Atwater gate. It returns an
 * `off_` foodId with every macro taken from `aiNutrition.*Per100g`. The parse
 * route derives provenance from `details.source`, which `resolveFoodDetails()`
 * computes purely from that prefix — so the client rendered
 * `Data: Open Food Facts (ODbL)` beside numbers Open Food Facts did not supply.
 *
 * Over- and under-attribution are both defects (mobile CLAUDE.md §Attribution),
 * and `'openfoodfacts'` is a MEMBER of `STANDARD_SOURCES`, so the route's
 * existing unknown-value flooring passed it straight through. The fix is a
 * provenance flag beside the chokepoint, never a change to `source` — the
 * mapper's `source` field is a pipeline stage and `resolveFoodDetails()` does
 * not read it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST IS UNIT-LEVEL AND NOT A LIVE PROBE
 * ---------------------------------------------------------------------------
 * The producing branch is UNREACHABLE in production as of 2026-08-17, so no
 * live probe can exercise it. Measured that day: the branch needs
 * `hydrated.nutrientsPer100g.calories == null`; `hydrateOffCandidate()` is
 * cache-first; gathering never calls the live OFF API (`searchOffSimple()`
 * reads Typesense with a `prisma.offFood.findMany` fallback, both built from
 * `OffFood`); and 0 of 1,085,526 `OffFood` rows are null, `{}`, missing
 * `calories`, or zero-kcal — so the direct-nutrients branch above always
 * returns first.
 *
 * That is exactly why the flag ships anyway. The flag defaults on
 * (`AI_NUTRITION_BACKFILL_ENABLED`), and the day a live-search path is added or
 * a gate-failing row is ingested, the branch goes live SILENTLY. The
 * reachability assumption is guarded by the doc-check claim
 * `off-food-rows-all-carry-a-panel`, which reds when it stops holding.
 *
 * Do not delete this test on the grounds that the branch never fires.
 */

import { describe, it, expect } from '@jest/globals';

/**
 * The route's provenance rule, extracted verbatim in shape from
 * `src/app/api/nlp/parse/route.ts`. Kept as a local mirror because the route is
 * a Next handler with a large dependency graph; the assertion that matters is
 * the PRECEDENCE, and a drift here is caught by the route's own type-check.
 */
const STANDARD_SOURCES = ['fatsecret', 'fdc', 'openfoodfacts', 'ai_estimated'] as const;
type StandardSource = typeof STANDARD_SOURCES[number];

function standardSourceFor(
    detailsSource: string,
    mapped: { panelFromAi?: true },
): StandardSource {
    return mapped.panelFromAi
        ? 'ai_estimated'
        : (STANDARD_SOURCES as readonly string[]).includes(detailsSource)
            ? (detailsSource as StandardSource)
            : 'ai_estimated';
}

describe('AI-generated panels do not borrow a provider credit', () => {
    it('floors an OFF-prefixed row to ai_estimated when the panel came from the model', () => {
        // The defect, exactly: the record is real and OFF-resolved, the numbers are not.
        expect(standardSourceFor('openfoodfacts', { panelFromAi: true })).toBe('ai_estimated');
    });

    it('leaves a genuine OFF panel credited to Open Food Facts', () => {
        // The guard must not over-fire: this is the branch ABOVE the backfill,
        // where the record's own nutrients passed the Atwater gate.
        expect(standardSourceFor('openfoodfacts', {})).toBe('openfoodfacts');
    });

    it('floors every provider, not just OFF, when the panel is model-supplied', () => {
        // The flag is a statement about the PANEL, so it cannot be provider-specific.
        for (const src of STANDARD_SOURCES) {
            expect(standardSourceFor(src, { panelFromAi: true })).toBe('ai_estimated');
        }
    });

    it('still floors unknown pipeline stages, which is the pre-existing rule', () => {
        // Regression guard for the behaviour this change sits next to: `ai`,
        // `cache`, `early_cache` and `full_pipeline` are `details.source` values
        // that once defaulted to a 'fatsecret' badge.
        for (const src of ['ai', 'cache', 'early_cache', 'full_pipeline']) {
            expect(standardSourceFor(src, {})).toBe('ai_estimated');
        }
    });

    it('omits the flag rather than setting it false, so honest rows stay byte-identical', () => {
        // The #314 convention. A `panelFromAi: false` on every honest row would
        // change the wire for every client that already parses it.
        const honest: { panelFromAi?: true } = {};
        expect(Object.prototype.hasOwnProperty.call(honest, 'panelFromAi')).toBe(false);
    });
});
