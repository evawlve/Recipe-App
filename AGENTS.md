# Agent Instructions

> **Purpose**: Rules and conventions for AI agents working on this codebase.

---

## Quick Links

| Resource | Purpose |
|----------|---------|
| [Known Issues](.agent/docs/known-issues.md) | Documented bugs, fixes, and gotchas |
| [Debugging Quickstart](.agent/docs/debugging-quickstart.md) | How to diagnose mapping failures |
| [Ingredient Mapping Pipeline](.agent/docs/ingredient-mapping-pipeline.md) | Full system documentation |
| [Mapping Audit Review](.agent/workflows/mapping-audit-review.md) | How to conduct a chunk-by-chunk audit |
| [Autonomous Validation](.agent/workflows/autonomous-validation.md) | How to run a pilot import and verify results |


---

## Database Conventions

### Prisma Schema (`prisma/schema.prisma`)

1. **IDs**: Use `@id @default(cuid())` for string IDs, or `@id` for integer IDs (like FDC foods)
2. **Timestamps**: Always include `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt` where applicable
3. **Indexes**: Add `@@index` for frequently queried fields
4. **Cascades**: Use `onDelete: Cascade` for child relations to parent tables
5. **Unique constraints**: Use `@@unique` for composite unique keys

### Table Naming

| Pattern | Example |
|---------|---------|
| Cache tables | `FatSecretFoodCache`, `FdcServingCache` |
| Override tables | `PortionOverride`, `UserPortionOverride` |
| Mapping tables | `ValidatedMapping`, `IngredientFoodMap` |
| Learning tables | `LearnedSynonym`, `AiNormalizeCache` |

### Foreign Keys

> ⚠️ **Critical**: FDC foods use integer `fdcId`, FatSecret uses string `foodId`. Never mix these.

```typescript
// FDC: Integer ID
model FdcServingCache {
  fdcId Int  // Foreign key to FdcFoodCache.id
}

// FatSecret: String ID  
model FatSecretServingCache {
  foodId String  // Foreign key to FatSecretFoodCache.id
}
```

---

## Code Conventions

### TypeScript

1. **Strict mode**: All code must pass `tsc --noEmit`
2. **Imports**: Use path aliases (`@/lib/...`) for src imports
3. **Async/Await**: Prefer over `.then()` chains
4. **Error handling**: Wrap database operations in try/catch

### Scripts vs App Code

| Location | Config | Use Case |
|----------|--------|----------|
| `src/` | `tsconfig.json` | Next.js app code (bundler module resolution) |
| `scripts/` | `tsconfig.scripts.json` | CLI scripts (node module resolution) |

**Running scripts:**
```bash
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/your-script.ts
```

---

## Ingredient Mapping Rules

### Normalization

1. **Strip neutral prep phrases**: chopped, diced, minced, sliced, boiled, scrambled
2. **Preserve nutritional modifiers**: fried, sugar-free, lowfat, 2%, unsweetened

### Cache Behavior

1. **ValidatedMapping** uses `normalizedForm` as primary lookup key (not raw ingredient)
2. Clear mappings with `scripts/clear-all-mappings.ts` before testing changes
3. Cache entries persist across recipes—one mapping serves all users

### Common Pitfalls

1. **Regex word boundaries**: Use `\b` to prevent partial matches (e.g., "raw" matching inside "st**raw**berry")
2. **Hyphen handling**: Use `[-\s]?` for compound phrases (e.g., `hard[-\s]?boiled`)
3. **Length sorting**: Process longer patterns first (e.g., "hard-boiled" before "boiled")

---

## Mapping Audits

After every pilot import, a `mapping-summary-*.txt` log is generated in `logs/`. **Always conduct a manual chunk-by-chunk review** — do not rely solely on automated scripts, as they miss subtle semantic inversions.

### Step 1: Generate the grouped summary

```bash
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/group-mapping-summary.ts logs/<log-file>.txt
```

This produces `logs/grouped-<log-file>.txt` — all events grouped by their resolved food target, reducing ~13k lines to ~800 semantic groups.

### Step 2: Review chunk-by-chunk (800 lines at a time)

Read the grouped file using `view_file` with `StartLine`/`EndLine`. Watch for:

| Red Flag | Example |
|----------|---------|
| Semantic inversion | `apple pie spice` → `apple chips` |
| Category mismatch | `hamburger buns` → `saltine crackers` |
| Extreme weight bloat | `1 bunch mint` → 1000g |
| Fat modifier mismatch | `extra light` → `fat free` product |
| Package vs serving | `1 packet sweetener` → 100g (should be 1g) |
| Bare query | `Whey Protein` (no unit) → 3000g |

### Step 3: Document & fix

Write findings to a `mapping_audit_results.md` artifact; then create an implementation plan targeting:
- `src/lib/fatsecret/normalization-rules.ts` — synonym rewrites
- `src/lib/parse/unit.ts` — micro-unit types (`drop`, `second`)
- `src/lib/units/unit-graph.ts` — ml equivalents for new units
- `src/lib/servings/default-count-grams.ts` — gram seed data
- `src/lib/ai/ambiguous-serving-estimator.ts` — packet routing
- `src/lib/fatsecret/filter-candidates.ts` — negative category guards

See [Mapping Audit Review](.agent/workflows/mapping-audit-review.md) for the full step-by-step workflow.

---

## Testing

### Before Submitting Changes

```bash
# TypeScript check
npm run typecheck

# Lint
npm run lint

# Run tests
npm test
```

### Verifying Specific Mapping Fixes

> ⚠️ **CRITICAL**: Do NOT run a full pilot import just to verify a localized synonym or filter fix. This wastes expensive AI API calls and provides no guarantee that your specific problem ingredients will actually exist in the random recipe sample.

Instead, create a fast verification script (e.g. `tmp/test-fixes.ts`) to hit the pipeline directly:

```typescript
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function test() {
  const result = await mapIngredientWithFallback('0.5 tsp nutmeg');
  console.log('Result =>', result?.foodName, result?.brandName);
}

test().catch(console.error).finally(() => process.exit(0));
```

Run it locally to confirm the exact anomaly was resolved before running ANY large-batch validations:
```bash
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register tmp/test-fixes.ts
```

### Pilot Import Testing

**(Use ONLY for broad regression testing after accumulating many fixes)**

```bash
# Clear specific caches if necessary, then run the full pilot
npx ts-node --project tsconfig.scripts.json scripts/pilot-batch-import.ts 100
```

---

## When You Fix a Bug

**Document it in [Known Issues](.agent/docs/known-issues.md)**:

1. Add the symptom, root cause, and fix
2. Include file paths and line numbers where helpful
3. This helps future agents avoid the same issue

---

## Questions?

If you encounter something not covered here, check:
1. The [Known Issues](.agent/docs/known-issues.md) file
2. The `*.md` files in `.agent/docs/`
3. Existing code patterns in similar files
