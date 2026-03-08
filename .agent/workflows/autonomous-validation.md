---
description: Autonomous ingredient mapping validation - run pilot import, verify results, fix issues, document changes
---

# Autonomous Ingredient Mapping Validation Workflow

> **Purpose**: Systematically validate, fix, and improve the ingredient mapping pipeline with minimal human intervention.

// turbo-all

---

## Phase 1: Run Pilot Import

1. Check if there's a recent mapping summary in `logs/` (within last 30 minutes):
   ```powershell
   Get-ChildItem logs/mapping-summary-*.txt | Sort-Object LastWriteTime -Descending | Select-Object -First 1
   ```

2. If no recent summary, run pilot batch import with analysis enabled (replace 100 with desired recipe count):
   ```powershell
   $env:ENABLE_MAPPING_ANALYSIS='true'; npx tsx scripts/pilot-batch-import.ts --recipes 100
   ```
   All three formats are equivalent:
   ```powershell
   npx tsx scripts/pilot-batch-import.ts 100
   npx tsx scripts/pilot-batch-import.ts --recipes 100
   npx tsx scripts/pilot-batch-import.ts --recipes=100
   ```

3. Wait for completion and note the output file paths.

---

## Phase 2: Parse Results

1. Open the latest `mapping-summary-*.txt` and scan for issues:
   - `[LOW_CONF]` - No match found or confidence too low
   - `[HIGH_KCAL]` - Suspiciously high calories
   - `✗` prefix - Failed mappings
   - Check calorie values that seem wrong (e.g., sugar substitute > 50 kcal)

2. Open `mapping-analysis-*.json` for detailed candidate info on flagged items.

3. Calculate success rate:
   - Count total ingredients and successful mappings
   - Current target: **99%+ accuracy**

---

## Phase 3: Triage Issues

1. For each issue found, add to `docs/mapping-validation-queue.md`:

   ```markdown
   ### [Issue Title]
   | Field | Value |
   |-------|-------|
   | Raw Line | `"exact ingredient text"` |
   | Current Mapping | Wrong Food Name (XXX kcal) |
   | Expected | Correct Food Name (~XX kcal) |
   | Severity | HIGH/MEDIUM/LOW |
   | Status | PENDING |
   ```

2. Prioritize by severity:
   - **HIGH**: Wrong food category (meat→vegetable), >100 kcal difference
   - **MEDIUM**: Wrong variant (whole milk→skim), 20-100 kcal difference
   - **LOW**: Minor issues, <20 kcal difference

---

## Phase 4: Investigate (Per Issue)

1. Run the debug pipeline script:
   ```powershell
   npx tsx src/scripts/debug-ingredient.ts "INGREDIENT_TEXT" --verbose
   ```

   To see candidates before/after filters:
   ```powershell
   npx tsx src/scripts/gather-candidates.ts "INGREDIENT_TEXT" --show-filtered
   ```

2. Analyze output at each stage:
   - **Step 1: Parse** - Is qty/unit/name extracted correctly?
   - **Step 2: Normalize** - Did AI normalize correctly?
   - **Step 3: Cache** - Did it hit wrong cached mapping?
   - **Step 4: Gather** - Is correct food in API results?
   - **Step 5: Filter** - Was correct food filtered out?
   - **Step 6: Gate** - Did confidence gate reject good candidate?
   - **Step 7: Rerank** - Is scoring giving correct food lower score?
   - **Step 8: Fallback** - Did it fall back incorrectly?

3. Identify root cause using this guide:

   | If correct food... | Problem is in... |
   |--------------------|------------------|
   | Never in API results | AI normalization or synonyms |
   | Gets filtered out | `filter-candidates.ts` rules |
   | Ranks lower than wrong food | `simple-rerank.ts` scoring |
   | Gets wrong nutrition | Serving selection or cache |

4. **If selectionReason = "fallback_after_serving_failure":**
   - The CORRECT candidate was selected first, but serving lookup failed
   - Check WHY AI backfill didn't create a serving estimate
   - Investigate: `npx tsx src/scripts/check-food-servings.ts "FOOD NAME"`
   - Check if backfill is enabled: `ENABLE_PREEMPTIVE_BACKFILL` env var
   - Verify backfill eligibility in `serving-backfill.ts`

5. **If FDC candidate has higher score but lower rank:**
   - Check source preference boost in `simple-rerank.ts`
   - FatSecret boost may be too aggressive, causing FDC to rank lower
   - Consider reducing `WEIGHTS.SOURCE_FATSECRET` or adding FDC preference for this category

6. **Common Pitfalls (learned Feb 2026):**

   **`sortedFiltered` vs `filtered` trap:**
   - `filtered` = output of `filterCandidatesByTokens()` — **NOT SORTED** by score
   - `sortedFiltered` = explicitly sorted by score descending
   - When `simpleRerank` returns null, fallback checks `sortedFiltered[0].score >= 0.80`
   - If debugging shows candidates pass filters but pipeline still fails, check which array is used

   **Modifier filter over-blocking:**
   - `hasCriticalModifierMismatch` requires exact modifier text (e.g., "fat free") in candidate name
   - Products like Egg Beaters are nutritionally fat-free but don't say "fat free"
   - Substitute/replacer products are exempt from strict nonfat checks (fix applied Feb 2026)
   - Always check ALL three filters: `hasCriticalModifierMismatch`, `isReplacementMismatch`, `hasCoreTokenMismatch`

   **Two-layer failure pattern:**
   - When confidence = 0.0, check BOTH: (1) are candidates being filtered out? (2) are surviving candidates scoring below threshold?
   - A fix to one layer may reveal the second layer still blocks

