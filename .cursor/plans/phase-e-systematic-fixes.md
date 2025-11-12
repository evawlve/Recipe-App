# Phase E: Systematic Fixes to Reach 87-89% P@1

## Goal
Fix the 4 root causes of remaining failures to improve P@1 from 82.3% → 87-89%

## Root Cause Analysis

### 1. Portion Resolution Issues (~40% of failures)
**Problem**: Right food found, wrong grams calculated
- "1 cup cottage cheese" → 60g instead of 226g
- "1 cup coconut oil" → 54.6g instead of 218g

**Root Cause**: Missing `densityGml` or FoodUnit entries for volume portions

**Fix**:
```typescript
// Option A: Add densityGml to all template foods
Cottage Cheese: densityGml = 0.94
Coconut Oil: densityGml = 0.92

// Option B: Add explicit FoodUnit entries
FoodUnit: { label: "1 cup", grams: 226 } // for cottage cheese
FoodUnit: { label: "1 cup", grams: 218 } // for coconut oil
```

**Implementation**: Audit all template foods, add missing densityGml values

---

### 2. Over-Generalized Template Food Popularity (~25% of failures)
**Problem**: Condiments ranking too high
- "4 slices tomato" → Finding Ketchup (popularity=1000)
- "2% milk" → Finding Coconut Milk (popularity=1000)

**Root Cause**: Boosted ALL template foods to popularity=1000

**Fix**: Selective popularity boost
```typescript
// Boost only PRIMARY ingredients
const PRIMARY_FOODS = [
  'meat', 'dairy', 'grain', 'legume', 'veg', 'fruit'  
];

// Keep condiments/derivatives at normal popularity
const LOW_PRIORITY = [
  'ketchup', 'mustard', 'hot sauce',
  'coconut milk', 'oat milk', 'almond milk' // derivatives
];

// Strategy:
// - Primary whole foods: popularity = 1000
// - Derivative products: popularity = 500
// - Condiments/sauces: popularity = 100
```

**Implementation**: Create tiered popularity system

---

### 3. Missing Foods/Aliases (~20% of failures)
**Problem**: Food doesn't exist or lacks alias
- "½ block tofu" → NO MATCH (missing "block" portion)
- "1 cup broccoli florets" → NO MATCH (missing "florets" alias)

**Root Cause**: Coverage gaps

**Fix**: Add missing aliases and portion types
```typescript
// Add aliases
FoodAlias: { foodId: 'broccoli_raw', alias: 'broccoli florets' }
FoodAlias: { foodId: 'broccoli_raw', alias: 'florets' }

// Add piece portions
FoodUnit: { foodId: 'tofu_firm', label: '½ block', grams: 113 }
FoodUnit: { foodId: 'tofu_firm', label: 'block', grams: 226 }
```

**Implementation**: Systematic alias/portion audit

---

### 4. State Matching Issues (~15% of failures)
**Problem**: Cooked vs raw confusion
- "1 cup salmon, cooked" → Finding raw salmon (140g vs 240g)
- "1 cup ground beef, cooked" → Finding raw beef

**Root Cause**: Ranking doesn't penalize state mismatches

**Fix**: Enhance state matching in ranking algorithm
```typescript
// In src/lib/foods/rank.ts
const stateBoost = calculateStateMatch(query, food);

function calculateStateMatch(query: string, food: Food): number {
  const queryState = extractState(query); // "cooked", "raw", etc.
  const foodState = extractState(food.name);
  
  if (queryState && foodState) {
    if (queryState === foodState) return 0.3; // boost match
    else return -0.5; // penalty for mismatch
  }
  return 0; // no penalty if state unclear
}
```

**Implementation**: Strengthen existing stateBoost logic

---

## Implementation Plan

### Step 1: Fix Template Food Popularity (Tiered System)
**Script**: `scripts/phase-e-fix-popularity.ts`

```typescript
const POPULARITY_TIERS = {
  primary: 1000,      // Whole foods: chicken, milk, rice, eggs
  derivative: 500,    // Processed/alternatives: oat milk, tofu
  condiment: 100,     // Sauces, seasonings: ketchup, mustard
  specialty: 50       // Uncommon: gochujang, nutritional yeast
};
```

**Expected Impact**: +2-3pp (fixes ketchup/coconut milk issues)

---

### Step 2: Add Missing densityGml Values
**Script**: `scripts/phase-e-add-density.ts`

Audit all template foods, add missing densityGml:
```typescript
const DENSITY_VALUES = {
  'Cottage Cheese': 0.94,
  'Coconut Oil': 0.92,
  'Olive Oil': 0.92,
  'Greek Yogurt': 1.05,
  'Sour Cream': 0.96,
  // ... etc
};
```

**Expected Impact**: +1-2pp (fixes volume portion issues)

---

### Step 3: Add Missing Aliases and Portions
**Script**: `scripts/phase-e-add-aliases-portions.ts`

```typescript
const MISSING_ALIASES = [
  { food: 'Broccoli, Raw', aliases: ['broccoli florets', 'florets'] },
  { food: 'Spinach, Raw', aliases: ['spinach leaves', 'baby spinach'] },
  // ... etc
];

const MISSING_PORTIONS = [
  { food: 'Tofu, Firm', portions: [
    { label: '½ block', grams: 113 },
    { label: 'block', grams: 226 },
  ]},
  // ... etc
];
```

**Expected Impact**: +1-2pp (reduces NO MATCH cases)

---

### Step 4: Strengthen State Matching
**File**: `src/lib/foods/rank.ts`

Increase state mismatch penalty from -0.3 to -0.8:
```typescript
// Current
if (queryState !== foodState) penalty = -0.3;

// New
if (queryState !== foodState) penalty = -0.8;
```

**Expected Impact**: +1pp (fixes cooked vs raw issues)

---

## Success Metrics

### Target
- **P@1**: 87-89% (+5-7pp from current 82.3%)
- **Failures**: 30-35 cases (down from 47)
- **MAE**: <60g (down from 65.2g)

### Validation
1. Run `npm run eval` after each step
2. Track progress in reports/
3. Identify remaining failure patterns

---

## Timeline
1. Step 1 (Popularity): 15 min
2. Step 2 (Density): 20 min
3. Step 3 (Aliases/Portions): 20 min
4. Step 4 (State Matching): 10 min
5. Testing & Iteration: 30 min

**Total**: ~90 minutes to 87-89% P@1

