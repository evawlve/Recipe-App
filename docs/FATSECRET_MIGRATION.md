# FatSecret Cache Migration Plan

## Overview

We are replacing the legacy food tables (`Food`, `FoodUnit`, `FoodAlias`, `PortionOverride`, `FoodServingOverride`) with a FatSecret-backed cache system. This migration will replace the existing food database structure with data sourced from the FatSecret API.

**Important**: All existing food data will be reseeded from FatSecret, so any existing references in the legacy tables will be replaced.

## Phase 0 - Preparation (Complete)

This phase focuses on:
1. Database backups
2. Documentation updates
3. Reset script preparation

**No schema changes** are made in this phase.

## Database Backup

### Before Migration

**CRITICAL**: Create a full backup of the food tables before proceeding with any schema changes.

### Backup Commands

#### Option 1: Full Database Backup (Recommended)

```bash
# Using pg_dump (PostgreSQL native tool)
pg_dump -h <host> -U <username> -d <database_name> \
  --schema=public \
  --format=custom \
  --file=backup_food_tables_$(date +%Y%m%d_%H%M%S).dump

# Example for Supabase:
pg_dump -h db.xxxxx.supabase.co -U postgres -d postgres \
  --schema=public \
  --format=custom \
  --file=backup_pre_fatsecret_$(date +%Y%m%d_%H%M%S).dump
```

#### Option 2: Food Tables Only

```bash
# Backup only the food-related tables
pg_dump -h <host> -U <username> -d <database_name> \
  -t "Food" \
  -t "FoodUnit" \
  -t "FoodAlias" \
  -t "Barcode" \
  -t "PortionOverride" \
  -t "UserPortionOverride" \
  -t "IngredientFoodMap" \
  --format=custom \
  --file=backup_food_tables_only_$(date +%Y%m%d_%H%M%S).dump
```

#### Option 3: Using Supabase Dashboard

1. Go to Supabase Dashboard → Database → Backups
2. Create a manual backup
3. Note the backup timestamp and location

### Restore from Backup

If you need to restore:

```bash
# Restore full database
pg_restore -h <host> -U <username> -d <database_name> \
  --clean \
  --if-exists \
  backup_pre_fatsecret_YYYYMMDD_HHMMSS.dump

# Restore specific tables only
pg_restore -h <host> -U <username> -d <database_name> \
  --table="Food" \
  --table="FoodUnit" \
  --table="FoodAlias" \
  backup_food_tables_only_YYYYMMDD_HHMMSS.dump
```

### Backup Verification

After creating a backup, verify it:

```bash
# List contents of backup
pg_restore --list backup_pre_fatsecret_YYYYMMDD_HHMMSS.dump | grep -E "(Food|FoodUnit|FoodAlias|PortionOverride)"

# Verify table counts (before and after)
psql -h <host> -U <username> -d <database_name> -c "
  SELECT 
    'Food' as table_name, COUNT(*) as count FROM \"Food\"
  UNION ALL
  SELECT 'FoodUnit', COUNT(*) FROM \"FoodUnit\"
  UNION ALL
  SELECT 'FoodAlias', COUNT(*) FROM \"FoodAlias\"
  UNION ALL
  SELECT 'PortionOverride', COUNT(*) FROM \"PortionOverride\"
  UNION ALL
  SELECT 'UserPortionOverride', COUNT(*) FROM \"UserPortionOverride\"
  UNION ALL
  SELECT 'IngredientFoodMap', COUNT(*) FROM \"IngredientFoodMap\";
"
```

### Backup Storage

**Recommended locations**:
- Local development: `backups/` directory (add to `.gitignore`)
- Production: Supabase automated backups + manual snapshot
- CI/CD: Store in secure storage (S3, encrypted volume, etc.)

**Document your backup**:
- Location: `_______________________`
- Timestamp: `_______________________`
- Size: `_______________________`
- Verified: `[ ] Yes  [ ] No`

