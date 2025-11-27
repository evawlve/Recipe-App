# Root Cause Analysis: Why AI Parser Didn't Catch "tsps ginger"

## The Issue

You're absolutely right to question this! The AI normalizer (`aiNormalizeIngredient`) **should** have caught these issues, but it's currently only invoked in **specific failure scenarios**, not during initial parsing.

## Current Flow

### 1. **Recipe Import** (`batch-recipe-import.ts`)
```typescript:scripts/batch-recipe-import.ts
const parsed = parseIngredientLine(ingredientLine);  // ← Rule-based parser
const name = parsed?.name ?? ingredientLine;         // ← FALLBACK TO RAW LINE
await prisma.ingredient.create({
  data: { recipeId, name, qty, unit }
});
```

**Problem**: If the parser fails to extract a name (returns `null`), the **entire raw line becomes the ingredient name**, including measurements.

### 2. **Auto-Mapping** (`auto-map.ts`)
```typescript
// Uses the stored ingredient.name directly
const result = await mapIngredientWithFatsecret(ingredient.name, ...);
```

**Problem**: The AI normalizer is only called in `map-ingredient.ts` during the **retry loop** (line 666), which only triggers if:
- First search attempt fails
- OR confidence is too low

For "tsps ginger" or "tbsps cornstarch", the FatSecret search might actually return *some* result (just not a good one), so the retry loop never triggers and AI normalization never happens.

## Why This Happens

### The Parsing Failure

Let me test `parseIngredientLine("tsps ginger")`:

```typescript
// Input: "tsps ginger"
// Tokens: ["tsps", "ginger"]

// Parser logic:
// 1. "tsps" is recognized as a unit (teaspoons)
// 2. But there's NO quantity before it!
// 3. Parser fails → returns null
// 4. Fallback: name = "tsps ginger" (raw line)
```

The parser expects: `<qty> <unit> <name>` (e.g., "2 tsps ginger")  
But gets: `<unit> <name>` (e.g., "tsps ginger")

While the parser *does* handle unit-first cases like "pinch of salt", it doesn't recognize "tsps" as a default-quantity unit, so it fails.

## What We Need: A Learning System

You're thinking exactly right! We should build a system that:

1. **Learns from failures** automatically
2. **Stores cleanup patterns** in the database
3. **Applies them proactively** before searching

Here's my proposed architecture:

---

## Proposed Solution: Ingredient Cleanup Patterns System

### Database Schema

```prisma
model IngredientCleanupPattern {
  id            String   @id @default(cuid())
  pattern       String   // Regex or simple string
  patternType   String   // 'measurement_prefix', 'prep_phrase', 'parsing_artifact'
  replacement   String   // What to replace it with (often empty string)
  confidence    Float    // How confident we are this is a valid cleanup
  source        String   // 'ai_learned', 'manual', 'auto_detected'
  usageCount    Int      @default(0)
  successRate   Float?   // Track how often this pattern helps mapping succeed
  createdAt     DateTime @default(now())
  lastUsed      DateTime @default(now())
  
  @@index([patternType])
  @@index([source])
}
```

### Implementation Flow

```typescript
// In auto-map.ts, BEFORE calling mapIngredientWithFatsecret:

async function cleanIngredientName(rawName: string): Promise<{
  cleaned: string;
  appliedPatterns: string[];
}> {
  // 1. Fetch active cleanup patterns from DB
  const patterns = await prisma.ingredientCleanupPattern.findMany({
    where: { confidence: { gte: 0.7 } },
    orderBy: { usageCount: 'desc' }
  });
  
  let cleaned = rawName;
  const appliedPatterns: string[] = [];
  
  // 2. Apply patterns in order
  for (const pattern of patterns) {
    const regex = new RegExp(pattern.pattern, 'gi');
    if (regex.test(cleaned)) {
      cleaned = cleaned.replace(regex, pattern.replacement).trim();
      appliedPatterns.push(pattern.id);
      
      // Update usage stats
      await prisma.ingredientCleanupPattern.update({
        where: { id: pattern.id },
        data: {
          usageCount: { increment: 1 },
          lastUsed: new Date()
        }
      });
    }
  }
  
  // 3. Clean up whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return { cleaned, appliedPatterns };
}
```

### AI-Powered Pattern Learning

