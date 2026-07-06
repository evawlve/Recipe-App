# Handoff: Ingredient Mapping Issues — Feb 24, 2026

> **Context**: 300-recipe pilot import run after removing FatSecret source bias, adding raw-token normalization, and fixing the low-fat popcorn qualifier filter. 188KB summary log at `logs/mapping-summary-2026-02-24T17-39-05.txt`. Fix history in `docs/mapping-fix-log.md`.

---

## ⚠️ READ FIRST: Our Debug/Test Process Is Unreliable

Past "fixes" keep reappearing as broken because **our testing methodology has fundamental gaps.** Before investigating ANY issue, understand these problems so you don't repeat them.

### Bug 1: `debug-mapping-pipeline.ts` default mode ≠ production

The debug script has **two modes** and they diverge:

| | Default mode (`debugPipeline`) | `--production` mode |
|--|-------------------------------|---------------------|
| Code path | Manually calls `gatherCandidates` → `filterCandidatesByTokens` → `simpleRerank` step-by-step | Calls `mapIngredientWithFallback` (same as pilot import) |
| Serving selection | **NOT executed** — stops after reranking | Full serving selection + hydration + weight calc |
| Count extraction (Fix 45) | **Invisible** — never runs | Runs via `selectServing` |
| Cache behavior | **Always skips cache in gather** (line 266: `skipCache: true` is hardcoded) even without `--skip-cache` flag | Respects `--skip-cache` flag properly |

> [!CAUTION]
> **You can "fix" something that passes in debug mode, but it still fails in production** because debug mode doesn't execute serving selection, weight calculation, or count extraction. You can also see different candidates than production because gather always skips cache.

**Rule: Always verify fixes with `--production` mode AND a fresh pilot import. Debug mode is for _understanding_ the scoring, not for _validating_ fixes.**

### Bug 2: The `--skip-cache` flag only controls Step 3 (FoodMapping cache)

When you run `debug-mapping-pipeline.ts "dill" --skip-cache`, all it does is skip the `getFoodMapping()` lookup at Step 3. But:
- Step 4 Gather **always** skips cache (bug — `skipCache: true` is hardcoded in default mode)
- The **food/serving caches** (`FdcFood`, `FdcServing`, `FdcServingCache`) are never cleared
- The **IngredientFoodMap** entries from previous pilot imports persist

So after a fix, if you debug with `--skip-cache` and it looks good, but then run a pilot import, the import may still hit stale `FoodMapping` rows or stale food caches. **You must clear caches before verifying:**

```powershell
npx tsx scripts/clear-all-mappings.ts                  # Clears FoodMapping + IngredientFoodMap + AiNormalizeCache
npx tsx scripts/clear-ingredient-cache.ts "ingredient"  # Clears per-term food/serving cache
```

### Bug 3: No per-candidate score breakdown in debug output

Step 7 (Rerank) only shows the winner. It does NOT show:
- The scores of runner-up candidates
- Why a wrong candidate outscored the right one
- The breakdown of `EXACT_MATCH`, `TOKEN_OVERLAP`, `EXTRA_TOKEN_PENALTY`, `ORIGINAL_SCORE` per candidate

Without this, you're guessing about why the wrong food won. **Before making any scoring change, add temporary logging in `computeSimpleScore` in `simple-rerank.ts` to print all score components for each candidate.**

---

## Mandatory Investigation Protocol (Score-First)

> [!IMPORTANT]
> **DO NOT change any code until you can answer all three questions below for the issue you're investigating.**

For every wrong-food or wrong-weight issue:

1. **What candidates survived filtering?** — Run `--verbose` mode, look at Step 5 output. Is the correct food even in the list? If not, it's a filter issue ("search void" or over-aggressive token/modifier filter).

2. **What are the exact scores for each candidate?** — Add `console.log` in `computeSimpleScore` (or use `--production --verbose` which may log scores). You need to see: the winner's score, the correct candidate's score, and which score component made the difference.

3. **What specific code path produced the wrong result?** — For weight issues: which source (FDC or FatSecret) won? Which serving was selected? What was the multiplication? For food mismatches: was it a filter failure (wrong food passed) or a scoring failure (wrong food scored higher)?

```powershell
# Step 1: Production mode to see what actually happens
npx tsx scripts/debug-mapping-pipeline.ts "ingredient" --production --skip-cache --verbose

# Step 2: Debug mode to see candidates + scoring
npx tsx scripts/debug-mapping-pipeline.ts "ingredient" --skip-cache --verbose

# Step 3: If weight issue, check serving selection in production logs
# Look for "selectServing" and "grams" in the output
```

