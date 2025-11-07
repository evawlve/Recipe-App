# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
  - Comprehensive parser documentation in `docs/parser.md`
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
  - `docs/parser.md` - Parser documentation
  - `CHANGELOG.md` - This file

- **Migrations**
  - `20251106113354_add_portion_overrides` - Added PortionOverride and UserPortionOverride tables
  - `20251106200643_sync_notification_recipe_schema` - Schema sync migration

## [Previous Releases]

Previous changes are not documented in this changelog.

