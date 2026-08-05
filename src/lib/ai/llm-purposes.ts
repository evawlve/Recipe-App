/**
 * The structured-LLM purpose list, extracted from `structured-client.ts` so that a module
 * with ZERO other imports can own it.
 *
 * WHY IT IS ITS OWN FILE
 * `llm-usage-metrics.ts` needs this list to pre-seed its per-purpose counters, and
 * `/api/ok` needs `llm-usage-metrics.ts`. Importing the list from `structured-client.ts`
 * would drag `src/lib/mapping/config.ts` (and, transitively, `dotenv`) into the health
 * route. This file therefore imports nothing at all, deliberately.
 *
 * THE 'produce' PURPOSE HAS ZERO CALL SITES (measured 2026-08-04 on master @ 136d0e5).
 * Its counters therefore read a STRUCTURAL 0, and that must never be read as "no produce
 * calls happen" — nothing calls it, which is a different claim, and it is the same
 * fail-open shape that made `[AI:SERV]`'s pre-deploy 0 look like a measurement.
 *
 * Re-derive via the doc-check claim `structured-llm-produce-purpose-has-no-call-site`
 * (backend `scripts/doc-check/claims.json`), which owns the exact grep. The pattern is
 * deliberately NOT written out here: it is a literal search for the call-site spelling, so
 * quoting it in this comment would make the file match itself and the claim would read 1.
 *
 * The list keeps `'produce'` because `CONCURRENCY_LIMITS: Record<StructuredLlmPurpose,
 * number>` in structured-client.ts is an exhaustive Record — removing a member is a
 * separate, reviewed change, not a side effect of adding a counter.
 *
 * NOT THE SAME NAMESPACE: `ServingAiCallType` in `src/lib/mapping/serving-ai-tiers.ts`
 * also has a `'produce'` member. That one is a logger tag on the `[AI:*]` stream, not a
 * `callStructuredLlm()` purpose. Counting one as the other is a category error.
 */

export const STRUCTURED_LLM_PURPOSES = [
    'normalize',
    'serving',
    'ambiguous',
    'produce',
    'parse',
    'simplify',
    'nutrition',
] as const;

export type StructuredLlmPurpose = typeof STRUCTURED_LLM_PURPOSES[number];
