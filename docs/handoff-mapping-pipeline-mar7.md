# Mapping Pipeline Handoff — March 7, 2026

## Context

The ingredient mapping pipeline (`codex/implement-fatsecret-api-integration` branch) was merged into `master`.
A 400-recipe pilot import achieved **99%+ structural accuracy**, but manual review of the latest mapping summary
(`logs/mapping-summary-2026-03-06T17-22-15.txt`) identified several classes of bugs that need fixing.

## Available Debug Scripts

All scripts are run via `npx tsx src/scripts/<script>.ts`:

| Script | Purpose |
|--------|---------|
| `debug-ingredient.ts` | Full pipeline trace: parse → normalize → search → filter → rerank → map |
| `gather-candidates.ts` | Show raw, filtered, and ranked candidates for an ingredient |
| `check-food-servings.ts` | Inspect cached serving data for any food |
| `check-cache-entry.ts` | Inspect ValidatedMapping, AiNormalizeCache, IngredientFoodMap entries |

Root-level scripts (`npx tsx scripts/<script>.ts`):
- `pilot-batch-import.ts` — Run pilot imports with `--recipes N`
- `clear-all-mappings.ts` — Clear ValidatedMapping + AiNormalizeCache for clean re-test

## Diagnosis Workflow

```bash
# 1. Debug a specific ingredient
npx tsx src/scripts/debug-ingredient.ts "1 dash pepper"

# 2. See what candidates the pipeline considers
npx tsx src/scripts/gather-candidates.ts "blood orange zest"

# 3. Check what serving data exists for a matched food
npx tsx src/scripts/check-food-servings.ts "kalamata olives"

# 4. Clear cache for one ingredient and re-test
npx tsx src/scripts/check-cache-entry.ts "pepper" --clear
npx tsx src/scripts/debug-ingredient.ts "1 dash pepper"

# 5. Clean-slate pilot import (100 recipes)
npx tsx scripts/clear-all-mappings.ts
ENABLE_MAPPING_ANALYSIS=true npx tsx scripts/pilot-batch-import.ts --recipes 100
```

---

## Issues to Fix

### Priority 1: Serving/Weight Resolution Bugs

These produce wildly incorrect calorie and gram values.

#### 1A. "Dash" defaults to 100g

| Example | Mapped grams | Expected |
|---------|-------------|----------|
| `1 dash black pepper` | 100g / 251 kcal | ~0.5g / ~1 kcal |
| `5 dash black pepper` | 500g / 1255 kcal | ~2.5g / ~5 kcal |

**Root cause:** When no serving matches "dash," the pipeline falls back to a 100g default.
**Where to look:** `src/lib/fatsecret/map-ingredient.ts` — serving resolution logic, fallback path.
Also check `src/lib/nutrition/compute.ts` for the 100g default fallback.
A "dash" should resolve to approximately 0.5g.

#### 1B. "Piece/Chunk" treated as 100g each

| Example | Mapped grams | Expected |
|---------|-------------|----------|
| `18 piece greek kalamata olives` | 1800g (100g/piece) | ~54g (~3g/olive) |
| `14 mango chunks` | 4704g (336g/chunk) | ~280g (~20g/chunk) |
| `25 grape tomatoes` | 3075g (123g/each) | ~150g (~6g/each) |

**Root cause:** The pipeline uses the full-fruit weight for "piece" regardless of the qualifying adjective.
"grape tomato" should use ~6g, not 123g. "chunks" should not multiply by whole-fruit weight.
**Where to look:** `src/lib/fatsecret/map-ingredient.ts` — piece/unit weight resolution.
`src/lib/nutrition/compute.ts` — `resolveGramsForAmount()`.

#### 1C. Avocado underestimation (10g)

| Example | Mapped grams | Expected |
|---------|-------------|----------|
| `1 avocado cubed` | 10g / 16 kcal | ~150g / 240 kcal |
| `1 mini avocado` | 10g / 16 kcal | ~100g / 160 kcal |

**Root cause:** The serving resolution picks the wrong serving size (possibly a "piece" or slice serving instead of a whole unit).
**Where to look:** Same as 1B — serving/unit resolution for whole fruits.