> Supabase free tier note: manual dashboard backups aren’t available. When you apply the Phase 1 migration on Supabase, record the `_prisma_migrations` entry instead (e.g., `20250206120000_add_fatsecret_cache` finished at `2025-11-15T04:32:11Z`) so we still have an auditable timestamp for the pre-cache snapshot. For local/paid tiers keep using `pg_dump` as described above.

## Reset Script

See `scripts/reset-food-db.ts` for the script to truncate old food tables.

**⚠️ WARNING**: Only run this script **AFTER** the FatSecret cache schema is in place and verified to be working.

## Migration Phases
- **Phase 0** (Current): Backups, documentation, reset script prep
- **Phase 1**: Add FatSecret cache schema (upcoming)
- **Phase 2**: Data migration and reseeding
- **Phase 3**: Switch application to use cache
- **Phase 4**: Cleanup old tables (run reset script)
Detailed guidance for Phases 1-4 is outlined below.
## Phase 1 – Cache Schema & Ingestion Scaffolding (Current Phase)
**Goal:** Introduce a FatSecret-specific cache that can persist foods, servings, and density metadata without touching the legacy `Food*` tables yet.
### Schema work
- Add Prisma models (names can be tweaked during implementation) that live alongside the legacy tables:
  - `FatSecretFoodCache`: `fatsecretId` (PK), `name`, `brandName`, `foodType`, `country`, `description`, `defaultServingId`, `nutrientsPer100g` JSONB, `confidence`, `source` (search/barcode/nlp/manual), `syncedAt`, `expiresAt`, `hash`.
  - `FatSecretServingCache`: `id` (FatSecret serving id or deterministic slug), `foodId`, `measurementDescription`, `numberOfUnits`, `metricServingAmount`, `metricServingUnit`, `servingWeightGrams`, `volumeMl`, `isVolume`, `isDefault`, `derivedViaDensity` + FK to density row used.
  - `FatSecretFoodAlias`: `foodId`, `alias`, `locale`, `source` (FatSecret-provided vs. derived from our `FoodAlias` history).
  - `FatSecretDensityEstimate`: `foodId`, `densityGml`, `source` (`fatsecret_serving`, `legacy_unit`, `ai`, `manual`), `confidence`, `notes`.
  - `FatSecretCacheSyncRun`: per-ingestion job log with `id`, `status`, `startedAt`, `finishedAt`, `error`.
- Update `scripts/reset-food-db.ts` once these tables exist so the safety check looks for `FatSecretFoodCache` instead of the placeholder LIKE query.
### Application code/infrastructure
- Create a cache service in `src/lib/fatsecret/` (e.g., `cache.ts`) that exposes `upsertFoodFromApi`, `getFoodFromCache`, `hydrateServings`, and `markStale`.
- CLI utilities:
  - `npm run fatsecret:cache:hydrate -- --food-id=<id>` for one-off fetches.
  - `npm run fatsecret:cache:queue -- --from=ingredient-mappings` to enqueue foods referenced by `IngredientFoodMap`.
  - `npm run fatsecret:cache:verify` to check for missing macros or servings.
- Extend `.env.example` with cache-specific knobs:
  - `FATSECRET_CACHE_MAX_AGE_MINUTES`
  - `FATSECRET_CACHE_SYNC_BATCH_SIZE`
  - `FATSECRET_CACHE_DENSITY_AI_ENDPOINT` (optional, to integrate AI scoring later).
