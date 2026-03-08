# Ingredient Mapping Pipeline — Handoff (Feb 28, 2026)

## Session Summary

This session resolved **10 of 12** issues from the [handoff-feb24.md](file:///c:/Dev/Recipe%20App/docs/handoff-feb24.md) checklist. Two items remain open: a nutrition-based tiebreaker for branded condiments (C2) and prep modifier stripping (separate handoff already created).

---

## Bug Fixes Applied (This Session)

### Fix 1: B2 — "freshly" as mustHaveToken kills real garlic candidates

**File:** [filter-candidates.ts](file:///c:/Dev/Recipe%20App/src/lib/fatsecret/filter-candidates.ts) (L2367)

**Root Cause:** `deriveMustHaveTokens` splits "freshly garlic" into tokens `["freshly", "garlic"]`. The `MODIFIER_TOKENS` set included `'fresh'` but NOT `'freshly'` (the adverb form). So `'freshly'` survived as a must-have token, requiring ALL candidates to include the word "freshly" in their name. This filtered out every real garlic entry and only kept branded "Freshly Chile-Garlic Pork Bowl" meal products.

**Fix:** Added `'freshly'` to `MODIFIER_TOKENS` alongside `'fresh'`.

```diff
-'granules', 'granulated', 'flakes', 'powder', 'powdered', 'ground', 'dried', 'fresh', 'frozen',
+'granules', 'granulated', 'flakes', 'powder', 'powdered', 'ground', 'dried', 'fresh', 'freshly', 'frozen',
```

**Verification:** `"2 freshly garlic"` → **raw garlic** (30g, 42.9 kcal) ✓

---

### Fix 2: B3 — Petite tomatoes mapped to green (unripe) tomatoes

**File:** [simple-rerank.ts](file:///c:/Dev/Recipe%20App/src/lib/fatsecret/simple-rerank.ts) (inside `getAttributeContradictionPenalty`, ~L436)

**Root Cause:** For "petite tomatoes", the only surviving FDC candidates were "grape raw tomatoes" (0.477) and "green raw tomatoes" (0.552). The existing `getAttributeContradictionPenalty` only fires when the **query specifies a color** (`queryColors.length === 1`). Since "petite tomatoes" has no color, both scored normally and "green" won on token overlap.

Green tomatoes are an unripe/specialty item — when someone says "petite tomatoes", they mean red/ripe ones.

**Fix:** Added a **default-ripeness penalty** block:
- When `queryColors.length === 0` (no color specified in query)
- AND query mentions a word in `ASSUMED_RED_FOODS` (currently `['tomato', 'tomatoes']`)  
- AND candidate name contains `\bgreen\b`
- Apply **50% of `ATTRIBUTE_CONTRADICTION_PENALTY`** (soft penalty, not hard reject)

This shifted "green raw tomatoes" from 0.552 → 0.377, letting "grape raw tomatoes" (0.477) win correctly.

**Verification:** `"petite tomatoes"` → **grape raw tomatoes** (123g) ✓

> [!NOTE]
> The 50% penalty is intentionally softer than a full contradiction — we still want explicit `"green tomatoes"` queries to work. The `ASSUMED_RED_FOODS` list can be extended if other foods have similar default-color assumptions.

---

### Fix 3: C3 — "1 juice from 1 lemon" mapped to bottled concentrate

**File:** [ingredient-line.ts](file:///c:/Dev/Recipe%20App/src/lib/parse/ingredient-line.ts) (L123, pre-processing normalization)

**Root Cause:** The parser tokenized `"1 juice from 1 lemon"` as `qty=1, name="juice from 1 lemon"`. It doesn't understand the `"X from Y"` recipe phrasing where the ingredient is `Y X` (e.g., "juice from lemon" = "lemon juice"). The resulting query "juice from 1 lemon" matched FDC's "bottled real lemon lemon juice from concentrate" (240g — an entire bottle).

**Fix:** Added regex pre-processing that transforms `juice/zest from|of N fruit` → `N fruit juice/zest`:

```typescript
unitNormalized = unitNormalized
  .replace(/^(\d*\s*)(juice|zest)\s+(?:from|of)\s+(\d+)\s+(.+)$/i,
    (_, _leadingQty, type, fruitQty, fruit) => `${fruitQty} ${fruit.trim()} ${type}`)
  .trim();
```

**Verified patterns:**
- `"1 juice from 1 lemon"` → **raw lemon juice** (60g, 13.2 kcal) ✓
- `"juice of 2 limes"` → **raw lime juice** (120g, 30 kcal) ✓
- `"zest from 1 orange"` → **raw orange peel** (10g) ✓

---

### Previous Session Fixes (Already Applied)

| Fix | Issue | File | What |
|-----|-------|------|------|
| A1 | Dill → Pickles | `map-ingredient-with-fallback.ts` | Added `sprig↔sprigs` + 8 other herb/produce unit aliases to `selectServing` |
| D1 | Strawberry Halves → NULL | `filter-candidates.ts` | Fixed `-y→-ies` plural in `hasCoreTokenMismatch` regex |
| B6 | Green Peppers → Red Pepper | 3 files | Color contradiction filter + `MIN_RERANK_CONFIDENCE` 0.74→0.70 + fallback `!winner` guard |

---

## Remaining Issues for Next Agent

### 1. C2: Rice Vinegar — Nutrition-Based Tiebreaker (PRIORITY)

**Problem:** `"1 tbsp rice vinegar"` maps to **Mizkan Rice Vinegar** (seasoned, 45 kcal/tbsp). Plain rice vinegar is ~3 kcal/tbsp. The reranker scores all three "Rice Vinegar" candidates identically (1.066) — brand selection is essentially random.

**Why FDC doesn't help:** All 7 FDC "RICE VINEGAR" entries have `0/0/0/0` macros. They're rejected by `hasNullOrInvalidMacros` because "RICE VINEGAR" contains the word "rice", matching `MUST_HAVE_CALORIES_PATTERNS` at L1307 of `filter-candidates.ts` — so the all-zero check flags it as corrupted data (real rice has ~130 kcal/100g). This is a valid concern but a false positive for vinegar.

**Available FatSecret candidates (per-tbsp calories):**

| Brand | kcal/tbsp | Grams | Type |
|-------|-----------|-------|------|
| Kikkoman | 0 | 15g | Plain (unseasoned) ✅ |
| Marukan | 12.5 | 7.5g | Likely light seasoned |
| Nakano | 14.2 | 14.2g | "Original Seasoned" |
| Trader Joe's | 20 | 15g | Seasoned |
| Mizkan | 45 | 15g | Seasoned (highest) ❌ current winner |

**Proposed approach — Nutrition-based tiebreaker:**
When multiple candidates score identically on name matching, use the AI nutrition estimate (from `AiNormalizeCache.estimatedCaloriesPer100g`) to break the tie. For "rice vinegar", the AI estimate should be ~18 kcal/100g. Kikkoman (0 kcal) is closest.

**Key files to modify:**
- [simple-rerank.ts](file:///c:/Dev/Recipe%20App/src/lib/fatsecret/simple-rerank.ts) — `computeSimpleScore` already has a `nutritionScore` component (currently 0.000 for these). The `nutritionScore` uses the AI nutrition estimate to penalize candidates whose macros deviate significantly from the expected profile.
- [map-ingredient-with-fallback.ts](file:///c:/Dev/Recipe%20App/src/lib/fatsecret/map-ingredient-with-fallback.ts) — Where `AiNormalizeCache` results are available (check `estimatedCaloriesPer100g` availability).

**Edge cases:**
- "Seasoned" in the candidate name should be penalized when query doesn't say "seasoned" (existing `modifierBoost` logic already handles this partially — `"Seasoned Rice Vinegar"` scores 0.496 vs 1.066 for "Rice Vinegar")
- The tiebreaker should only fire when name scores are very close (within ~0.05), not override real name-match differences
- Consider whether the `MUST_HAVE_CALORIES_PATTERNS` regex for `rice` should be refined to exclude compound foods where rice is a modifier (rice vinegar, rice wine, rice paper) vs rice-as-food (rice, fried rice, rice pilaf)

---

### 2. Prep Modifier Stripping — Separate Handoff

Already documented in [handoff-prep-modifier-stripping.md](file:///c:/Dev/Recipe%20App/docs/handoff-prep-modifier-stripping.md). A parallel agent should be working on this.

**Summary:** Prep modifiers (diced, chopped, sliced, etc.) in the ingredient name pollute `simpleRerank` scoring. The fix involves stripping prep words from `searchQuery` before passing to `computeSimpleScore`. The `canonicalBase` field from `AiNormalizeCache` already does this for AI-normalized queries but isn't always available (the normalize gate skips the LLM call for high-confidence matches).

---

### 3. B5: Toasted Pecan Halves — Unverified

`"0.5 cup toasted pecan halves"` — needs verification that the confection penalty correctly prevents mapping to pecan-based candy/confection products. This was noted in the original handoff but never tested in this session.

**Quick test command:**
```powershell
npx tsx scripts/debug-mapping-pipeline.ts "0.5 cup toasted pecan halves" --skip-cache
```

---

### 4. Minor Observations (Low Priority)

- **D5 "orange tomato"** → Maps to generic "Tomato" (Arby's brand) via fallback. Nutritionally correct but the Arby's brand tag is misleading. The color filter doesn't activate because "orange" is ambiguous (fruit vs color descriptor).
- **D6 "low fat flavored yogurt"** → Maps to LOW FAT YOGURT (Yoplait, 244g, 200 kcal). Branded but nutritionally reasonable. The word "flavored" is dropped — could investigate if flavor-specific matching would improve accuracy.
- **Marukan rice vinegar grams issue** — Returns 7.5g per tbsp serving (should be ~15g). May indicate a half-tablespoon default serving in FatSecret data. Worth checking if `selectServing` is correctly interpreting the serving size.

---

## Key Files Reference

| File | Purpose | Lines of Interest |
|------|---------|-------------------|
| [filter-candidates.ts](file:///c:/Dev/Recipe%20App/src/lib/fatsecret/filter-candidates.ts) | Candidate filtering, `deriveMustHaveTokens`, `hasNullOrInvalidMacros` | `MODIFIER_TOKENS` ~L2340, `MUST_HAVE_CALORIES_PATTERNS` L1305, `hasNullOrInvalidMacros` L1355 |
| [simple-rerank.ts](file:///c:/Dev/Recipe%20App/src/lib/fatsecret/simple-rerank.ts) | Scoring, `computeSimpleScore`, `getAttributeContradictionPenalty` | `computeSimpleScore` ~L850, `getAttributeContradictionPenalty` ~L413, `WEIGHTS` near top |
| [map-ingredient-with-fallback.ts](file:///c:/Dev/Recipe%20App/src/lib/fatsecret/map-ingredient-with-fallback.ts) | Main pipeline orchestration, fallback logic, AI normalization | Fallback condition ~L997, AI normalize gate ~L631 |
| [ingredient-line.ts](file:///c:/Dev/Recipe%20App/src/lib/parse/ingredient-line.ts) | Ingredient line parser (qty, unit, name extraction) | juice/zest normalization ~L123 |

## Debugging Commands

```powershell
# Standard mapping test (production mode)
npx tsx scripts/debug-mapping-pipeline.ts "1 tbsp rice vinegar" --skip-cache

# Step-by-step debug mode (no hydration, shows candidates + scores)
npx tsx scripts/debug-mapping-pipeline.ts "1 tbsp rice vinegar" --debug-steps --skip-cache

# With rerank score breakdown
$env:DEBUG_RERANK_SCORES='true'; npx tsx scripts/debug-mapping-pipeline.ts "1 tbsp rice vinegar" --skip-cache

# Clear all caches for clean-slate testing
npx tsx scripts/clear-all-mappings.ts

# Clear specific ingredient cache
npx tsx scripts/clear-ingredient-cache.ts "rice vinegar"
```