```typescript
// After a mapping fails, use AI to suggest cleanup patterns:

async function learnFromFailure(
  rawName: string,
  mappingFailed: boolean
): Promise<void> {
  const aiResult = await aiNormalizeIngredient(rawName);
  
  if (aiResult.status === 'success') {
    // Extract patterns from AI suggestions
    const patterns: string[] = [];
    
    // Check for measurements in name
    const measRegex = /^(\d+\s*)?(tbsps?|tsps?|cups?|oz|lb)\s+/i;
    if (measRegex.test(rawName)) {
      patterns.push({
        pattern: '^(\\d+\\s*)?(tbsps?|tsps?|cups?|oz|lb)\\s+',
        patternType: 'measurement_prefix',
        replacement: '',
        source: 'ai_learned'
      });
    }
    
    // Learn from prep_phrases
    for (const prep of aiResult.prepPhrases) {
      if (rawName.includes(prep)) {
        patterns.push({
          pattern: `\\b${escapeRegex(prep)}\\b`,
          patternType: 'prep_phrase',
          replacement: '',
          source: 'ai_learned'
        });
      }
    }
    
    // Store new patterns (with deduplication)
    for (const p of patterns) {
      await prisma.ingredientCleanupPattern.upsert({
        where: { pattern: p.pattern },
        update: {
          confidence: { increment: 0.1 }, // Increase confidence
          usageCount: { increment: 1 }
        },
        create: {
          ...p,
          confidence: 0.8,
          usageCount: 1
        }
      });
    }
  }
}
```

### Feedback Loop

```typescript
// After successful mapping with cleanup:

async function trackCleanupSuccess(
  patternIds: string[],
  mappingSucceeded: boolean
) {
  for (const patternId of patternIds) {
    const pattern = await prisma.ingredientCleanupPattern.findUnique({
      where: { id: patternId }
    });
    
    if (pattern) {
      const newSuccessRate = calculateSuccessRate(
        pattern.successRate,
        pattern.usageCount,
        mappingSucceeded
      );
      
      await prisma.ingredientCleanupPattern.update({
        where: { id: patternId },
        data: { 
          successRate: newSuccessRate,
          // Increase confidence if working well
          confidence: newSuccessRate > 0.9 ? 
            Math.min(pattern.confidence + 0.05, 1.0) : 
            pattern.confidence
        }
      });
    }
  }
}
```

---

## Quick Win: Fix the Parser Fallback

**Immediate improvement** (before building the learning system):

```typescript:scripts/batch-recipe-import.ts
for (const ingredientLine of ingredients) {
  if (!ingredientLine) continue;
  
  const parsed = parseIngredientLine(ingredientLine);
  
  // NEW: If parsing failed, try AI normalization or basic cleanup
  let name: string;
  let qty: number;
  let unit: string;
  
  if (parsed) {
    name = parsed.name;
    qty = parsed.qty;
    unit = parsed.unit ?? '';
  } else {
    // Parsing failed - apply basic cleanup before storing
    name = basicCleanup(ingredientLine);
    qty = 1;
    unit = '';
    
    // Log for learning
    console.warn(`Parser failed for: "${ingredientLine}" → Using cleaned: "${name}"`);
  }
  
  await prisma.ingredient.create({
    data: { recipeId: created.id, name, qty, unit }
  });
}

function basicCleanup(raw: string): string {
  // Remove leading measurements
  let cleaned = raw.replace(/^(\d+\s*)?(tbsps?|tsps?|cups?|oz|lb|grams?|kg)\s+/i, '');
  
  // Remove common prep phrases
  cleaned = cleaned.replace(/\b(bone and skin removed|cut into|yields|divided)\b/gi, '');
  
  return cleaned.replace(/\s+/g, ' ').trim();
}
```

---

## Summary

**Current State**:
- ❌ AI normalizer exists but only runs during retry loop
- ❌ Parser fallback stores raw lines as ingredient names
- ❌ No learning from failures

**Proposed State**:
- ✅ Cleanup patterns stored in DB
- ✅ Patterns applied proactively before mapping
- ✅ AI learns new patterns from failures
- ✅ Success tracking improves pattern confidence
- ✅ System gets smarter over time

The key insight: **Move AI normalization EARLIER in the pipeline** (during import or at start of auto-mapping), not just as a last-resort retry.

Would you like me to implement this learning system?
