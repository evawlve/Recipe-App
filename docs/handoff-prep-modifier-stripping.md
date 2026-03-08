# Handoff: Prep Modifier Stripping for Rerank Scoring

## Problem

When a recipe ingredient contains prep modifiers like **"cut in strips"**, **"finely diced"**, **"roughly chopped"**, etc., these words pollute the scoring query in `simpleRerank`. This reduces the score gap between correct and incorrect candidates, lowering confidence below threshold.

### Concrete Example

**Input:** `"0.5 cup green peppers cut in strips"`

The rerank query (L794 of `map-ingredient-with-fallback.ts`) becomes `"green peppers cut in strips"` — the "cut in strips" tokens cause:
- Lower token overlap with "bell green raw peppers" (missing "cut", "strips" tokens)
- Higher token overlap with "TRI COLOR BELL PEPPER STRIPS" (matches "strips")
- Score gap shrinks from 0.122 → 0.043, confidence drops from 0.92 → 0.72

We currently work around this with a lowered confidence threshold (0.70), but stripping prep modifiers would be the cleaner, more robust fix.

## Proposed Solution

Strip prep modifiers from the query **before** passing it to `simpleRerank`, so scoring operates on the food identity only (e.g., `"green peppers"` instead of `"green peppers cut in strips"`).

### Two Approaches

#### Option A: Use `canonicalBase` from AI normalization (preferred if available)
- `canonicalBase` is set in `ai-normalize.ts` L227
- Strips prep/size words but **preserves** nutrition-affecting modifiers ("fat free milk" stays as-is)
- Available at L643 of `map-ingredient-with-fallback.ts` as `aiCanonicalBase`
- **Caveat:** Only available when AI normalization fires. The normalize gate at L631 often SKIPS the LLM call (`high_confidence_match` reason) — in which case `aiCanonicalBase` is undefined

#### Option B: Local prep-word stripping (always available)
- Build a static list of prep modifier words/phrases to strip from the rerank query
- Apply it in `simpleRerank` or at the call site (L870)
- This is simpler and always available, but risk of stripping words that are part of the food identity

#### Recommended: Hybrid
1. If `aiCanonicalBase` is available, use it as the rerank query
2. Otherwise, fall back to local prep-word stripping

## Key Files and Locations

### Where the rerank query is constructed
```
map-ingredient-with-fallback.ts L794:
    const searchQuery = parsed?.name || normalizedName;

L870:
    const rerankResult = simpleRerank(searchQuery, rerankCandidates, aiNutritionEstimate, trimmed);
```

The `searchQuery` (L794) is `parsed?.name` which comes from the ingredient parser and **includes** prep modifiers. The 4th argument `trimmed` is the full raw line (used for modifier constraint extraction, not scoring).

### Where scoring uses the query
```
simple-rerank.ts L1078:
    const baseScore = computeSimpleScore(c, query);

L748:
    function computeSimpleScore(candidate: RerankCandidate, query: string): number {
```

The `query` parameter flows through to `isExactMatch`, `computeTokenOverlap`, and the extra-token penalty at L765-780. All of these would benefit from a cleaner query.

### Where `canonicalBase` is available
```
map-ingredient-with-fallback.ts L643:
    aiCanonicalBase = aiHint.canonicalBase;
```

But this only fires when the normalize gate at L631 calls the LLM. The gate skips when there's a `high_confidence_match` (16+ candidates found with good overlap).

### `simpleRerank` function signature
```typescript
// simple-rerank.ts L1038
export function simpleRerank(
    query: string,                    // ← THIS is what needs prep stripping
    candidates: RerankCandidate[],
    aiNutritionEstimate?: { ... },
    rawLine?: string                  // Full raw line for modifier constraints
): { winner: RerankCandidate; confidence: number; reason: string } | null
```

## Prep Modifier Words to Strip

These words describe preparation, NOT food identity. Safe to strip from rerank query:

**Cutting/shape:** cut, diced, chopped, minced, sliced, julienned, cubed, halved, quartered, shredded, grated, crushed, mashed, torn, strips, chunks, pieces, rings, wedges

**Prep actions:** peeled, seeded, cored, deveined, trimmed, pitted, husked, shelled, stemmed, deseeded

**Size qualifiers:** finely, roughly, coarsely, thinly, thickly, small, large (when used as prep, not food size)

**Freshness (already stripped by parser):** fresh, freshly

## ⚠️ Edge Cases — Do NOT Strip

- **"dried"** — changes the food identity (dried tomatoes ≠ tomatoes)
- **"ground"** — changes identity (ground beef ≠ beef, ground cinnamon ≠ cinnamon stick)
- **"powdered"** — changes identity (powdered sugar ≠ sugar)
- **"roasted"** when part of product name ("fire roasted tomatoes", "roasted red peppers")
- **"toasted"** can change identity (toasted sesame oil ≠ sesame oil)
- **any word that appears in CORE_FOOD_TOKENS** (L897 of filter-candidates.ts) — these are food identity words

## Verification

Test cases that should improve with this fix:
1. `"0.5 cup green peppers cut in strips"` → should map to green pepper with higher confidence
2. `"1 cup finely diced onion"` → should map to onion without "diced" affecting score
3. `"2 stalks celery sliced"` → should map to celery without "sliced" in query

Test cases that should NOT change (prep word IS part of identity):
1. `"1 can fire roasted tomatoes"` → must still match "fire roasted tomatoes"
2. `"2 tbsp ground cinnamon"` → must still match "ground cinnamon"
3. `"1 cup dried cranberries"` → must still match "dried cranberries"

## How to Test

```bash
# Run with score breakdown to see the effect
$env:DEBUG_RERANK_SCORES='true'
npx tsx scripts/debug-mapping-pipeline.ts "0.5 cup green peppers cut in strips" --debug-steps --skip-cache

# Production mode verification (clear caches first!)
npx tsx scripts/clear-all-mappings.ts
npx tsx scripts/debug-mapping-pipeline.ts "0.5 cup green peppers cut in strips"
```