### Density + serving normalization strategy
- Store every FatSecret serving verbatim in `FatSecretServingCache`.
- When FatSecret omits volume servings but weight and `densityGml` exist, derive `volumeMl = grams / densityGml` and flag `derivedViaDensity=true`.
- When volume only servings exist, compute `densityGml = grams / volumeMl` and insert/update `FatSecretDensityEstimate` with `source='fatsecret_serving'`.
- For foods that lack both, leave density null but flag them in the sync log so Phase 2 can either use legacy `FoodUnit` data or AI guesses.
### Validation/exit criteria
- `prisma migrate dev` adds the new tables with indexes (fatsecret id, alias lookups, `syncedAt` for TTL sweeps).
- Smoke test script proves we can fetch 1–2 foods from the API, cache them, and re-read without API calls.
- Reset script refuses to run because cache tables exist (ensures Phase 0 safeguard holds).
- Documentation: update this file with the migration command (done here) and describe how to run hydrate commands.
## Phase 2 – Data Migration & Reseeding
**Goal:** Populate the cache tables with real data, establish density coverage, and prep reseeding artifacts while the application still reads from the legacy tables.
### Data ingestion plan
- Seed priority foods:
  1. Current `IngredientFoodMap` references grouped by frequency.
  2. Foods with many `FoodAlias` entries (popular searches).
  3. Barcode-backed foods (use `scripts/fatsecret-barcode-smoke.ts` to verify lookups).
- Pre-warm the cache with curated/gold/staples lists:
  1. Copy the manifest templates in `data/fatsecret/bootstrap/*.sample.jsonl` to `gold.jsonl`, `curated.jsonl`, and `staples.jsonl`.
  2. You can auto-build the `gold.jsonl` / `curated.jsonl` files by running `npm run fatsecret:cache:manifest -- --gold --curated`. This script reads `eval/gold.v3.csv` + all `data/curated/*.csv`, maps each item via FatSecret, and writes JSONL entries (use `--dry-run`, `--gold-limit`, or `--curated-limit` if you want a subset first). For staples without deterministic data, duplicate `staples.sample.jsonl` and fill it manually. On Windows shells that eat `--foo` flags, either prefix the command with PowerShell’s `--%` stop-parsing token or bypass `npm run` entirely, e.g. `npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/fatsecret-cache-build-manifest.ts --gold --gold-file=eval/gold.high_usage.csv`.
  3. Run `npm run fatsecret:cache:bootstrap -- --preset=gold --preset=curated --preset=staples` to hydrate every manifest in one pass. Use `--file=<path>` for any additional JSONL list you create.
     - Same Windows note: either use `--%` (e.g., `npm run fatsecret:cache:bootstrap --% --file=data/fatsecret/bootstrap/gold.high_usage.jsonl`) or run the script directly via `npx ts-node ...scripts/fatsecret-cache-bootstrap.ts --file=...` so your custom manifest paths make it through.
   4. The bootstrap script is just sugar on top of `fatsecret:cache:hydrate`; if you prefer raw queues, export newline-delimited FatSecret IDs and run `npm run fatsecret:cache:hydrate -- --file=<list>` for each list.
     - Batch hydrator should request ~50 foods per run, respect FatSecret rate limits via exponential backoff, and persist sync metadata (`FatSecretCacheSyncRun`). For one-off runs or “hydrate everything again”, use `npx ts-node …scripts/fatsecret-cache-bootstrap.ts --preset=gold --preset=curated --preset=staples --file=data/fatsecret/bootstrap/gold.high_usage.jsonl`.
- For each cached food, compute:
  - Canonical nutrition per 100g (FatSecret already provides macros per serving—normalize them to 100g for parity with `Food`).
  - Derived `FatSecretFoodAlias` rows from both FatSecret data and our historical alias table to keep search quality once we swap over.
### Density coverage
- Backfill `FatSecretDensityEstimate` using existing `Food.densityGml` (where available) so we don’t lose curated values.
- When a FatSecret food lacks density, run `npm run calc:density` (or similar) against legacy `FoodUnit` rows to produce derived density, then copy the result into `FatSecretDensityEstimate` with `source='legacy_unit'`.
- For the remaining gaps, integrate AI/manual review:
  - Export unresolved foods to `data/fatsecret/density_review.csv`.
  - Optional: call an internal AI endpoint (configured through `FATSECRET_CACHE_DENSITY_AI_ENDPOINT`) to propose density and reason text; store proposals with `<0.7` confidence for manual vetting.
