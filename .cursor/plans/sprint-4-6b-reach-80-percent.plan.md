# Sprint 4.6B: Reach 80%+ P@1 - Comprehensive Fix Plan

## Current Status

- **P@1**: 72.8% (193/265 correct)
- **Target**: 80%+ (212+/265 correct)
- **Gap**: 19+ cases to fix (~7.2pp)
- **Failures**: 72 total (32 NO MATCH, 40 WRONG MATCH)

## Root Cause Analysis

### Problem A: Portion Resolution Bugs (10+ cases, ~4pp impact)

**Issue**: Foods are resolving to incorrect portions (60g instead of 240g for "1 cup")

**Root Causes**:

1. **Missing FoodUnit entries**: Template foods we created don't have FoodUnit table entries
2. **Insufficient categoryId matching**: Foods like "Heavy Cream" have category "dairy" but the density table lookup requires "liquid" in the category string
3. **Fallback chain incomplete**: When FoodUnit lookup fails, density fallback requires exact category matches

**Affected Cases**:

- "1 cup milk" → 60g instead of 244g (184g error)
- "1 cup heavy cream" → 59.4g instead of 238g (178.6g error)
- "1 cup cottage cheese" → 60g instead of 226g (166g error)
- "1 cup coconut oil" → 54.6g instead of 218g (163.4g error)
- "1 cup sweet potato, mashed" → 48g instead of 200g (152g error)
- "1 cup salmon, cooked" → 63g instead of 240g (177g error)
- "1 cup skim milk", "1 cup whole milk", "1½ cups milk" → all portion errors

**Solution Path**:

```
eval/run.ts (lines 220-234) shows density fallback logic:
- If resolvedGrams == null && densityGml exists
- Uses CUP_ML=240, TBSP_ML=14.787, TSP_ML=4.929
- Calculates: grams = volume_ml * densityGml

The issue: densityGml is null or not being used properly
```

### Problem B: Missing Foods (32 cases, ~12pp potential)

**High-Impact Missing Foods** (from eval analysis):

1. Chicken drumsticks (176g error) - NOTE: Food may exist but not matching plural
2. Chocolate chips (170g error)
3. Pasta, dry (170g error)
4. Flax seeds (168g error)
5. Hemp seeds (154g error)
6. Red bell pepper (149g error)
7. Many others in "NO MATCH" category

**Why They're Missing**:

- Not in template seeds
- Not imported from USDA
- Insufficient aliases

### Problem C: Wrong Category Matches (21 cases, ~8pp potential)

**High-Impact Wrong Matches**:

1. "milk" queries → Eggnog mix, lowfat milk (not whole milk)
2. "greek yogurt" → Branded Chobani (not plain nonfat)
3. "mustard" → Mustard spinach vegetable
4. "oat milk" → Chocolate candy
5. "tomato, diced" → Tomato sauce (should be raw tomato)
6. "avocado, sliced" → Avocado oil

**Why Ranking Fails**:

- Category penalties not strong enough (-0.8 for milk/cheese still allows Eggnog)
- Preparation state matching not catching "prepared" vs "raw" mismatches
- Brand preferences overriding plain/generic matches

---

## Implementation Plan

### Phase A: Fix Portion Resolution (Priority 1 - ~4pp impact)

**A.1: Add FoodUnit Entries for Template Foods**

File: `scripts/fix-template-food-portions.ts` (NEW)

**Goal**: Add standard FoodUnit entries to all template foods

**Target Foods**:

- Heavy Cream, Sesame Oil, Fage Greek Yogurt, Sweet Potato Mashed
- Ketchup, Vinegar, Sriracha, Baking Powder/Soda, Vanilla Extract
- Rice Vinegar, Fish Sauce, Coconut Milk, Miso Paste, Mirin, Gochujang, Gochugaru, Curry Paste

**Standard Units to Add**:

```typescript
const STANDARD_PORTIONS = {
  liquid: [
    { label: "cup", grams: 240 },
    { label: "tbsp", grams: 15 },
    { label: "tsp", grams: 5 }
  ],
  paste: [
    { label: "cup", grams: 240 },
    { label: "tbsp", grams: 17 },
    { label: "tsp", grams: 6 }
  ],
  powder: [
    { label: "cup", grams: 120 },
    { label: "tbsp", grams: 8 },
    { label: "tsp", grams: 2.6 }
  ],
  solid: [
    { label: "cup", grams: 150 },  // mashed/cooked vegetables
    { label: "tbsp", grams: 15 }
  ]
};
```

**Implementation**:

```typescript
// For each template food:
// 1. Identify type (liquid/paste/powder/solid)
// 2. Add appropriate FoodUnit entries
// 3. Verify densityGml is set correctly

// Examples:
// Heavy Cream (liquid): densityGml = 0.99, units = liquid portions
// Miso Paste (paste): densityGml = 1.04, units = paste portions
// Baking Powder (powder): densityGml = ~0.96, units = powder portions
```

