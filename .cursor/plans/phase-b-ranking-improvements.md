# Phase B: Ranking Algorithm Improvements

## Goal
Fix WRONG FOOD matches to improve P@1 from 82.6% → ~88-90% (+6-8pp)

## Current Issues Analysis

### Top WRONG FOOD Failures (from eval):

1. **"1 cup skim milk"** → Greek yogurt (should be skim milk)
2. **"1 cup oat milk"** → chocolate peanuts (!!) (should be oat milk)
3. **"1 cup salt"** → lambsquarters vegetable (should be table salt)
4. **"1 cup tomato, diced"** → tomato sauce (should be raw tomatoes)
5. **"1 cup cottage cheese"** → correct food but wrong portion

### Root Causes:

1. **Qualifier mismatch**: "skim" milk not prioritized over "2%" or yogurt
2. **Category confusion**: "oat milk" matching chocolate (contains "milk")
3. **State mismatch**: "raw/diced" tomato finding "sauce"
4. **Name simplicity**: Complex USDA names losing to simpler names
5. **Volume unit issues**: "cup" measurements resolving incorrectly

## Phase B Improvements

### B1: Exact Qualifier Matching (+2-3pp)

**File**: `src/lib/foods/rank.ts`

**Problem**: "skim milk" should strongly prefer exact match over "2% milk"

**Solution**: Add qualifier exactness boost

```typescript
// Extract qualifiers from query
const queryQualifiers = extractQualifiers(query); // ['skim', 'whole', 'raw', 'cooked', etc.]
const foodQualifiers = extractQualifiers(food.name);

let qualifierBoost = 0;

// Exact qualifier match: strong boost
for (const qQual of queryQualifiers) {
  if (foodQualifiers.includes(qQual)) {
    qualifierBoost += 0.4; // Strong boost per matching qualifier
  } else if (foodQualifiers.length > 0 && !foodQualifiers.includes(qQual)) {
    qualifierBoost -= 0.3; // Penalty for contradicting qualifier
  }
}

// Add to scoring
score += w.qualifier * qualifierBoost; // w.qualifier = 1.5
```

**Qualifiers to detect**:
- Fat content: `skim`, `nonfat`, `lowfat`, `2%`, `whole`
- State: `raw`, `cooked`, `boiled`, `fried`, `baked`
- Processing: `diced`, `chopped`, `sliced`, `ground`
- Form: `fresh`, `canned`, `frozen`, `dried`

### B2: Name Simplicity Scoring (+1-2pp)

**Problem**: USDA names are verbose; simpler names should win for simple queries

**Solution**: Prefer shorter, simpler food names

```typescript
// Name complexity penalty
const queryWords = query.split(/\s+/).length;
const foodWords = food.name.split(/\s+/).length;

let simplicityBoost = 0;

// Prefer foods with similar or fewer words than query
if (foodWords <= queryWords) {
  simplicityBoost = 0.2;
} else if (foodWords > queryWords + 3) {
  // Penalize overly verbose names
  simplicityBoost = -0.2;
}

// Prefer template foods (curated, simple names)
if (food.source === 'template') {
  simplicityBoost += 0.3;
}

score += w.simplicity * simplicityBoost; // w.simplicity = 1.0
```

### B3: Stronger Category Penalties (+2-3pp)

**Problem**: "oat milk" finding chocolate, "skim milk" finding yogurt

**Solution**: Add strict category incompatibility rules

```typescript
// Category incompatibility matrix
const INCOMPATIBLE_CATEGORIES = {
  'milk': ['dairy_yogurt', 'dairy_cheese', 'sweets_candy', 'sweets_chocolate'],
  'yogurt': ['dairy_milk', 'dairy_cheese'],
  'cheese': ['dairy_milk', 'dairy_yogurt'],
  'oil': ['vegetables', 'fruits', 'grains'],
  'salt': ['vegetables', 'fruits', 'proteins'],
  'oat_milk': ['sweets_candy', 'sweets_chocolate', 'dairy_milk']
};

const queryCategory = inferQueryCategory(query); // e.g., "milk", "oil", "salt"
const foodCategory = food.categoryId;

let categoryPenalty = 0;

if (queryCategory && INCOMPATIBLE_CATEGORIES[queryCategory]?.includes(foodCategory)) {
  categoryPenalty = -1.5; // Strong penalty for incompatible categories
}

score += categoryPenalty;
```

### B4: State/Form Matching (+1pp)

**Problem**: "raw tomato" finding "tomato sauce"

**Solution**: Match state qualifiers (raw/cooked/canned)

