/**
 * The confidence written when simpleRerank() DECLINED to name a winner.
 *
 * ## Why this is its own file
 *
 * This module must import NOTHING. It is read by both `sub-threshold-admission.ts`
 * (which re-exports it, so the three save-gate constants stay assertable in one
 * place) and `gather-candidates.ts`. Importing it into gather-candidates from
 * sub-threshold-admission instead closes a require cycle:
 *
 *   gather-candidates -> sub-threshold-admission -> simple-rerank
 *                     -> modifier-constraints -> gather-candidates
 *
 * and `modifier-constraints.ts` reads `MODIFIER_SYNONYM_GROUPS` off a
 * gather-candidates that has not finished evaluating, so the const is
 * `undefined` and `extractModifierConstraints()` throws
 * "Cannot read properties of undefined (reading 'find')" at runtime. Typecheck
 * and lint both pass through that cycle; only the tests catch it. Keep this
 * file import-free.
 *
 * ## The value
 *
 * It is a constant on purpose. The abstention legs used to write the winning
 * candidate's RAW retrieval score, which is cross-source and unbounded
 * (computeOffScore median 6.900 on this population), so the clamp far below
 * turned it into a saturated 1.000 — a decision the reranker refused to make,
 * cached as maximally confident. Owner:
 * mobile:sync-docs/reports/2026-08-05_the-abstention-writes-a-laundered-confidence.md
 *
 * The value is pinned by four boundaries, not by taste:
 *   >= SUB_THRESHOLD_SAVE_FLOOR (0.75) — still offered to the cache at all.
 *    < SAVE_CONFIDENCE_THRESHOLD (0.85) — insertOnly: may create a row on a
 *      virgin key, may never displace an incumbent.
 *    < 0.80 — CONFIDENCE_LEVELS.high.min in the MOBILE repo's
 *      src/constants/nutrition.ts is 0.8 and the comparison is `>=`, so 0.80
 *      would still render the green "✓ Exact Match" badge and the user-visible
 *      half of the defect would be unfixed.
 *   >= 0.60 — logging.tsx suppresses its 'AI portion estimate' warning at
 *      >= 0.6, and the mapping-logger's ⚠️ flag fires below 0.7. Neither moves.
 * That leaves [0.75, 0.80). 0.78 sits off both edges.
 *
 * Those four boundaries are asserted by T1 in
 * `__tests__/sub-threshold-admission.test.ts`, which imports all three
 * constants from `sub-threshold-admission.ts` — that is the "one file" the
 * invariant is checkable in.
 *
 * Second-order property worth keeping: 0.78 + CROSS_SOURCE_DISPLACEMENT_MARGIN
 * = 0.83, which simpleRerank's exact_match (0.98) and clear_winner (0.95) clear
 * and a second abstention (0.78) does not — so two abstentions can never
 * ping-pong one cache key.
 */
export const RERANK_DECLINED_CONFIDENCE = 0.78;