---

## ⚠️ CRITICAL: Fix Scalability Principle

> **Every fix MUST be general/broad enough to apply to other ingredients that could suffer the same issue.**

### ❌ BAD Fixes (NOT scalable):
- Adding ingredient-specific exclusion rules like `"chinese five spice" → exclude "banana"`
- Hard-coding specific food names to block
- One-off exceptions for individual ingredients

### ✅ GOOD Fixes (scalable):
- **Core token mismatch improvements** - If food A is missing a core query token, block it for ALL queries
- **Scoring weight adjustments** - If token overlap scoring is too weak, improve it for all ingredients
- **Category detection patterns** - If "spice" category is being matched to "fruit", improve category detection
- **Data quality filters** - If nutritional data has impossible values, add validation that catches all bad data

### How to identify the right fix:
1. Ask: "Could other ingredients have this same problem?"
2. Ask: "Does this fix address the ROOT CAUSE or just the symptom?"
3. Ask: "If I add 1000 new ingredients, will this fix help prevent similar issues?"

**Example**: "Chinese five spice" → "Chinese Banana"
- ❌ BAD: Add exclusion `{query: ['five spice'], excludeIfContains: ['banana']}`
- ✅ GOOD: Fix core token mismatch logic - "banana" is NOT in query, so candidate should be rejected

---

## Phase 5: Implement Fix

### Safe Fixes (auto-proceed):
- Adding British→American synonyms in `ingredient-line.ts`
- Adding prep phrase stripping patterns
- ~~Adding specific category exclusions for obvious mismatches~~ **(AVOID - not scalable)**
- Fixing parsing regex for edge cases

### ⚠️ STOP AND ASK for these changes:
- Modifying scoring weights in `simple-rerank.ts`
- Changing confidence thresholds
- Modifying AI prompts in `ai-normalize.ts` or `ai-parse.ts`
- Adding exclusion rules that affect multiple ingredients
- Changes to core pipeline flow

---

## Phase 6: Test Fix in Isolation

1. Re-run debug script on the specific ingredient:
   ```powershell
   npx tsx src/scripts/check-cache-entry.ts "INGREDIENT_TEXT" --clear
   npx tsx src/scripts/debug-ingredient.ts "INGREDIENT_TEXT" --verbose
   ```

2. Verify:
   - ✅ Correct food is now selected
   - ✅ Nutrition values are reasonable
   - ✅ Confidence score is acceptable (≥0.80)

---

## Phase 7: Regression Test

1. Clear relevant mappings if needed:
   ```powershell
   # Clear just the affected ingredient's cache (preferred — keeps other mappings intact)
   npx tsx src/scripts/check-cache-entry.ts "INGREDIENT_TEXT" --clear

   # Or wipe all mapping caches for a full re-run
   npx tsx src/scripts/clear-all-cache.ts
   ```

2. Re-run pilot import:
   ```powershell
   $env:ENABLE_MAPPING_ANALYSIS='true'; npx tsx scripts/pilot-batch-import.ts --recipes 100
   ```

3. Compare results:
   - Previous success rate: X/Y (Z%)
   - New success rate: A/B (C%)
   - **If regression (C < Z): STOP AND ASK**

---

## Phase 8: Document Fix

1. Update `docs/mapping-fix-log.md` with new fix:
   ```markdown
   ### Fix N: [Title]
   | Issue | `"original ingredient"` → Wrong Result |
   |-------|----------------------------------------|
   | Root Cause | Why it failed |
   | Fix | What was changed |
   | Test | How to verify |
   ```

2. Update issue in `docs/mapping-validation-queue.md`:
   - Move from PENDING → RESOLVED
   - Add verification date and new accuracy %

---

## Phase 9: Expand (When Ready)

### ⚠️ STOP AND ASK when:
- Accuracy reaches 99%+ on current recipe set
- All HIGH severity issues resolved
- Ready to add more recipes with new keywords

### Expansion process:
1. Import more recipes with new keywords (e.g., "keto", "mediterranean")
2. Repeat phases 1-8 with expanded dataset
3. Track cumulative validated ingredients in cache

---

## Quick Reference Commands

| Task | Command |
|------|---------|
| Run pilot import | `$env:ENABLE_MAPPING_ANALYSIS='true'; npx tsx scripts/pilot-batch-import.ts --recipes 100` |
| Full pipeline debug | `npx tsx src/scripts/debug-ingredient.ts "1 cup honey" --verbose` |
| See candidates + scores | `npx tsx src/scripts/gather-candidates.ts "rice vinegar" --show-filtered` |
| Check serving cache | `npx tsx src/scripts/check-food-servings.ts "mayonnaise"` |
| Inspect & clear cache entry | `npx tsx src/scripts/check-cache-entry.ts "onion" --clear` |
| Wipe all mapping caches | `npx tsx src/scripts/clear-all-cache.ts` |
| Clear mappings (keep food cache) | `npx tsx scripts/clear-all-mappings.ts` |

---

## Key Documentation

- [Debugging Quickstart](./../docs/debugging-quickstart.md)
- [Mapping Fix Log](./../../docs/mapping-fix-log.md)
- [Pipeline Documentation](./../docs/ingredient-mapping-pipeline.md)
- [Validation Queue](./../../docs/mapping-validation-queue.md)
