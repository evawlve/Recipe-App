# FatSecret Migration & Mapping Runbook (Condensed)

Last updated: 2025-11-24

## Current Snapshot
- Mapping uses FatSecret cache + live API; legacy tables still exist but new maps are FatSecret-only.
- Tests: `src/lib/fatsecret/__tests__/map-ingredient.test.ts` green.
- Coverage (latest): 69 ingredients total, 50 mapped (≈72%), 19 unmapped (prep/synonym gaps like mostaccioli, mustard, onions w/ volume, jalapeno, sauerkraut, Polish sausage, curry paste, low-sodium soy).
- Normalization rules live at `data/fatsecret/normalization-rules.json` (prep/size strips + synonym rewrites).
- Automap helpers: `scripts/auto-map-recipe.ts <id>`, `scripts/auto-map-all-recipes.ts`, coverage `scripts/fatsecret-coverage-report.ts`.

## What’s Wired In
- Cache schema, hydrate/verify, next-best fallback: if top FatSecret hit lacks weight/volume or nutrients, cache tries the next-best search result during hydration (`upsertFoodFromApi`).
- Mapping heuristics: weighted token score, multiplicative penalties (meat/canned/cook-state), trivial/exact-match skips AI rerank, AI rerank for ambiguous/close scores.
- AI normalize hints: on map, we call `ai-normalize` once per raw line (cached) to add synonyms/cleaned names to search expressions; mapping still works without AI if the call fails.
- Offline AI serving backfill exists:
  - Find gaps: `npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/fatsecret-cache-serving-gaps.ts`
  - Backfill via AI: `npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/fatsecret-cache-backfill-servings.ts` (uses `src/lib/ai/serving-estimator.ts`; inserts `FatSecretServingCache` rows with `source='ai'`).

## What’s Not Inline Yet
- AI serving backfill during mapping/hydration (currently only via the offline scripts).
- “Never fail” retry loop (deterministic → AI normalize retry → AI pick with lowered floor) – normalize hints are added, but we don’t yet retry pick with a lower floor after a no-map outcome.
- Serving fallback improvements for produce volume (e.g., onion cups) beyond the tiny-serving fallback.

## Commands (most-used)
- Automap all recipes:  
  `npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/auto-map-all-recipes.ts`
- Automap one:  
  `npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/auto-map-recipe.ts <recipeId>`
- Coverage:  
  `npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/fatsecret-coverage-report.ts`
- Cache verify:  
  `npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/fatsecret-cache-verify.ts --only-missing-nutrients`
- Serving gaps → AI backfill (offline):  
  ```
  npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/fatsecret-cache-serving-gaps.ts
  npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/fatsecret-cache-backfill-servings.ts
  ```
- Recipe import example:  
  `npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/fatsecret-recipe-import.ts --query="chicken sausage" --max-results=10 --author-id="<user-id>"`

## Gaps / Unmapped Themes
- Prep/synonym noise: mostaccioli, yellow mustard, Polish sausage, links 4/lb pork sausage, hot sauce, red curry paste, low-sodium soy, eggs beaten/extra eggs.
- Produce with volume units: onion (cup fractions), jalapeno, sauerkraut, apples, tomatoes.
- These should drop once AI normalize + retries and serving/volume fallback are in place, or after offline serving backfill.

## Next Steps (short)
Engineering:
1) Inline AI serving backfill during mapping hydration: if top/next-best lack usable weight/volume, call `requestAiServing`, validate, insert to cache, retry hydration (keep offline scripts for batch).
2) Add retry loop in `map-ingredient`: deterministic → AI normalize retry (done) → AI pick fallback with lowered floor; cap AI calls and log `final_no_match`.
3) Improve volume fallback for produce (onion/jalapeno/tomato cups) to avoid tiny-serving drops.
4) Rerun automap-all + coverage; review unmapped list and iterate rules/boosts.

On your side:
- Ensure DB/VPN + OPENAI_API_KEY + FatSecret creds are set when running automap/coverage/import.
- Run automap-all and coverage after logic/rule changes; share unmapped list if items persist.
- Use the offline serving backfill scripts when cache-level serving gaps are suspected, then rerun automap/coverage.
