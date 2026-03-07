# AI Nutrition Backfill — Handoff

## Problem

Some ingredients cannot be found in FatSecret or FDC APIs (e.g., niche branded products, specialty diet variations, or very specific compound foods). Currently, these fail silently with `0.00` confidence and no nutritional data.

## Proposed Solution: AI-Generated Nutritional Data

When the mapping pipeline exhausts all search + fallback strategies and still cannot find a suitable match, it should invoke an **AI nutrition backfill** that generates nutritional data from a capable LLM (e.g., GPT-4, Gemini Pro).

### How It Should Work

1. **Trigger**: After both initial mapping **and** fallback simplification fail (confidence = 0.00 or below threshold).

2. **Input to AI**: The original ingredient line, parsed quantity/unit, and any related base food (e.g., for "gluten-free salad seasoning" → use "salad seasoning" as a base reference).

3. **AI Output**: The LLM should generate a complete nutrition profile per 100g:
   - **Macros**: calories, protein, carbs, fat (required)
   - **Micros**: fiber, sugar, sodium, cholesterol, saturated fat, etc. (as many as possible)
   - **Confidence**: self-assessed confidence (0-1) in the data accuracy

4. **Storage**: The AI-generated nutrition data should be stored in a dedicated table (e.g., `AiGeneratedFood`) separate from validated API mappings, with:
   - A flag indicating it's AI-generated (not from FatSecret/FDC)
   - The LLM model used and prompt
   - An expiry/review date so humans can validate later

5. **Base Food Strategy**: When a dietary-modified variant is requested (e.g., "gluten-free salad seasoning"):
   - First, find the **base food** ("salad seasoning") via the normal pipeline
   - Pass the base food's macros to the AI as a reference
   - Ask the AI: "How would the nutrition change for a gluten-free variant?"
   - The AI adjusts the macros accordingly (usually minimal change for GF)

6. **Fat-Free Macro Verification**: When the query contains "fat free" and a candidate is found but doesn't explicitly say "fat free" in its name:
   - Check the candidate's actual fat content (per 100g)
   - If fat ≤ 1g/100g → treat as fat-free and accept the match
   - If fat > 1g/100g → reject the candidate (it's not actually fat free)
   - This replaces the current name-only `critical_modifier_mismatch` for fat-free queries

### Key Files to Modify

| File | Change |
|------|--------|
| `map-ingredient-with-fallback.ts` | Add AI backfill trigger after all fallbacks fail |
| NEW: `ai-nutrition-backfill.ts` | LLM call to generate nutrition data |
| `prisma/schema.prisma` | Add `AiGeneratedFood` model |
| `filter-candidates.ts` | Optional: macro-based fat-free validation |

### Edge Cases

- **Very obscure ingredients**: "Swerve" (erythritol brand) — AI should know common brands
- **Compound flavored products**: "strawberry banana greek yogurt" — already fixable via API
- **Measurement-dependent items**: "1 packet" — AI should handle standard packet sizes
- **Multiple dietary constraints**: "sugar-free gluten-free chocolate chips" — compound prefix

### Example AI Prompt Template

```
Generate nutritional data per 100g for the following food item:
Food: "{ingredient name}"
{base_food_context if available}

Return a JSON object with:
- calories (kcal)
- protein (g)
- carbs (g)  
- fat (g)
- fiber (g)
- sugar (g)
- sodium (mg)
- saturated_fat (g)
- cholesterol (mg)
- confidence (0-1, how confident you are in this data)
- notes (any caveats about the data)
```

### Priority

LOW — This is a safety net for the small percentage of ingredients that can't be found via API. The dietary-prefix stripping (Fix 59) already resolves most of these cases. The remaining gaps are truly niche products that affect very few recipes.