---

### Priority 2: Category Mismatches (Filter Failures)

These are incorrectly matched foods where the filter should have eliminated the candidate.

#### 2A. Simple ingredient → Branded retail product

| Ingredient | Mapped to | Problem |
|-----------|----------|---------|
| `Blood Orange Zest` | Orange Zest Chicken (Healthy Choice) | Frozen dinner, not a citrus zest |
| `5 g cinnamon sticks` | Cinnamon Sticks White Icing Dipping Cup (Pizza Hut) | Dessert dip, not a spice |
| `0.25 tsp garlic & herb seasoning` | Garlic & Herb Quinoa Blend (Lundberg) | Boxed side dish, not a spice |
| `2 large yellow zucchini` | Fresh Frozen Garden Blend Vegetables | Mixed veg medley, not zucchini |

**Root cause:** The filter/rerank pipeline doesn't penalize branded retail products enough when the query is a simple raw ingredient. The token overlap is high ("cinnamon sticks" matches "Cinnamon Sticks White Icing...") but the food category is completely wrong.
**Where to look:** `src/lib/fatsecret/filter-candidates.ts` — branded product filtering.
`src/lib/fatsecret/simple-rerank.ts` — scoring penalties for category mismatches.

#### 2B. "Pepper" (spice) → banana pepper (vegetable)

| Ingredient | Mapped to |
|-----------|----------|
| `1 dash pepper` | banana raw pepper |

**Root cause:** "pepper" is ambiguous — the pipeline should prefer black/white pepper (spice) for small quantities with units like "dash" or "pinch."
**Where to look:** `src/lib/fatsecret/gather-candidates.ts` — search query construction.
Consider adding a context-aware disambiguation: if unit is a spice-unit (dash, pinch, tsp), prefer the spice over the vegetable.

#### 2C. "Tomato and Green Chili Mix" → green raw tomatoes

**Root cause:** The pipeline stripped "mix" and matched to "green tomatoes" (unripe). Should match a prepared mix or salsa verde product.
**Where to look:** `src/lib/fatsecret/ai-normalize.ts` — normalization may be stripping important qualifiers.

---

### Priority 3: Explicit Failures (✗ marks)

| Ingredient | Mapped to | Issue |
|-----------|----------|-------|
| `1 dash pepper` | White Pepper | Confidence 0.95 but marked as failure — investigate why |
| `0.5 cup no calorie sweetener` | Altern No Calorie Sweetener (Great Value) | Confidence 1.00 but still marked ✗ — likely a validation rejection |

**Where to look:** Check `src/lib/fatsecret/map-ingredient.ts` validation logic — these have high confidence but are still failing.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/fatsecret/map-ingredient.ts` | Main mapping orchestrator, serving resolution |
| `src/lib/fatsecret/map-ingredient-with-fallback.ts` | FDC fallback path |
| `src/lib/fatsecret/filter-candidates.ts` | Token-based candidate filtering |
| `src/lib/fatsecret/simple-rerank.ts` | Scoring and reranking candidates |
| `src/lib/fatsecret/gather-candidates.ts` | Search query construction, candidate gathering |
| `src/lib/fatsecret/ai-normalize.ts` | AI-powered ingredient normalization |
| `src/lib/nutrition/compute.ts` | Nutrition computation, gram resolution |
| `src/lib/fatsecret/config.ts` | Pipeline configuration |
| `docs/ingredient-mapping-pipeline.md` | Full pipeline documentation |
| `.agent/docs/known-issues.md` | Known bugs and fixes |

## Environment Setup

```bash
npm install
npx prisma generate
# Copy .env from secure location
# Run: npx tsx src/scripts/debug-ingredient.ts "test ingredient"
```

## Recommended Approach

1. Start with **Priority 1** (serving bugs) — these have the highest caloric impact
2. Use `debug-ingredient.ts` to trace each failing case
3. Fix → clear cache → re-test with `check-cache-entry.ts --clear` then `debug-ingredient.ts`
4. After fixing, run a pilot import with 100-200 recipes to verify no regressions
5. Document fixes in `.agent/docs/known-issues.md`