### Reseeding artifacts
- Generate a deterministic export (e.g., `data/fatsecret/cache-seed.json`) that mirrors the final `FatSecretFoodCache` state. This becomes the source of truth when reseeding `Food` in Phase 3.
- Create migration scripts to:
  - Insert new cache IDs into `IngredientFoodMap` (temporary columns `fatsecretFoodId` + `fatsecretServingId`).
  - Stage new `FoodUnit` data from `FatSecretServingCache` so we can rebuild portion pickers instantly once we cut over.
- Validation checklist:
  - Coverage metrics for key recipes (≥95% of `IngredientFoodMap` rows now have `fatsecretFoodId`).
  - Density coverage: ≥90% of foods with at least one volume-based serving; remaining items logged for AI/manual follow-up.

### Cache verification & density backfill
1. After every bootstrap/queue run, execute `npm run fatsecret:cache:verify -- --missing-servings` to flag stale entries, missing nutrients, or foods without serving rows.
2. Export the flagged IDs to `data/fatsecret/density_review.csv` (append if you already have this file in flight).
3. For foods that still lack volume servings, run `npm run calc:density -- --food-id=<legacyFoodId>` to pull density from the curated `FoodUnit` catalog, then insert the value via `FatSecretDensityEstimate` with `source='legacy_unit'`. The hydrate logic automatically links the density row when you re-run `fatsecret:cache:hydrate` for that food.
4. Once densities exist, re-run `npm run fatsecret:cache:verify -- --missing-servings` to ensure `volumeMl` + `derivedViaDensity=true` servings were created.
5. Missing-serving remediation (Phase 2+): introduce two new CLIs:
   - `npm run fatsecret:cache:serving-gaps` → emits foods that lack convertible volume or weight servings (saves to `data/fatsecret/serving_gaps.jsonl`).
   - `npm run fatsecret:cache:backfill-servings -- --input=data/fatsecret/serving_gaps.jsonl` → per-food fallback pipeline:
     1. **Legacy density**: copy grams↔volume pairs from curated `FoodUnit` rows where available and insert `FatSecretDensityEstimate` with `source='legacy_unit'`.
     2. **Manual heuristics**: look up staple conversions in `data/fatsecret/manual-density.json`, tag them with `source='manual'`.
     3. **AI fallback** (guarded by `ENABLE_FATSECRET_AI_SERVINGS` + `OPENAI_API_KEY`):
        - Call GPT‑5 nano/mini (configurable via `FATSECRET_CACHE_AI_MODEL`) with a structured prompt tailored to the missing type:
          * Missing volume → “return one convertible volume serving (cup/tbsp/tsp/ml/fl oz) and its weight in grams”.
          * Missing weight → “return one weight serving (grams/ounces)”.
        - Require JSON response with `{ servingLabel, volumeUnit?, volumeAmount?, grams, confidence (0‑1), rationale }` or `{ error: 'no convertible serving' }`.
        - Apply safety gates: reject confidence <0.6 (tunable via `FATSECRET_CACHE_AI_CONFIDENCE_MIN`), density outside ~0.05–5 g/ml (override per category), or calorie estimates outside plausible ranges.
        - Accepted entries are persisted as new `FatSecretDensityEstimate`/`FatSecretServingCache` rows (`source='ai'`, `confidence`, `aiNote=rationale`), then rehydrated via `upsertFoodFromApi`.
     4. Foods the AI cannot solve are appended to `data/fatsecret/manual-review.csv` for human follow-up.
   - Extend `FatSecretServingCache` metadata with optional `source`, `confidence`, and `note` columns so the admin UI can badge AI/manual estimates while end users only “select” servings; they never mutate the cache definitions. This keeps recipe inputs constrained to canonical servings (FatSecret, curated, AI-derived) while maintaining auditability.

   (Here’s a plan that layers detection, heuristics, and AI estimation so every cached food ends up with at least one weight and one convertible volume serving:

1. Gap Detection

Add a new script (fatsecret-cache:serving-gaps) that queries FatSecretFoodCache + FatSecretServingCache and emits CSV/JSON of foods missing weight or volume servings (missingVolume = no serving with isVolume=true; missingWeight = all servings lack servingWeightGrams).
Include category info (from Food/curated metadata) so we know which heuristics apply later. Persist the list to data/fatsecret/serving_gaps.jsonl and feed it into downstream scripts.
2. Fallback Pipeline (in a new CLI, e.g., fatsecret:cache:backfill-servings)
For each food in the gap file:

Legacy density: If the food has a legacy FoodUnit entry (curated packs, USDA imports), copy its grams↔volume pair into a new FatSecretDensityEstimate row with source='legacy_unit', then re-run upsertFoodFromApi for that food to synthesize the missing serving.
Heuristic table: If we’ve curated density data for staples (salt, sugar, nut butters, etc.), look them up in data/fatsecret/manual-density.json and insert the density/serving with source='manual'.
AI fallback: Only if the first two steps fail:
Call GPT‑5 nano/mini via a helper (src/lib/ai/serving-estimator.ts) with a prompt tailored to the missing type:
• Missing volume → “Provide one conventional volume serving (cup/tbsp/tsp/ml/fl oz) and the weight in grams.”
• Missing weight → “Provide one conventional weight serving (g/oz) and its description.”
Include instructions to return JSON ({ servingLabel, volumeUnit?, volumeAmount?, grams, confidence (0-1), rationale }) or { error: "no convertible serving" }.
Plug the food name, category, existing FatSecret servings, and any curated density hints into the prompt for maximum context.
Parse the response; clamp to global sanity bounds (density between ~0.05 and 5 g/ml, grams within 1–2000).
Require confidence >= 0.6 (configurable); reject anything lower or with an error.
Insert the serving/density with source='ai', confidence, and aiNote=rationale, then call upsertFoodFromApi (or insert a synthetic FatSecretServingCache row) so it shows up like any other serving.
3. Cache + UI Metadata

Extend FatSecretServingCache and/or FatSecretDensityEstimate with optional metadata fields (confidence, source, note). Prisma migration updates model + columns.
The admin UI highlights source='ai' entries (badge “AI estimate”) and allows staff to replace them with manual data. Normal recipe authors just see another serving option—they can’t edit the cache.
4. Configuration & Environment

Add .env entries: OPENAI_API_KEY, FATSECRET_CACHE_AI_MODEL (default gpt-5-nano), FATSECRET_CACHE_AI_CONFIDENCE_MIN, FATSECRET_CACHE_AI_MAX_DENSITY, etc.
Expose a feature flag (ENABLE_FATSECRET_AI_SERVINGS) so we can disable AI in certain environments.
5. Logging & Audit

Every AI call logs the prompt, response, confidence, and whether it was accepted or rejected.
Persist accepted AI servings to data/fatsecret/ai-servings.log for later review.
If the AI returns error, append the food ID to data/fatsecret/manual-review.csv.
6. Validation & Hooks

Update fatsecret:cache:verify to include new checks: warn if nutrientsPer100g is missing and now also if missingVolume or missingWeight is still true after backfill.
Optionally wire the backfill script into CI or a cron job so new foods always get volume/weight coverage shortly after hydration.
Once these pieces are in place, we can run:

npm run fatsecret:cache:serving-gaps > data/fatsecret/serving_gaps.jsonl
npm run fatsecret:cache:backfill-servings -- --input=data/fatsecret/serving_gaps.jsonl
npm run fatsecret:cache:verify -- --missing-servings)

