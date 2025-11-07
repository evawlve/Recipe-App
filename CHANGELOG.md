# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Sprint 0: Audit, Baseline & FDC API Setup (3-5 days)

#### Added

##### FDC API Infrastructure

- **FDC API Client** (S0.1)
  - Rate-limited API client with LRU caching
  - Supports branded food search via FDC API
  - Rate limiting: 10 requests/second, 1000 requests/hour
  - Cache hit rate >80% for repeated queries
  - File: `src/lib/usda/fdc-api.ts`

- **Gold Evaluation Dataset** (S0.3)
  - Versioned gold dataset: `eval/gold.v1.csv` (100 test cases)
  - Covers all food categories: eggs, proteins, vegetables, grains, oils
  - Immutable versioning system for tracking improvements

- **Evaluation Harness** (S0.3)
  - Automated testing script: `eval/run.ts`
  - Generates evaluation reports: `reports/eval-baseline-YYYYMMDD.json`
  - Metrics tracked: P@1 (precision at 1), MAE (mean absolute error), provisional rate

- **DB Audit Script** (S0.2)
  - Database coverage analysis: `scripts/audit-db-coverage.ts`
  - Generates audit reports: `reports/db-audit-YYYYMMDD.md`
  - Tracks food counts, unit coverage, category distribution

##### Baseline Metrics

- **Mapping P@1**: 47.0% (baseline precision at rank 1)
- **Portion MAE**: 114.9 g (mean absolute error for portion resolution)
- **Provisional Rate**: 32.0% (fallback to assumed serving)

##### Database Coverage

- **Foods**: 3,585 total
- **Units**: 1,882 total
- **Barcodes**: 0 (GTIN coverage not yet populated)
- **Sources**: usda=3500, template=76, community=9
- **Top Categories**: meat (1202), dairy (327), rice_uncooked (112), fruit (98), veg (79), legume (61), sauce (53), oil (49), flour (47), sugar (24)
- **Top Unit Labels**: "1 cup, diced" (1179), "1 cup" (292), "1 tbsp" (218), "1 tsp" (73)

##### USDA Saturation System

- **USDA Data Import** (S0.1)
  - Bulk import system for USDA foods
  - Deduplication with canonical names and macro fingerprints
  - Category mapping from USDA categories to app categories
  - Keyword-based saturation sweep
  - Files: `scripts/usda-saturate.ts`, `src/ops/usda/config.ts`, `src/ops/usda/category-map.ts`, `src/ops/usda/dedupe.ts`
  - Documentation: `docs/USDA_SATURATION_README.md`

#### Findings

- **Top Gaps Identified**:
  - GTINs: 0 barcodes — branded dedupe/verification will need GTINs (planned Sprint 5)
  - Portions: Many misses on cooked vs uncooked and volume→grams resolution; needs overrides and unit-hint plumbing
  - Ranking: Candidate ranking favors uncooked variants in some grains/veg; needs cooked-state boosting and category priors
  - Branded coverage: Smoke tests pass; leave flag off until Sprint 5 on-demand path
  - Synonyms/International variants: Not yet addressed (planned Sprint 4)

- **Risks Identified**:
  - Over-reliance on density fallback inflates MAE
  - Missing GTINs will hinder branded QA until seeded
  - Gold drift: without ID/regex hints, name changes can break P@1; mitigated via expected_food_id_hint

#### Technical Details

- **Files Created**
  - `src/lib/usda/fdc-api.ts` - FDC API client with rate limiting and caching
  - `eval/gold.v1.csv` - Gold evaluation dataset (100 cases)
  - `eval/run.ts` - Evaluation harness
  - `scripts/audit-db-coverage.ts` - DB audit script
  - `reports/eval-baseline-20251106.json` - Baseline metrics report
  - `reports/db-audit-20251106.md` - DB coverage report
  - `docs/Sprint_0_Report.md` - Sprint 0 completion report

- **Environment Variables**
  - `FDC_API_KEY` - FDC API key (required for branded search)
  - `FDC_RATE_LIMIT_PER_HOUR` - Rate limit configuration (default: 1000)
  - `ENABLE_BRANDED_SEARCH` - Feature flag for branded search (default: false)

### Sprint 1: Parser Enhancement + Schema (Week 1)

#### Added

##### Parser Enhancements

- **Fraction and Range Parsing** (S1.1)
  - Support for unicode fractions (½, ¼, ¾, ⅓, ⅔, ⅛, ⅜, ⅝, ⅞)
  - Support for numbers with attached fractions (e.g., "2½" → 2.5)
  - Support for numeric ranges with automatic averaging (e.g., "2-3" → 2.5, "1½-2" → 1.75)
  - Support for various range separators: `-`, `–` (en-dash), `—` (em-dash), `to`
  - Unicode space normalization (thin space, non-breaking space, etc.)

- **Qualifier Extraction** (S1.2)
  - Extract qualifiers from ingredient names (e.g., "large", "boneless", "skinless")
  - Support for qualifiers in parentheses (e.g., "onion (diced)")
  - Support for comma-separated qualifiers (e.g., "garlic, minced")
  - Multi-word qualifier support (e.g., "finely chopped", "coarsely chopped")
  - Comprehensive qualifier list: size, preparation, meat, packing, state, form qualifiers