---

## Quick Start

```powershell
# Debug a specific ingredient (ALWAYS use --production to match pilot import behavior)
npx tsx scripts/debug-mapping-pipeline.ts "1 medium tomato" --production --skip-cache --verbose

# Debug mode (to see candidate list + scoring detail — NOT a substitute for production mode)
npx tsx scripts/debug-mapping-pipeline.ts "1 medium tomato" --skip-cache --verbose

# Clear mappings and re-run
npx tsx scripts/clear-all-mappings.ts
$env:ENABLE_MAPPING_ANALYSIS='true'; npx tsx scripts/pilot-batch-import.ts --recipes 300
```

---

## CRITICAL: Why Some "Fixed" Items Are Broken Again

Two recent scoring changes likely re-opened old bugs:

1. **Source bias removal** (Fix 47) — FatSecret used to get `+0.15` always. That masked many cases where FDC candidates scored higher on token overlap but were wrong. Now they win.
2. **Raw token normalization + FDC produce tiebreaker** (Fix 48) — FDC candidates with "raw" in their name are boosted for produce/meat queries. This is correct for "grape tomatoes" → FDC "grape raw tomatoes" but may cause collateral damage elsewhere.

> **Important**: Before debugging any wrong-food match, check if it's an FDC candidate winning where a FatSecret candidate previously won. That's the most likely root cause for NEW regressions.


---

## Section A: Regressions — Fixes That Are Still Broken

### A1: Dill → Dill Cucumber Pickles (Fix 34 regression)

| Field | Detail |
|-------|--------|
| Lines | 1242 (`5 sprig dill`), 1316 (`0.25 tsp dill`) |
| Wrong match | `Dill Cucumber Pickles` |
| Fix 34 claimed | Fixed |
| Hypothesis | Cache was NOT cleared after fix was applied, so cached bad mapping persists. Line 1316 explicitly says `(cached)` — the cache entry itself has the wrong food. Run `npx tsx scripts/clear-ingredient-cache.ts "dill"` and re-debug `--skip-cache`. If it's still broken after cache clear, the filter fix regressed. |
| Debug command | `npx tsx scripts/debug-mapping-pipeline.ts "5 sprig dill" --skip-cache --verbose` |

### A2: Grape Tomatoes Weight — WORSE Than Before (Fix 45 regression)

| Field | Detail |
|-------|--------|
| Lines | 531 (`25 grape tomatoes` → 4550g), 1363 (`20 grape tomatoes` → 3640g), 1317 (`18 organic grape tomatoes` → 2214g) |
| Expected | ~15–20g per tomato (300–500g total for 20–25 count) |
| Fix 45 claimed | Fixed count extraction in `selectServing` |
| Hypothesis | **Fix 45 was applied to FatSecret's `selectServing` path only.** After source bias removal (Fix 47) + raw token normalization (Fix 48), FDC now wins for "grape tomatoes" (`grape raw tomatoes`). FDC uses a **completely different hydration/serving path** that does NOT have Fix 45's count extraction. The FDC serving is likely a per-100g entry served as a flat weight, giving ~182g per unit → 25 × 182g = 4550g. |
| Where to look | `map-ingredient-with-fallback.ts` — check the FDC hydration path's `selectServing` equivalent. Also check if `hydrateSingleCandidate` for FDC applies the same count extraction logic. |
| Same-class bug | "14 mango chunks" → 2240g (~6x too heavy, line 430). Same root cause: FDC count-based serving not using embedded count. |
| Debug command | `npx tsx scripts/debug-mapping-pipeline.ts "25 grape tomatoes" --skip-cache --verbose` — look specifically at Step 7 winner source (FDC vs FatSecret) and the serving weight calculation |

---

## Section B: New Wrong Food Matches

### B1: "1 medium tomato" → Tomato Powder (85kcal/28g)

