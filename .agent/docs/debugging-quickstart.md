# Debugging Quick-Start Guide: Ingredient Mapping Pipeline

> **Purpose**: Systematic approach to diagnosing and fixing incorrect ingredient mappings.

---

## Overview

When an ingredient maps incorrectly, **don't immediately add a rule to fix just that ingredient**. First diagnose *why* it failed—the issue may be systemic.

### Key Concept: The Search Query Chain

```
Raw Line → Parser → AI Normalize → normalizedName → API Search → Candidates → Filter → Score → Winner
```

The `normalizedName` from AI normalization becomes the **search query** sent to FatSecret/FDC APIs. If something goes wrong here, everything downstream fails.

---

## Log Files

| File | Use For |
|------|---------|
| `logs/mapping-summary-*.txt` | Quick scan: spot incorrect mappings by reading food name + macros |
| `logs/mapping-analysis-*.json` | Deep dive: see top 5 candidates and their scores for each ingredient |

### Enable Logging

```bash
$env:ENABLE_MAPPING_ANALYSIS='true'; npm run pilot-import 100
```

---

## Common Issue Patterns

### 1. Modifier Stripping

**Symptom**: "unsweetened coconut milk" → "Coconut Cream (230 kcal)"

**Root Cause**: AI normalize stripped "unsweetened" modifier.

**Where to Fix**: `ai-normalize.ts` system prompt - add modifier to preserved list.

---

### 2. Wrong Positional Candidate

**Symptom**: "strawberry" → "Strawberry Smoothie"

**Root Cause**: FatSecret returned "Strawberry Smoothie" in position 1.

**Where to Fix**: 
- `filter-candidates.ts` - Add unexpected dish term penalty
- `simple-rerank.ts` - Adjust scoring weights

---

### 3. Missing Query Terms

**Symptom**: "tomato salsa" → "Roma Tomato"

**Root Cause**: Selected candidate missing key word "salsa" from query.

**Where to Fix**: `simple-rerank.ts` - Missing query term penalty already exists, may need weight adjustment.

---

### 4. Macro Sanity Failure

**Symptom**: "fresh strawberries" → product with 350 kcal/100g

**Root Cause**: `hasSuspiciousMacros()` not detecting the issue.

**Where to Fix**: `filter-candidates.ts` - Add or adjust macro profile.

---

### 5. British/Regional Terms

**Symptom**: "single cream" → LOW_CONF or wrong product

**Root Cause**: Term not in synonym list.

**Where to Fix**: `gather-candidates.ts` - `BRITISH_TO_AMERICAN` dictionary.

---

### 6. Serving Selection Failure

**Symptom**: Correct food selected but wrong calories, or fallback to unexpected lower-ranked food.

**Example**: `"4 oz sugar substitute"` → correct 0-cal food scored #1, but falls back to 300-cal generic.

**Root Cause**: Winner lacks weight servings (g/oz), causing hydration failure and candidate fallback.

**Where to Fix**: 
- `ai-backfill.ts` - `backfillWeightServing()` creates 100g serving
- `map-ingredient-with-fallback.ts` - Step 5a tries weight backfill before candidate fallback

**Debug Command**:
```bash
npx ts-node scripts/check-serving-data.ts --food-id "1269847"
```

---

## Systematic Debugging Workflow

### Step 1: Find Issue in Summary

Scan `mapping-summary-*.txt` for:
- `[LOW_CONF]` - Low confidence matches
- `[HIGH_KCAL]` - Unusually high calories  
- `[KCAL_CHECK]` - Flagged for review
- `[COMPLEX_PRODUCT]` - Multi-ingredient product

**Example finding**:
```
✗ [0.00] "3 fl oz single cream" → "" [LOW_CONF]
```

---

### Step 2: Look Up in Analysis File

Search `mapping-analysis-*.json` for the raw ingredient:

```json
{
  "rawIngredient": "3 fl oz single cream",
  "topCandidates": [
    {"rank": 1, "foodName": "Ice Cream", "score": 0.8},
    {"rank": 2, "foodName": "Whipped Cream", "score": 0.7}
  ],
  "selectedCandidate": null,
  "failureReason": "no_candidates_found"
}
```

**Key questions**:
- What candidates were gathered?
- What was filtered out?
- What was the winning score?

---

### Step 3: Run Debug Script

```bash
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/debug-mapping-issue.ts --ingredient "3 fl oz single cream"
```

This shows:
1. **AI Normalized Name** - What search query was used
2. **Raw API Results** - What FatSecret/FDC actually returned
3. **Post-Filter Candidates** - What survived filtering
4. **Scored Candidates** - Final rankings with score breakdown

---

### Step 4: Compare Pre vs Post Scoring

| Stage | What to Check |
|-------|---------------|
| Raw API | Is the correct food even in the results? |
| Post-Filter | Was the correct food filtered out incorrectly? |
| Post-Score | Is the correct food scored lower than wrong candidates? |

---

### Step 5: Diagnose Root Cause

| If the correct food... | The problem is in... |
|------------------------|---------------------|
| Never appears in API results | AI normalization or search query building |
| Appears but gets filtered out | `filter-candidates.ts` rules |
| Appears but ranks low | `simple-rerank.ts` scoring weights |
| Gets wrong macros | Food cache data or serving selection |

---

## Using the Debug Script

### Debug a Full Ingredient Line

```bash
npx ts-node scripts/debug-mapping-issue.ts --ingredient "1 cup unsweetened coconut milk"
```

### Debug Just a Search Term

```bash
npx ts-node scripts/debug-mapping-issue.ts --search "light cream"
```

### Look Up from Analysis Log

```bash
npx ts-node scripts/debug-mapping-issue.ts --from-log "mapping-analysis-2026-01-05.json" --index 5
```

### Check Serving Data

When serving selection fails (e.g., weight unit request falls back to wrong food):

```bash
# Check specific food by ID
npx ts-node scripts/check-serving-data.ts --food-id "1269847"

# Search foods by name
npx ts-node scripts/check-serving-data.ts --food-name "sweetener"
```

Shows: available servings, capability flags (weight/volume support), and suggested fixes.

---

## Fix Categories

| Issue Type | File to Modify | Example |
|------------|----------------|---------|
| AI strips important modifier | `ai-normalize.ts` | Add "unsweetened" to preserved modifiers |
| British term unknown | `gather-candidates.ts` | Add to `BRITISH_TO_AMERICAN` |
| Wrong food selected | `simple-rerank.ts` | Adjust scoring weights |
| Correct food filtered out | `filter-candidates.ts` | Adjust filter rules |
| Macro values unrealistic | `filter-candidates.ts` | Add macro profile |
| Specific exclusion needed | `filter-candidates.ts` | Add to `CATEGORY_EXCLUSIONS` |
| Serving selection failure | `ai-backfill.ts` | Add weight/volume backfill |

---

## Golden Rule

**Before adding a specific fix, ask**: "Is this a one-off edge case, or could the same issue affect other ingredients?"

- If **systemic**, fix the underlying algorithm
- If **edge case**, add a targeted rule with a comment explaining why