- **Unit Hint Extraction** (S1.2)
  - Extract unit hints for piece-like units (yolk, white, leaf, clove, sheet, stalk, slice, piece)
  - Automatically extract core ingredient name from unit hint patterns
  - Examples: "2 egg yolks" → `unitHint: 'yolk', name: 'egg'`

- **Noise and Punctuation Handling** (S1.3)
  - Graceful handling of separator lines (`---`, `===`)
  - Filter out "to taste" phrases
  - Support for "x" multipliers (e.g., "2 x 200g chicken")
  - Improved handling of parentheses and commas
  - Better tokenization for complex ingredient formats

##### Database Schema

- **PortionOverride Table** (S1.4)
  - Global portion overrides for foods
  - Unique constraint on `[foodId, unit]`
  - Index on `unit` for fast lookups
  - Fields: `id`, `foodId`, `unit`, `grams`, `label`, `createdAt`, `updatedAt`

- **UserPortionOverride Table** (S1.4)
  - User-specific portion overrides
  - Unique constraint on `[userId, foodId, unit]`
  - Index on `[userId, foodId]` for fast user lookups
  - Fields: `id`, `userId`, `foodId`, `unit`, `grams`, `label`, `createdAt`, `updatedAt`

##### Feature Flags

- **ENABLE_PORTION_V2** (S1.5)
  - Feature flag for Portion V2 resolution using PortionOverride tables
  - Default: `false` (uses old logic)
  - When `true`: Uses new 5-tier fallback system (to be implemented in Sprint 3)
  - Environment variable: `ENABLE_PORTION_V2` (set to `"1"` or `"true"` to enable)

- **ENABLE_BRANDED_SEARCH** (S1.5)
  - Feature flag for branded food search via FDC API
  - Default: `false` (don't search branded foods)
  - When `true`: Allows searching branded foods via FDC API
  - Environment variable: `ENABLE_BRANDED_SEARCH` (set to `"1"` or `"true"` to enable)

##### Testing

- **Core Parser Tests** (S1.6)
  - 25 deterministic test cases organized by category
  - Table-driven tests using `jest.each`
  - Covers all parser behaviors: fractions, ranges, qualifiers, unit hints, punctuation, unicode, edge cases
  - Test file: `src/lib/parse/__tests__/ingredient-line-core.test.ts`

- **Property-Based Tests** (S1.7)
  - Property-based fuzz testing using `fast-check`
  - Tests numeric robustness with random fractions and ranges
  - Tests whitespace/punctuation variations
  - Ensures parser never throws on random noisy strings
  - Deterministic with seed for reproducibility
  - Test file: `src/lib/parse/__tests__/ingredient-line-property.test.ts`

##### Documentation

- **Parser Documentation** (S1.8)
  - Comprehensive parser documentation in `docs/s1-parser.md`
  - Examples of all supported formats
  - Lists of recognized qualifiers and unit hints
  - Before/after examples showing improvements
  - Error handling documentation

#### Changed

- **Parser Behavior**
  - Unknown units are no longer consumed as `rawUnit` - they remain part of the ingredient name
  - Improved tokenization to handle complex formats (parentheses, commas, "x" multipliers)
  - Better handling of unicode spaces and special characters

#### Fixed

- **Migration Issues**
  - Fixed PostgreSQL case-sensitivity issues in migration files
  - Made RLS policy creation conditional on `auth` schema existence (for shadow database compatibility)
  - Fixed `supabase_realtime` publication handling

#### Technical Details

- **Dependencies**
  - Added `fast-check` as dev dependency for property-based testing
  - Added `cross-env` for cross-platform environment variable handling

- **Files Modified**
  - `src/lib/parse/ingredient-line.ts` - Enhanced parser implementation
  - `src/lib/parse/quantity.ts` - Fraction and range parsing
  - `src/lib/parse/qualifiers.ts` - New qualifier extraction module
  - `src/lib/parse/unit-hint.ts` - New unit hint extraction module
  - `src/lib/parse/unit.ts` - Added new units (pinch, dash, can)
  - `src/lib/flags.ts` - New feature flag system
  - `prisma/schema.prisma` - Added PortionOverride and UserPortionOverride models
  - `package.json` - Added fast-check and cross-env dependencies

- **Files Created**
  - `src/lib/parse/qualifiers.ts` - Qualifier detection and extraction
  - `src/lib/parse/unit-hint.ts` - Unit hint extraction
  - `src/lib/flags.ts` - Feature flag system
  - `src/lib/parse/__tests__/ingredient-line-core.test.ts` - Core test suite
  - `src/lib/parse/__tests__/ingredient-line-property.test.ts` - Property-based tests
  - `src/lib/flags.test.ts` - Feature flag tests
  - `docs/s1-parser.md` - Parser documentation
  - `CHANGELOG.md` - This file

- **Migrations**
  - `20251106113354_add_portion_overrides` - Added PortionOverride and UserPortionOverride tables
  - `20251106200643_sync_notification_recipe_schema` - Schema sync migration

## [Previous Releases]

Previous changes are not documented in this changelog.