```typescript
// Extract state from query and food name
const queryState = extractState(query); // 'raw', 'cooked', 'canned', 'fresh', etc.
const foodState = extractState(food.name);

let stateBoost = 0;

if (queryState && foodState) {
  if (queryState === foodState) {
    stateBoost = 0.3; // Match: boost
  } else {
    stateBoost = -0.4; // Mismatch: penalty
  }
} else if (queryState && !foodState) {
  // Query specifies state, food doesn't mention it
  // Assume food is in natural/default state (raw for produce, cooked for grains)
  const defaultStates = ['raw', 'fresh'];
  if (defaultStates.includes(queryState)) {
    stateBoost = 0.1; // Small boost
  }
}

score += w.state * stateBoost; // w.state = 1.2
```

### B5: Volume Unit Preference (+0.5-1pp)

**Problem**: Volume searches ("1 cup X") should prefer foods with volume-friendly densityGml

**Solution**: Boost foods that work well with volume units

```typescript
// If query has volume unit and food has density
if (parsed?.unit && isVolumeUnit(parsed.unit) && food.densityGml) {
  score += 0.2; // Boost foods with density data for volume queries
}

// Also check for cup-based FoodUnit entries
if (parsed?.unit?.includes('cup') && food.units.some(u => u.label.includes('cup'))) {
  score += 0.3; // Strong boost if food has explicit cup measurements
}
```

## Implementation Plan

### Step 1: Add Helper Functions

```typescript
// In src/lib/foods/rank.ts

function extractQualifiers(text: string): string[] {
  const qualifiers = ['skim', 'nonfat', 'lowfat', 'low-fat', '2%', 'whole', '3.25%'];
  return qualifiers.filter(q => text.toLowerCase().includes(q));
}

function extractState(text: string): string | null {
  const states = ['raw', 'cooked', 'boiled', 'fried', 'baked', 'canned', 'fresh', 'frozen', 'dried'];
  for (const state of states) {
    if (text.toLowerCase().includes(state)) return state;
  }
  return null;
}

function inferQueryCategory(query: string): string | null {
  const lowerQuery = query.toLowerCase();
  
  if (lowerQuery.includes('milk') && !lowerQuery.includes('chocolate')) {
    if (lowerQuery.includes('oat')) return 'oat_milk';
    if (lowerQuery.includes('almond')) return 'almond_milk';
    return 'milk';
  }
  
  if (lowerQuery.includes('oil')) return 'oil';
  if (lowerQuery.includes('salt')) return 'salt';
  if (lowerQuery.includes('yogurt')) return 'yogurt';
  if (lowerQuery.includes('cheese')) return 'cheese';
  
  return null;
}

function isVolumeUnit(unit: string): boolean {
  const volumeUnits = ['cup', 'tbsp', 'tsp', 'ml', 'liter'];
  return volumeUnits.some(v => unit.toLowerCase().includes(v));
}
```

### Step 2: Update Weights

```typescript
const w = {
  token: 1.8,
  fuzzy: 1.5,
  category: 1.2,
  brand: 0.8,
  alias: 1.3,
  state: 1.2,        // NEW
  qualifier: 1.5,    // NEW
  simplicity: 1.0,   // NEW
};
```

### Step 3: Integrate into rankCandidates

Add all the new scoring components to the main scoring function.

## Expected Impact

| Improvement | Expected P@1 Gain |
|-------------|-------------------|
| B1: Qualifier matching | +2-3pp |
| B2: Name simplicity | +1-2pp |
| B3: Category penalties | +2-3pp |
| B4: State matching | +1pp |
| B5: Volume units | +0.5-1pp |
| **Total** | **+6.5-10pp** |

**Target**: 82.6% → 88-92% P@1

## Success Criteria

- [ ] "skim milk" finds skim milk (not yogurt)
- [ ] "oat milk" finds oat milk (not chocolate)
- [ ] "salt" finds salt (not vegetables)
- [ ] "raw tomato" finds raw tomatoes (not sauce)
- [ ] "cottage cheese" finds cottage cheese with correct portion
- [ ] P@1 improves to 88%+
- [ ] No regressions on currently passing cases

## Testing Strategy

1. Run eval after implementing each sub-phase (B1, B2, B3, B4, B5)
2. Track P@1 progression
3. Verify no regressions using `git diff` on failures
4. Document wins/losses

## Next Steps (Phase C)

After Phase B, address NO MATCH cases:
- Add tofu aliases
- Add protein powder foods
- Add remaining missing nuts (cashews, walnuts)
- Expected impact: +2-3pp → 90-95% P@1