| Field | Detail |
|-------|--------|
| Expected | Fresh tomato ~18kcal/100g |
| Hypothesis | FDC "tomato powder" has high token overlap on "tomato" and likely a high `ORIGINAL_SCORE` from the API. Without the FatSecret bias, it can now win. The modifier "medium" is a `BENIGN_DESCRIPTOR_TOKEN` (won't be required) and "powder" isn't a `CATEGORY_CHANGING_TOKEN`. |
| Fix direction | `getModifierMatchBoost` in `simple-rerank.ts` — "powder" should be treated as a **category changer** that requires explicit presence in the query. Or: add a `FORM_CHANGE_TOKENS` check: if candidate name contains a form modifier (`powder`, `flakes`, `concentrate`, `paste`, `puree`) and query does not, penalize heavily. |
| Debug | `npx tsx scripts/debug-mapping-pipeline.ts "1 medium tomato" --skip-cache --verbose` |

### B2: "2 freshly garlic" → Chile-Garlic Pork Bowl (Freshly brand, 920kcal)

| Field | Detail |
|-------|--------|
| Expected | Raw garlic |
| Hypothesis | "freshly" is a brand name (Freshly meal delivery). FDC has branded Freshly meal products. The query "freshly garlic" hits these branded products via FDC full-text search. This is a **normalization failure** — AI normalize didn't strip "freshly" as a descriptor (it's also a valid adverb). |
| Fix direction | The AI normalize step should ideally catch this. Alternatively, `filter-candidates.ts` needs to catch that a **complete prepared meal** (920kcal/serving) should not match a simple ingredient query. Look at `hasSuspiciousMacros` — 920kcal for a typical serving is extreme. |
| Debug | `npx tsx scripts/debug-mapping-pipeline.ts "2 freshly garlic" --skip-cache --verbose` — check Step 2 (normalize) output |

### B3: "Petite Tomatoes" → green raw tomatoes

| Field | Detail |
|-------|--------|
| Expected | Small/cherry tomatoes ~18kcal/100g |
| Hypothesis | The `deriveMustHaveTokens` special case for petite requires `/(plum\|roma\|petite)\s+tomato/` — but "petite tomatoes" (plural) should still match this regex since `tomato` is a substring of `tomatoes`. Check if the regex actually fires. If it does, `mustHaveTokens = ["tomato"]` and FDC "green raw tomatoes" has "tomatoes" → passes. The FDC tiebreaker then lifts it above FatSecret options. |
| Fix direction | The produce/meat FDC tiebreaker `isProduceOrMeat` likely fires for tomatoes, boosting "green raw tomatoes". The word "green" is not in the query — this should be caught by `hasCriticalModifierMismatch`. Check if "green" is treated as a critical modifier for tomatoes. |
| Debug | `npx tsx scripts/debug-mapping-pipeline.ts "Petite Tomatoes" --skip-cache --verbose` |

### B4: "Fennel" → Fennel Seed

| Field | Detail |
|-------|--------|
| Expected | Fennel bulb (vegetable) ~31kcal/100g |
| Fennel seed | Spice, ~345kcal/100g — completely different food |
| Hypothesis | No unit context → can't use `detectSpiceContext`. "Fennel" alone is ambiguous (bulb vs seed). FDC/FatSecret both return "Fennel Seed" as a top result because it has smaller package listings. |
| Fix direction | Add "fennel" to `AMBIGUOUS_INGREDIENTS` in `filter-candidates.ts` using the existing spice/vegetable unit detection pattern. When unit is a volume (cup, tbsp) → spice/seed; when unit is weight/count (oz, lb, bulb) → vegetable. Without unit, prefer the vegetable form since recipes listing "fennel" almost always mean the bulb. |
| Debug | `npx tsx scripts/debug-mapping-pipeline.ts "Fennel" --skip-cache --verbose` |

### B5: "0.5 cup toasted pecan halves" → Toasted Pecan Caramel (candy, 344kcal/60g)

| Field | Detail |
|-------|--------|
| Expected | Plain toasted pecans ~691kcal/100g (but 60g × 344/60 ≈ 344 ≈ correct per-100g? No — 344kcal/60g = 573kcal/100g, roughly right for pecans actually) |
| Concern | The brand is "METROPOLITAN MARKET" and it's a caramel-coated pecan product. |
| Fix direction | `COMPLEX_PRODUCT` detection or `isMultiIngredientMismatch`. "Pecan caramel" has two food nouns (`pecan` + `caramel`) — the query only has `pecan`. The new 2-core-token requirement (Fix 46) should catch this if `coreTokens = ["toasted", "pecan", "halves"]` → requires first 2. But "caramel" is an extra token not in query. Check `UNRELATED_INDICATORS` — "caramel" should be there or in `CATEGORY_CHANGING_TOKENS`. |
| Debug | `npx tsx scripts/debug-mapping-pipeline.ts "0.5 cup toasted pecan halves" --skip-cache --verbose` |

### B6: "0.5 cup green peppers cut in strips" → ROASTED RED BELL PEPPER STRIPS (MEZZETTA)