**Expected Impact**: Fix 6-8 portion error cases → +2-3pp

---

**A.2: Improve Density Fallback in Eval**

File: `eval/run.ts` (lines 220-234)

**Current Logic**:

```typescript
if (resolvedGrams == null && parsed && top?.densityGml) {
  // Only applies if densityGml exists
  const unit = (parsed.unit || '').toLowerCase();
  const qty = parsed.qty * (parsed.multiplier || 1);
  const CUP_ML = 240;
  // ...
  if (ml > 0) {
    resolvedGrams = ml * top.densityGml;
  }
}
```

**Problem**: This is ALREADY correct! The issue is that foods don't have densityGml set.

**Fix**: Ensure all template foods have densityGml:

- Milk: 1.03
- Heavy Cream: 0.99
- Greek Yogurt: 1.04
- Coconut Oil: 0.92
- Sweet Potato Mashed: ~0.8

**Expected Impact**: Fix 2-3 more cases → +1pp

---

**A.3: Update Template Food Creation Script**

File: `scripts/add-user-friendly-aliases.ts` or `scripts/phase-4-add-plurals-and-foods.ts`

**Fix**: Ensure densityGml is properly set when creating template foods

**Verification**: Run a diagnostic script to check all template foods have:

- ✅ densityGml set
- ✅ FoodUnit entries for common volumes
- ✅ Proper categoryId

---

### Phase B: Add Missing High-Impact Foods (Priority 2 - ~5pp impact)

**B.1: Create Missing Foods Script**

File: `scripts/add-missing-high-impact-foods.ts` (NEW)

**Foods to Add** (Top 15 by MAE):

1. **Chocolate Chips** (170g)

   - Name: "Chocolate Chips, Semisweet"
   - Category: "dessert" or "sugar"
   - Aliases: ["chocolate chips", "semi-sweet chocolate chips", "chocolate chip"]
   - densityGml: 0.61 (chips are light/airy)
   - FoodUnits: cup=170g, tbsp=10.6g

2. **Pasta, Dry** (170g)

   - Name: "Pasta, Dry"
   - Category: "grain"
   - Aliases: ["pasta dry", "dry pasta", "pasta uncooked"]
   - densityGml: 0.50
   - FoodUnits: cup=100-110g (varies by shape)

3. **Flax Seeds** (168g)

   - Name: "Seeds, Flaxseed"
   - Category: "seed"
   - Aliases: ["flax seeds", "flaxseed", "flax seed"]
   - densityGml: 0.67
   - FoodUnits: cup=168g, tbsp=10.5g

4. **Hemp Seeds** (154g)

   - Name: "Seeds, Hemp Seed, Hulled"
   - Category: "seed"
   - Aliases: ["hemp seeds", "hemp seed", "hulled hemp seeds"]
   - densityGml: 0.62
   - FoodUnits: cup=154g, tbsp=9.6g

5. **Red Bell Pepper** (149g)

   - Name: "Peppers, Sweet, Red, Raw, Chopped"
   - Category: "veg"
   - Aliases: ["red bell pepper", "red pepper", "bell pepper red"]
   - densityGml: 0.60
   - FoodUnits: cup=149g

6. **Chicken Drumsticks** (need to check if exists)

   - May just need plural alias: "chicken drumsticks" → existing "chicken, drumstick"

**Implementation**:

```typescript
const MISSING_FOODS = [
  {
    name: "Chocolate Chips, Semisweet",
    aliases: ["chocolate chips", "semi-sweet chocolate chips", "semisweet chocolate chips"],
    categoryId: "sugar",
    kcal100: 486,
    protein100: 4.2,
    carbs100: 63.9,
    fat100: 24.4,
    densityGml: 0.61,
    units: [
      { label: "cup", grams: 170 },
      { label: "tbsp", grams: 10.6 }
    ]
  },
  // ... more foods
];
```

**Expected Impact**: Fix 10-12 NO MATCH cases → +4-5pp

---

### Phase C: Strengthen Ranking Algorithm (Priority 3 - ~2pp impact)

**C.1: Fix Milk/Dairy Category Matching**

File: `src/lib/foods/rank.ts`

**Current Issue**: "milk" still matches Eggnog and lowfat milk instead of plain whole milk

**Enhanced Fixes**:

```typescript
// 1. Stronger penalties for processed/flavored dairy
if (queryLower.includes('milk') && !queryLower.includes('cheese')) {
  // Penalize flavored milk products
  if (foodNameLower.includes('eggnog') || 
      foodNameLower.includes('chocolate') ||
      foodNameLower.includes('strawberry') ||
      foodNameLower.includes('vanilla') ||
      foodNameLower.match(/\d+%/)) {  // "1% milk", "2% milk"
    return -1.2; // Very strong penalty for flavored/specialty milks
  }
  
  // Unless query specifies fat content, penalize non-whole milk
  if (!queryLower.includes('skim') && 
      !queryLower.includes('nonfat') && 
      !queryLower.includes('lowfat') &&
      !queryLower.includes('low-fat') &&
      !queryLower.includes('1%') &&
      !queryLower.includes('2%')) {
    // Query says "milk" without qualifiers → prefer whole milk
    if (foodNameLower.includes('lowfat') || 
        foodNameLower.includes('skim') ||
        foodNameLower.includes('nonfat') ||
        foodNameLower.includes('1%') ||
        foodNameLower.includes('2%')) {
      return -0.5; // Moderate penalty for non-whole milk
    }
  }
}

// 2. Boost for plain/generic matches
const isPlainMatch = (
  !foodNameLower.includes('flavored') &&
  !foodNameLower.includes('chocolate') &&
  !foodNameLower.includes('vanilla') &&
  !foodNameLower.includes('strawberry') &&
  !foodNameLower.match(/\d+%/)
);

if (queryLower.split(/\s+/).length === 1 && isPlainMatch) {
  boost += 0.3; // Boost plain versions for single-word queries
}
```

**Expected Impact**: Fix 5-6 milk/yogurt cases → +2pp

---

**C.2: Fix Vegetable/Condiment Confusion**

File: `src/lib/foods/rank.ts`

**Issue**: "mustard" → "mustard spinach", "oat milk" → "chocolate candy"

**Enhanced Fix**:

```typescript
// Strengthen existing penalties
if (queryLower.includes('mustard') && !queryLower.includes('spinach') && foodCategory === 'veg') {
  return -1.2; // Increased from -0.6
}

if (queryLower.includes('oat milk') || queryLower.includes('almond milk')) {
  if (foodCategory === 'dessert' || foodNameLower.includes('candy') || foodNameLower.includes('chocolate')) {
    return -1.5; // Very strong penalty
  }
}

// Add: Prefer sauce category for condiment queries
if (['mustard', 'ketchup', 'mayo', 'mayonnaise'].some(c => queryLower === c)) {
  if (foodCategory === 'sauce') {
    boost += 0.8; // Strong boost for sauce category
  } else if (foodCategory === 'veg') {
    return -1.5; // Very strong penalty for vegetables
  }
}
```

**Expected Impact**: Fix 3-4 category confusion cases → +1pp

---

**C.3: Improve Preparation State Matching**

File: `src/lib/foods/rank.ts`

**Issue**: "tomato, diced" → canned sauce (should be raw)

**Fix**: Enhance existing state matching (lines 300-337)

```typescript
// Add preparation mismatches
const prepQualifiers = ['diced', 'chopped', 'sliced', 'minced', 'grated', 'shredded'];
const queryHasPrep = prepQualifiers.some(p => queryLower.includes(p));

if (queryHasPrep) {
  // Query wants raw + prep qualifier → penalize processed
  if (foodNameLower.includes('canned') ||
      foodNameLower.includes('sauce') ||
      foodNameLower.includes('paste') ||
      foodNameLower.includes('puree')) {
    stateBoost -= 0.5; // Penalty for processed when query wants fresh
  }
  
  // Boost raw/fresh
  if (rawStates.some(state => foodNameLower.includes(state))) {
    stateBoost += 0.4;
  }
}
```

**Expected Impact**: Fix 2-3 preparation cases → +1pp

---

## Execution Order

### Round 1: Quick Wins (2-3 hours)

1. **Phase B**: Add missing high-impact foods (chicken drumsticks check + 5-6 new foods)
2. **Phase A.1**: Add FoodUnit entries to existing template foods
3. Run eval → Expect 76-78% P@1

### Round 2: Ranking Improvements (1-2 hours)  

4. **Phase C.1**: Fix milk/dairy matching
5. **Phase C.2**: Fix vegetable/condiment confusion
6. Run eval → Expect 78-80% P@1

### Round 3: Final Polish (1 hour)

7. **Phase C.3**: Improve preparation state matching
8. **Phase A.2**: Verify densityGml on all template foods
9. Run eval → Expect 80-82% P@1

---

## Success Criteria

- [ ] P@1 reaches 80%+ (212+/265 correct)
- [ ] NO MATCH cases reduced from 32 to <20
- [ ] WRONG MATCH cases reduced from 40 to <25  
- [ ] Portion errors (MAE >150g) reduced from 10+ to <5
- [ ] All high-impact failures resolved:
  - [ ] Milk queries return correct portions
  - [ ] Chocolate chips, pasta, seeds found
  - [ ] Mustard/oat milk category matches fixed

---

## Risk Mitigation

1. **Test after each phase** - Don't batch all changes
2. **Keep old code** - Use feature flags or comments to mark changes
3. **Document regressions** - If P@1 drops, identify which change caused it
4. **Incremental commits** - One phase = one commit for easy rollback

---

## Notes

- Current ENABLE_PORTION_V2 = false (using old resolver)
- Eval script has density fallback (lines 220-234) that SHOULD work
- Main issue: Template foods missing FoodUnit entries and proper densityGml
- Secondary issue: Ranking algorithm needs final tuning for edge cases