# AI-Learned Prep Phrase Sync

> **Status**: ✅ Implemented (Jan 6, 2026)
> **Priority**: Medium - Improves normalization accuracy over time

---

## Problem

The `normalizeIngredientName()` function uses a **static list** of prep phrases from `data/fatsecret/normalization-rules.json`. When AI discovers new prep phrases (e.g., "freshly ground", "roughly torn") during ingredient normalization, they're stored in `AiNormalizeCache` but **never synced back** to the static rules.

This means:
1. First encounter of "1 cup freshly ground pepper" → AI strips "freshly ground"
2. Future encounters → Static parser does NOT strip it (unless AI is called again)

---

## Recommended Solution: Hybrid In-Memory Cache

**Why Hybrid?**
- **File-based sync** requires manual script execution
- **Per-request DB query** adds overhead
- **Hybrid** = cached in memory, refreshed once at pipeline start

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    At Pipeline Start                         │
│  1. Load static rules from normalization-rules.json          │
│  2. Query AiNormalizeCache for unique prepPhrases            │
│  3. Merge into in-memory Set (deduplicated)                  │
│  4. Cache for duration of pipeline run                       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              During Ingredient Normalization                 │
│  normalizeIngredientName() uses merged in-memory cache       │
│  No DB queries per ingredient                                │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### 1. Add Phrase Aggregation Query

Create function to aggregate unique prep phrases from `AiNormalizeCache`:

```typescript
// src/lib/fatsecret/normalization-rules.ts

export async function getAiLearnedPrepPhrases(): Promise<string[]> {
    const cached = await prisma.aiNormalizeCache.findMany({
        select: { prepPhrases: true },
    });
    
    const allPhrases = new Set<string>();
    for (const row of cached) {
        const phrases = row.prepPhrases as string[];
        phrases.forEach(p => allPhrases.add(p.toLowerCase().trim()));
    }
    
    return [...allPhrases];
}
```

### 2. Add Refresh Mechanism

```typescript
// src/lib/fatsecret/normalization-rules.ts

let mergedPrepPhrases: string[] | null = null;

export async function refreshNormalizationRules(): Promise<void> {
    const staticRules = readRulesFile();
    const aiPhrases = await getAiLearnedPrepPhrases();
    
    // Merge and deduplicate
    const combined = new Set([
        ...staticRules.prep_phrases,
        ...aiPhrases,
    ]);
    
    mergedPrepPhrases = [...combined];
    logger.info('normalization_rules.refreshed', { 
        static: staticRules.prep_phrases.length,
        aiLearned: aiPhrases.length,
        merged: mergedPrepPhrases.length,
    });
}

export function getMergedPrepPhrases(): string[] {
    return mergedPrepPhrases || readRulesFile().prep_phrases;
}
```

### 3. Update `normalizeIngredientName()`

Change from using static rules to merged rules:

```typescript
// In normalizeIngredientName():
- for (const phrase of [...rules.prep_phrases, ...rules.size_phrases]) {
+ for (const phrase of [...getMergedPrepPhrases(), ...rules.size_phrases]) {
```

### 4. Call at Pipeline Start

**Pilot Batch Import** (`scripts/pilot-batch-import.ts`):
```typescript
import { refreshNormalizationRules } from '../src/lib/fatsecret/normalization-rules';

async function main() {
    await refreshNormalizationRules(); // Refresh before processing
    // ... rest of import
}
```

**Production** (`src/lib/nutrition/auto-map.ts`):
```typescript
export async function autoMapIngredients(recipeId: string) {
    await refreshNormalizationRules(); // Refresh before mapping
    // ... rest of function
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/fatsecret/normalization-rules.ts` | Add `getAiLearnedPrepPhrases()`, `refreshNormalizationRules()`, `getMergedPrepPhrases()` |
| `scripts/pilot-batch-import.ts` | Call `refreshNormalizationRules()` at start |
| `src/lib/nutrition/auto-map.ts` | Call `refreshNormalizationRules()` at start |

---

## Verification

After implementation:

1. Run pilot import with new ingredient: "1 cup freshly grated parmesan"
2. AI returns `prepPhrases: ["freshly grated"]`
3. Clear ValidatedMapping for that ingredient
4. Run again - verify static parser now strips "freshly grated" (from merged cache)

---

## Edge Cases

1. **Empty AiNormalizeCache**: Use static rules only (graceful fallback)
2. **Duplicate phrases**: Set automatically deduplicates
3. **Regex vs literal**: AI phrases are literal strings; static file has regex patterns - handle both
4. **Case sensitivity**: Normalize to lowercase before merging
