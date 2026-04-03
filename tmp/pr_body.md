**Part of Milestone: S2 – FatSecret Integration & AI Mapping Pipeline**

## Summary

Resolves systemic testing database leakage isolation issues where the test suite was hitting the live dev database. Reinstates the `UNIT_MAX_GRAMS_PER_UNIT` universal serving sanity guard to clamp implausible weights and prevent nutritional "ghost" records. Fixes a functional bug in `deriveMustHaveTokens` by ensuring all search string inputs are piped through `cleanIngredientName()` prior to tokenization, preventing strict qualifier lockouts.

## Change Type

- [x] `feat/mapping` - Core pipeline feature or logic change
- [ ] `data/normalization` - Cleanup rules, synonyms, or category mappings added
- [x] `fix` - Bug fix (e.g., serving resolution, ranking failure)
- [ ] `refactor` - Code refactoring
- [ ] `perf` - Performance improvement
- [ ] `chore/docs` - Documentation or logs maintenance
- [x] `tooling/ci` - Build, CI, or debug scripts

## Scope

- [x] Mapping Logic / Fallbacks
- [ ] Normalization Rules (`normalization-rules.json`)
- [ ] FatSecret API / Caching
- [ ] FDC API Integration
- [x] Serving Resolution & Guards
- [ ] Debug/Extraction Scripts
- [ ] Schema/Migrations

## Validation (must pass locally or via CI artifacts)

- [x] **Pilot Import**: `npx tsx scripts/pilot-batch-import.ts --recipes 200`
  - [x] Target: 99%+ accuracy with ZERO unmapped active ingredients
  - [x] Attach `logs/mapping-summary-*.txt` snippet indicating successful run
- [x] **Debug Output**: `npx tsx src/scripts/debug-ingredient.ts "INGREDIENT"`
  - [x] Verify candidate selection, cache behavior, and fallback logic
- [x] **Test isolation**: `npm test src/lib/fatsecret/__tests__/map-ingredient.test.ts`
  - [x] Test suite executes quickly and does NOT hit the live DB (`jest.spyOn()` used)
- [x] **Linter/Typecheck**: `npm run lint && npm run typecheck`
- [x] **Feature flags respected**: no behavior change unless the flag is enabled
  - `ENABLE_MAPPING_ANALYSIS`: [x] N/A ☐ Verified

## Metrics & Telemetry

- [x] New logs/events appropriately categorized in `mapping-logger.ts` or debug streams
- [x] **No secrets in logs** (e.g. OpenRouter API keys, FatSecret secrets)

## Risk & Rollback

**Risk level**: [x] Low ☐ Medium ☐ High

**Rollback plan**: 
- [ ] Clear ingredient cache (`npx tsx src/scripts/check-cache-entry.ts "ingredient" --clear`)
- [x] Revert commit
- [ ] Deploy previous image

## Docs & Changelog

- [x] Updated `CHANGELOG.md`
- [ ] Logged fix in `.agent/docs/mapping-fix-log.md`
- [ ] Documented system quirks in `.agent/docs/known-issues.md`
- [ ] Updated `.env.example` (if new environment variable keys introduced)

## Screenshots / Output

```
✅ No recipes with unmapped ingredients found!
```
