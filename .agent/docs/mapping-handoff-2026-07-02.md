# Mapping Pipeline & VM Audit Handoff (July 2, 2026)

## 📌 Context & Objectives
We audited and realigned the ingredient mapping pipeline on the consolidation VM to resolve database constraint failures and API mismatches introduced by the deprecation of the legacy `FatSecretFoodCache` schema.

Our target was to investigate why the pilot batch validation ran at a **78.4% success rate** with multiple crashes, fix the root causes, and establish a secure file-syncing pipeline using Syncthing.

---

## 🛠️ Work Accomplished & Root-Cause Fixes

### 1. FatSecret Cache Ingestion Realignment
* **File modified**: [cache.ts](file:///home/diego/Recipe-App/src/lib/fatsecret/cache.ts)
* **Issue**: The consolidated schema removed the legacy `FatSecretFoodCache` table in favor of `AiGeneratedFood`. The mapper failed to save incoming live API results, triggering foreign key violations when mapping.
* **Fix**: Rewrote `ensureFoodCached` to dynamically parse and upsert FatSecret API payload results (macros per 100g and servings) into `AiGeneratedFood` and `AiGeneratedServing` tables using transactions.

### 2. Safely Querying FatSecret API
* **Files modified**: [cache.ts](file:///home/diego/Recipe-App/src/lib/fatsecret/cache.ts) and [map-ingredient-with-fallback.ts](file:///home/diego/Recipe-App/src/lib/fatsecret/map-ingredient-with-fallback.ts)
* **Issue**: The mapper passed OpenFoodFacts barcodes (`off_...`), USDA IDs (`fdc_...`), and CUIDs (`cmr35d5...`) to the FatSecret client, yielding `FatSecret error 105: Invalid long value`.
* **Fix**: Added validation gates targeting both hydration and check-incomplete cache operations. The pipeline now only executes `client.getFoodDetails` if the candidate ID is a purely numeric string (`/^\d+$/`).

### 3. Resolving Unique Constraint Violations
* **Files modified**: [cache.ts](file:///home/diego/Recipe-App/src/lib/fatsecret/cache.ts) and [ai-backfill.ts](file:///home/diego/Recipe-App/src/lib/fatsecret/ai-backfill.ts)
* **Issue**: `AiGeneratedFood` enforces a `@unique` constraint on `ingredientName`. Multiple foods mapping to semantic duplicates (e.g. "Salt" and "salt") triggered unique constraint violations, crashing transactions and preventing caching.
* **Fix**: 
  - Updated `upsertFoodFromDetails` to check if a record with the same `ingredientName` already exists, returning it early if present.
  - Realigned `insertAiServing` in the backfill flow to update the existing record (`targetFoodId`) instead of attempting to create a duplicate.

### 4. Database Foreign Key Reference Bindings
* **File modified**: [map-ingredient-with-fallback.ts](file:///home/diego/Recipe-App/src/lib/fatsecret/map-ingredient-with-fallback.ts)
* **Issue**: When the mapper fallback check triggered cache-upserts, it returned the raw candidate ID (e.g. `"33908"`) instead of the actual database row ID (e.g. `"salt"`), causing subsequent `IngredientFoodMap` creation to fail.
* **Fix**: Added a stateful `targetFoodId` pointer that updates dynamically when a cache-lookup redirect or upsert occurs, guaranteeing correct mapping bindings.

---

## 📈 Verification Run Results

After clearing the mappings database, we ran:
```bash
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/pilot-batch-import.ts 100
```
* **Success Rate**: **87.8%** (100% of mapped ingredients entered at high confidence `≥ 0.7`).
* **Failed Items**: **0** (No SQL or API runtime crashes).
* **Code Quality**: TypeScript compiles successfully via `npm run typecheck`.

---

## 🔄 Syncthing Environment Setup
To facilitate cross-platform testing, Syncthing is configured and running:
* **Status**: Running as a user-level background daemon (`systemctl --user start syncthing`).
* **Ignore Patterns**: Created [.stignore](file:///home/diego/Recipe-App/.stignore) containing exclusions for `node_modules`, `.next`, `.git`, `logs`, `tmp`, and lockfiles.
* **Accessibility**: GUI listening address set to `0.0.0.0:8384` allowing local network access from Windows at [http://192.168.1.21:8384](http://192.168.1.21:8384).
* **Data Security**: Local repository progress was safely committed to the git branch prior to bi-directional sync initialization.
