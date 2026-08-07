/**
 * Jest gate: a test may never write mapping-analysis files into `logs/`.
 *
 * WHY THIS FILE EXISTS
 * Every `logMappingAnalysis()` call site sits behind
 * `if (ENABLE_MAPPING_ANALYSIS)` in src/lib/mapping/map-ingredient-with-fallback.ts,
 * and that gate is a module-scope const:
 * `process.env.ENABLE_MAPPING_ANALYSIS === 'true'`, captured at import time. The
 * same flag guards the `logs/ai-parse-events.jsonl` appendFileSync in the same
 * file. On a dev Mac the mapper chain's `import 'dotenv/config'` loads a `.env`
 * that sets ENABLE_MAPPING_ANALYSIS=true, so any suite that drives the mapper far
 * enough to select a candidate writes real `logs/mapping-analysis-*.json` +
 * `logs/mapping-summary-*.txt` files — the same namespace the box's decision
 * corpora live in (109 sessions / 57,699 decisions), which analysis tooling globs.
 *
 * MEASURED 2026-08-07 on master @1b9089c (fresh worktree, no `.env`):
 * `ENABLE_MAPPING_ANALYSIS=true npm run test:ci` wrote 6 files (3 analysis JSON +
 * 3 summary txt; the filename timestamp has 1 s resolution, so parallel workers
 * collapse into shared files). Running the unmocked mapper suites one at a time
 * attributed the writes to NINE suites — enumerated in PR
 * test/jest-mapping-logger-leak. The seven stage-1c producer-*.test.ts suites
 * already `jest.mock('../mapping-logger')` and were never the leak.
 *
 * WHY `setupFiles` AND NOT `setupFilesAfterEnv`
 * Same reason as jest.setup.no-llm.js: the gate is frozen into a module-scope
 * const at import time, so the pin must land before the first import of the
 * mapper chain. `setupFiles` runs before the test file is loaded.
 *
 * WHY THIS ASSIGNS 'false' AND MUST NEVER `delete`
 * dotenv writes a key only when the property does not already exist on
 * process.env (see jest.setup.no-llm.js for the full mechanism). Assigning
 * 'false' creates the property, so the later `import 'dotenv/config'` cannot put
 * the dev machine's `true` back. `delete process.env.ENABLE_MAPPING_ANALYSIS`
 * would hand dotenv permission to do exactly that. The assignment also
 * deliberately overrides an explicit `ENABLE_MAPPING_ANALYSIS=true` on the jest
 * command line: no jest run may write into `logs/`.
 *
 * A test that needs the analysis writes' *behaviour* mocks the module instead —
 * `jest.mock('../mapping-logger')`, the stage-1c producer-*.test.ts pattern.
 *
 * The invariant is asserted by
 * src/lib/mapping/__tests__/no-mapping-analysis-writes.test.ts, which loads
 * `dotenv/config` itself and requires the flag to still read 'false', and pins
 * this file into BOTH jest projects' `setupFiles` (a component test can import
 * the mapper chain transitively, same as the no-llm gate).
 */
process.env.ENABLE_MAPPING_ANALYSIS = 'false';