| Field | Detail |
|-------|--------|
| Expected | Raw green bell pepper |
| Issue | "red" vs "green" (color mismatch) + "roasted" vs plain |
| Hypothesis | `hasCriticalModifierMismatch` should catch "red" vs "green" and "roasted" vs none. Either it's not checking color mismatches for peppers, or the branded FDC entry's name ordering puts "STRIPS" at the end and the filter doesn't see the color difference. |
| Debug | `npx tsx scripts/debug-mapping-pipeline.ts "0.5 cup green peppers cut in strips" --skip-cache --verbose` — check Step 5 (filter) log for why MEZZETTA product survived |

### B7: "Cherries" → LEHI VALLEY TRADING CO CHERRIES (325kcal/100g)

| Field | Detail |
|-------|--------|
| Expected | Fresh cherries ~63kcal/100g |
| Hypothesis | Lehi Valley Trading Co. sells dried/candy-coated cherries. FDC or FatSecret returns this branded entry. `hasSuspiciousMacros` should catch 325kcal/100g for "cherries" (expected ~60–80). Check if the suspicious macro check fires for cherry calorie range. |
| Debug | `npx tsx scripts/debug-mapping-pipeline.ts "Cherries" --skip-cache --verbose` — check Step 5 macro filters |

---

## Section C: Serving / Weight Issues

### C1: Count-Based Serving Weight (Grape Tomatoes, Mango Chunks)

See **A2** above. Root cause: FDC now wins via Fix 47/48, but FDC's serving path doesn't have Fix 45's count extraction. Fix must be applied to the FDC hydration/serving selection path too.

### C2: "Rice Vinegar" → 300kcal/100g

| Field | Detail |
|-------|--------|
| Line | 758 (no qty → 375g → 1125kcal) |
| Real value | Rice vinegar ~18kcal/100g |
| Hypothesis | The matched food is likely a "seasoned rice vinegar" (contains sugar/salt) or a rice wine product. 300kcal/100g = ~sugar-added product. Alternatively, the 375g serving weight is wrong — if the unit is "bottle" and it maps to a full bottle. |
| Also | Line 828-829: "Rice Vinegar" and "2 tbsp rice vinegar" are **failures** (✗) — so two different recipes have different outcomes for the same ingredient. Something in the cache/normalization path is diverging. |
| Debug | `npx tsx scripts/debug-mapping-pipeline.ts "Rice Vinegar" --skip-cache --verbose` and `npx tsx scripts/debug-mapping-pipeline.ts "2 tbsp rice vinegar" --skip-cache --verbose` |

### C3: "1 juice from 1 lemon" → 240g

| Field | Detail |
|-------|--------|
| Expected | ~30ml (1 lemon yields ~30–50ml juice) |
| Hypothesis | Parser sees "juice from 1 lemon" and treats "juice" as a known volume unit (like "cup"), picking the default 240ml/240g serving. The qty "1" × 240g = 240g. |
| Fix direction | Check `ingredient-line.ts` parser — "juice" is likely being parsed as a unit rather than part of the ingredient name. The input should normalize to "lemon juice" with qty derived from "1 lemon". |
| Debug | `npx tsx scripts/debug-mapping-pipeline.ts "1 juice from 1 lemon" --skip-cache --verbose` — check Step 1 (parse) output carefully |

---

## Section D: Failures (No Match)

### D1: "Strawberry Halves" — 8 recipe pairs failing

Most likely cause: "halves" is a cut-shape token (added to `BENIGN_DESCRIPTOR_TOKENS` in Fix 43) but may still be appearing in `mustHaveTokens`. Or the local FDC/OFF databases returns zero relevant results for "strawberry halves" and the word "halves" is causing search voids.

```powershell
npx tsx scripts/debug-mapping-pipeline.ts "1 cup strawberry halves" --skip-cache --verbose
```
Check Step 4 (Gather) — are any strawberry candidates returned at all?

### D2: "Rice Vinegar" / "2 tbsp rice vinegar" — Failures

Same ingredient as C2 but different recipes fail entirely vs wrong match. Investigate normalized query used for FatSecret search — "rice vinegar" might hit the FatSecret multi-ingredient mismatch filter (vinegar being in `MULTI_INGREDIENT_BLACKLIST`?) or the API returns no results.

### D3: "Tomato and Green Chili Mix" / "1.75 cup tomatoes with green chilies"

Multi-ingredient product — likely filtered by `isMultiIngredientMismatch`. The compound ingredient (tomatoes + green chilies as one canned product) needs either a synonym expansion or a direct brand lookup.