Recent automation notes:
 - `scripts/fatsecret-cache-verify.ts` now accepts `--output-file=<path>`, so we run `npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/fatsecret-cache-verify.ts --only-missing-nutrients --output-file=data/fatsecret/hydrate_missing.txt` to produce a hydrate queue (empty when per-100 g data is complete).
 - `npm run fatsecret:cache:serving-gaps` writes two JSONL files (`data/fatsecret/serving_gaps.weight.jsonl`, `data/fatsecret/serving_gaps.volume.jsonl`) that list foods missing weight or volume coverage; these feed into the backfill CLI.


## Phase 3 – Switch Application to FatSecret Cache
**Goal:** Feature-flagged rollout that makes the API/UI read from `FatSecret*` tables while keeping the legacy tables in read-only mode for rollbacks.
### Code changes
- Introduce a flag (e.g., `FATSECRET_CACHE_MODE=shadow|dual|primary`) read by:
  - `src/lib/search/food-search.ts` (or equivalent) so the food search endpoint can fetch from cache first, fallback to legacy if needed.
  - `src/lib/fatsecret/map-ingredient.ts` so ingredient parsing uses cached foods/servings (no live API call during recipe creation).
  - Nutrition calculators so macros reference `FatSecretFoodCache.nutrientsPer100g`.
