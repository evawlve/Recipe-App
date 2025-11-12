# Next Steps: 82.3% → 87-89% P@1

## Current Situation
- **P@1**: 82.3% (47 failures)
- **Main Problems**:
  1. **Wrong food matches** (25 cases): Ketchup matching "tomato", Coconut Milk matching "2% milk"
  2. **Portion resolution** (18 cases): Volume units defaulting to 60g
  3. **Missing portions/aliases** (4 cases): "½ block tofu", "broccoli florets"

## Option 1: Fix Ranking Algorithm (Highest Impact, +3-4pp)

### Problem
Even with tiered popularity, wrong foods are winning:
- "tomato" → Ketchup (condiment should NEVER match whole food)
- "2% milk" → Coconut Milk (exact qualifier "2%" ignored)

### Root Cause
The ranking algorithm doesn't have strong enough:
1. **Condiment penalties**: Foods derived from base ingredients (ketchup from tomato) should rank much lower
2. **Exact qualifier matching**: "2%" in query MUST match "2%" in food name

### Proposed Fix
```typescript
// In src/lib/foods/rank.ts

// 1. Add derived-from-base penalty
const isCondimentOrDerivative = (food: string, query: string): boolean => {
  const derivativeMap = {
    'tomato': ['ketchup', 'tomato sauce', 'tomato paste'],
    'milk': ['coconut milk', 'oat milk', 'almond milk', 'soy milk'],
    'avocado': ['avocado oil'],
    'coconut': ['coconut oil'],
    'olive': ['olive oil'],
  };
  
  const queryWords = query.toLowerCase().split(/\s+/);
  for (const baseFood of queryWords) {
    if (derivativeMap[baseFood]) {
      const foodLower = food.toLowerCase();
      if (derivativeMap[baseFood].some(d => foodLower.includes(d))) {
        return true; // This is a derivative
      }
    }
  }
  return false;
};

// Apply heavy penalty for derivatives
let derivativePenalty = 0;
if (isCondimentOrDerivative(f.name, q)) {
  derivativePenalty = -2.0; // Very strong penalty
}

// 2. Strengthen exact qualifier matching
const extractExactQualifiers = (text: string): string[] => {
  const qualifiers: string[] = [];
  if (text.match(/\b2%\b/)) qualifiers.push('2%');
  if (text.match(/\b1%\b/)) qualifiers.push('1%');
  if (text.match(/\bskim\b|\bnonfat\b/i)) qualifiers.push('skim');
  if (text.match(/\bwhole\b/i)) qualifiers.push('whole');
  return qualifiers;
};

const queryQualifiers = extractExactQualifiers(q);
const foodQualifiers = extractExactQualifiers(f.name);

let qualifierPenalty = 0;
for (const qq of queryQualifiers) {
  if (!foodQualifiers.includes(qq)) {
    qualifierPenalty -= 1.5; // Strong penalty for missing exact qualifier
  }
}

// Add to final score
score += derivativePenalty + qualifierPenalty;
```

### Expected Impact
- **Fixed**: "tomato" won't match "ketchup" (-2.0 penalty too strong)
- **Fixed**: "2% milk" won't match "coconut milk" (-1.5 penalty for missing "2%")
- **Estimate**: +3-4pp (82.3% → 85-86%)

---

## Option 2: Fix Portion Resolution (Medium Impact, +2-3pp)

### Problem
Volume portions ("1 cup") defaulting to 60g when `densityGml` is missing.

### Solution
Add `densityGml` to all template foods that need it.

**Script**: `scripts/phase-e-add-density.ts`

```typescript
const DENSITY_VALUES = {
  'Cheese, cottage, lowfat, 2% milkfat': 0.94,  // 226g per cup
  'Oil, coconut': 0.92,  // 218g per cup
  'Oil, avocado': 0.92,  // 218g per cup
  'Oil, olive': 0.92,  // 216g per cup
  'Avocados, raw, California': 0.61,  // 146g per cup sliced
  'Cottage Cheese': 0.94,
  'Coconut Oil': 0.92,
  // ... etc for all template foods
};
```

### Expected Impact
- **Fixed**: 18 portion resolution failures
- **Estimate**: +2-3pp (82.3% → 84-85%)

---

## Option 3: Add Missing Aliases/Portions (Low Impact, +0.5-1pp)

### Problem
- "½ block tofu" → NO MATCH (missing portion)
- "broccoli florets" → NO MATCH (missing alias)

### Solution
```typescript
// Add FoodUnit
{ foodId: 'tofu_firm', label: '½ block', grams: 113 }
{ foodId: 'tofu_firm', label: 'block', grams: 226 }

// Add Alias
{ foodId: 'broccoli_raw', alias: 'broccoli florets' }
{ foodId: 'broccoli_raw', alias: 'florets' }
```

### Expected Impact
- **Fixed**: 4 NO MATCH cases
- **Estimate**: +0.5-1pp (82.3% → 82.8-83.3%)

---

## Recommended Sequence

### **Phase E Step 2: Fix Ranking Algorithm** (Do This First)
- Highest impact (+3-4pp)
- Solves the most egregious failures (ketchup, coconut milk)
- **Target**: 85-86% P@1

### **Phase E Step 3: Fix Portion Resolution**
- Medium impact (+2-3pp on top of Step 2)
- Solves volume portion issues
- **Target**: 87-89% P@1

### **Phase E Step 4: Add Missing Aliases/Portions**
- Polish (+0.5-1pp)
- Cleans up remaining NO MATCH cases
- **Final Target**: 88-90% P@1

---

## Next Actions
1. **Commit current progress** (82.3%, tiered popularity system)
2. **Implement Phase E Step 2** (ranking algorithm fixes)
3. **Test and iterate**
4. **Continue to Phase E Steps 3 and 4**