### D4: "Tomato Chipotle Sauce" / "14.5 oz tomatoes with green chilies"

Similar to D3 — compound product. "14.5 oz" is a standard can size suggesting canned product.

### D5: "Orange Tomato" / "1 cup orange tomato"

"orange" as a color variety. `hasCriticalModifierMismatch` may be blocking orange-colored tomato candidates because "orange" is treated as a fruit modifier. The `COLOR_DESCRIPTORS` list should treat orange as a valid color for tomatoes, not as the fruit "orange."

### D6: "Low Fat Flavored Yogurt" — [MISSING_FAT_MOD]

The `MISSING_FAT_MOD` flag suggests the filter is rejecting all candidates because they lack explicit "low fat" in the name. After Fix 46 (low → MODIFIER_TOKENS), "fat" and "low" are both stripped from mustHaveTokens, leaving "flavored" + "yogurt" as required. Check if any candidates survive the filter.

### D7: "Dry Mustard" / "1 tsp or 1 packet dry mustard"

Line 376 has `conf 1.00` but still fails (✗). This suggests the confidence gate passes but something downstream fails — likely a serving lookup error (no suitable serving). Run the full pipeline debug and check Step 8 (fallback/serving).

### D8: "0.25 tsp spice blend mustard"

Same `conf 1.00` but ✗ pattern as D7. Check if the AI serving estimator is failing or if there's a serving selection error for mustard.

---

## Section E: Questionable (Investigate if Time Allows)

| Line | Ingredient | Issue |
|------|-----------|-------|
| 251–252 | `32 oz black beans` | Mapped to dry bean nutrition (343kcal/100g). Canned black beans = ~132kcal/100g. Large `oz` quantity should signal canned product. Fix: add unit-context detection for "oz" with legumes → prefer canned. |
| 1070 | `Instant Brown Rice` | No quantity → mapped entire package (1530kcal). When qty is missing, the pipeline should use a canonical single-serving size, not package weight. |

---

## Recommended Fix Priority

| Priority | Issue | Why |
|----------|-------|-----|
| 🔴 HIGH | Grape tomatoes weight (12x) — FDC serving path | Affects 3+ lines, same class as mango chunks |
| 🔴 HIGH | Dill → pickles cache regression | 2 lines, Fix 34 supposedly done |
| 🟠 MEDIUM | Form-change penalty (`powder`, `flakes`, `paste`) | Covers tomato powder + future similar bugs |
| 🟠 MEDIUM | Strawberry halves failures (8 recipe pairs) | High frequency failure |
| 🟠 MEDIUM | Fennel bulb vs seed | Ambiguous ingredient missing from `AMBIGUOUS_INGREDIENTS` |
| 🟡 LOW | "freshly garlic" normalization | Edge case — unusual ingredient text |
| 🟡 LOW | "1 juice from 1 lemon" parser | Parse-level unit confusion |

---

## Current State of the Codebase

| Recent change | File | Status |
|--------------|------|--------|
| Fix 46: qualifier-only token filter | `filter-candidates.ts` | ✅ Working  |
| Fix 47: remove FatSecret source bias | `simple-rerank.ts` | ✅ Done — but unmasked FDC-side bugs |
| Fix 48: raw token normalization + FDC produce tiebreaker | `simple-rerank.ts` | ✅ Done — may need tiebreaker tuning |
| Fix hydration disconnect race | `deferred-hydration.ts`, `pilot-batch-import.ts` | ✅ Done |
| Fix 45: grape tomato count serving | `map-ingredient-with-fallback.ts` | ⚠️ Only fixed FatSecret path — FDC path still broken |
| Fix 34: dill filter | Somewhere in filter logic | ⚠️ Needs re-verification after cache clear |

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/mapping/filter-candidates.ts` | Token filtering, modifier mismatch, macro checks |
| `src/lib/mapping/simple-rerank.ts` | Scoring weights, token overlap, produce tiebreaker |
| `src/lib/mapping/map-ingredient-with-fallback.ts` | Main pipeline, `selectServing`, FDC hydration |
| `src/lib/mapping/deferred-hydration.ts` | Background hydration queue |
| `scripts/debug-mapping-pipeline.ts` | Per-ingredient pipeline debugger |
| `docs/mapping-fix-log.md` | Full history of all 48 fixes |
| `logs/mapping-summary-2026-02-24T17-39-05.txt` | Current 300-recipe import results (188KB) |