- Build a dual-read strategy:
  - In `shadow` mode, read from both data sources, compare payloads, and emit telemetry if differences exceed a threshold.
  - In `dual` mode, serve cache responses but keep writing to both caches + legacy tables to avoid drift.
  - In `primary` mode, legacy tables become read-only (no writes except via reset script).
### Serving + density UX
- Rebuild the serving picker UI to consume `FatSecretServingCache` (both weight and derived volume servings). Highlight derived servings when they originate from density estimates so QA can verify them quickly.
- When neither FatSecret nor density heuristics produce a volume serving, surface AI/manual suggestions in the admin panel for quick edits.
### Observability & QA
- Add metrics/logging for cache hit rate, hydration latency, AI density overrides, and mismatches vs. legacy macros.
- Regression tests:
  - Extend existing Jest tests under `src/lib/fatsecret/__tests__/` to cover cache fallback logic.
  - Snapshot a handful of recipe nutrition calculations before/after enabling the feature flag.
- Exit criteria:
  - All production recipes render correctly with cache-only data.
  - `IngredientFoodMap` rows no longer read legacy `Food` IDs in runtime queries.
## Phase 4 – Cleanup & Legacy Table Removal
**Goal:** Remove obsolete tables/code once the cache is stable in production.
### Steps
- Run `npm run reset:food-db -- --confirm` (after confirming the cache tables have been live for a full release cycle and backups exist).
- Prisma migration:
  - Drop `Food`, `FoodUnit`, `FoodAlias`, `PortionOverride`, `UserPortionOverride`, `Barcode`, `IngredientFoodMap.foodId` (legacy FK) columns that are no longer needed.
  - Rename `IngredientFoodMap.fatsecretFoodId` → `foodId` for clarity.
- Delete scripts/utilities that only applied to the USDA/legacy flow (`usda:*`, density calculation helpers that hit `FoodUnit`, etc.) or mark them deprecated if they’re still useful for cache maintenance.
- Update documentation:
  - README “Food Database & Search” should state “FatSecret cache live”.
  - `.env.example` removes references to legacy tables and highlights the cache env vars.
- Archive or delete backup files produced in Phase 0 once retention requirements are satisfied.
### Validation
- `prisma migrate deploy` succeeds on all environments.
- Monitoring dashboards show no cache misses referencing the dropped tables.
- `scripts/reset-food-db.ts` can be removed or repurposed into a general “legacy purge” tool because the old tables are gone.
## Related Documentation
- FatSecret API Integration: See branch `codex/implement-fatsecret-api-integration`
- Environment Configuration: `.env.example`
- Reset Script: `scripts/reset-food-db.ts`
