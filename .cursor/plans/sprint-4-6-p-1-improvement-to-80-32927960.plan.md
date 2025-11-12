<!-- 32927960-a85c-49af-822b-3594c51b6220 dc397efc-0f6d-4b3d-8fc1-f6da15c90f7e -->
# Sprint 4.6: P@1 Improvement Plan (62.6% → 80%+)

## Goal

Improve P@1 from 62.6% to 80%+ by importing missing foods and enhancing ranking algorithm.

## Phase 1: Import Missing USDA Foods (High-Impact Quick Wins)

### 1.1 Create Targeted Import Script

**File**: `scripts/import-missing-foods.ts`

Create script to import specific foods from USDA data files:

- Search `FoodData_Central_foundation_food_json_2025-04-24.json` and `FoodData_Central_sr_legacy_food_json_2018-04.json`
- Use keyword-based search similar to `usda-saturate.ts` but targeted

**Target Foods** (from gold.v3.csv failures + gap list):

- **Condiments**: ketchup/catsup, vinegar (distilled), sriracha sauce, vanilla extract, baking powder, baking soda
- **Broths**: chicken broth/bouillon, beef broth/bouillon
- **Chicken cuts**: chicken thigh (raw), chicken drumstick, chicken wing
- **International** (from SPRINT_2_GAP_LIST.md): miso, mirin, soy sauce, rice vinegar, gochujang, gochugaru, fish sauce, coconut milk, curry paste
- **Other**: chicken broth, beef broth

**Implementation**:

- Load USDA JSON files
- Filter by keywords (e.g., "chicken thigh", "catsup", "vinegar distilled")
- Apply existing filters from `DEFAULT_SATURATION_FILTERS` but allow condiments/broths
- Use `normalizeUsdaRowToPer100g` and `mapUsdaToCategory` from existing ops
- Import via `upsertFood` pattern from `usda-saturate.ts`

### 1.2 Update USDA Filters for Condiments/Broths

**File**: `src/ops/usda/config.ts`

Modify filters to allow basic condiments and broths:

- Add exception for "broth", "bouillon", "catsup", "ketchup", "vinegar", "sriracha", "vanilla extract" in name patterns
- Ensure these aren't excluded by "sauce" patterns

### 1.3 Import Missing Foods

**Command**: `npm run import:missing-foods`

Run script to import ~20-30 missing foods that appear in gold.v3.csv failures.

**Expected Impact**: Fixes ~15-20 "no match" cases → +5-7pp P@1 improvement

## Phase 2: Ranking Algorithm Improvements (Systematic)

### 2.1 Improve Token Matching

**File**: `src/lib/foods/rank.ts`

**Current**: Token boost = `tokenHits / tokens.length` (0-1 scale)

**Enhancements**:

- **Exact token match boost**: If query token exactly matches food name token → +0.5 boost
- **Partial token match**: If token is substring of food name → +0.3 boost  
- **Token position weighting**: Tokens at start of food name get higher weight
- **Multi-word query handling**: "chicken breast" should match both tokens, not just one

**Implementation**:

```typescript
// Enhanced token matching
const tokens = q.split(/\s+/).filter(Boolean);
const nameTokens = `${(f.brand ?? '')} ${f.name}`.toLowerCase().split(/\s+/);
let tokenScore = 0;
for (const qToken of tokens) {
  const exactMatch = nameTokens.some(nToken => nToken === qToken);
  const partialMatch = nameTokens.some(nToken => nToken.includes(qToken) || qToken.includes(nToken));
  if (exactMatch) tokenScore += 1.0;
  else if (partialMatch) tokenScore += 0.5;
}
tokenBoost = Math.min(1, tokenScore / tokens.length);
```

### 2.2 Improve Fuzzy Matching Threshold

**File**: `src/lib/foods/rank.ts`

**Current**: Fuse.js threshold = 0.4

**Enhancements**:

- Lower threshold to 0.3 for better recall
- Add query length normalization (shorter queries need tighter matches)
- Boost fuzzy score when it's very close (< 0.2)

### 2.3 Better Category-Based Boosting

**File**: `src/lib/foods/rank.ts`

**Enhancements**:

- Expand category hints (add more mappings in `HINTS`)
- Add reverse lookup: if food category matches query category hint → boost
- Category-specific penalties (e.g., don't match cheese when query says "milk")

### 2.4 Improve Alias Matching

**File**: `src/lib/foods/rank.ts`

**Current**: Exact alias match = 1.2x, alias substring = 1.5x

**Enhancements**:

- Tokenize alias matching (match alias tokens to query tokens)
- Boost when multiple aliases match query
- Case-insensitive fuzzy alias matching

**Expected Impact**: Fixes ~10-15 "wrong match" cases → +4-6pp P@1 improvement

## Phase 3: Synonym Expansion

### 3.1 Add High-Impact Synonyms

**File**: `scripts/seed-synonyms.ts`

**Add synonyms for**:

- **Condiments**: ketchup→catsup, vinegar→white vinegar, sriracha→sriracha sauce
- **Chicken cuts**: chicken thigh→chicken thighs, chicken drumstick→chicken leg, chicken wing→chicken wings
- **Broths**: chicken broth→chicken stock, beef broth→beef stock
- **International**: soy sauce→shoyu, miso→soybean paste, fish sauce→nam pla

**Target**: Add 20-30 new synonym pairs

**Expected Impact**: Fixes ~5-8 cases → +2-3pp P@1 improvement

## Phase 4: Testing & Validation

### 4.1 Run Eval After Each Phase

```bash
npm run eval  # Test against gold.v3.csv
npm run eval:analyze  # Analyze failures
```

### 4.2 Track Progress

- Phase 1 (Import): Target 68-70% P@1
- Phase 2 (Ranking): Target 75-78% P@1  
- Phase 3 (Synonyms): Target 80%+ P@1

### 4.3 Document Improvements

Update `docs/Sprint_4_Report.md` with Sprint 4.6 results

## Implementation Order

1. **Phase 1** (Import missing foods) - Quick wins, fixes "no match" cases
2. **Phase 2** (Ranking improvements) - Systematic, fixes "wrong match" cases  
3. **Phase 3** (Synonym expansion) - Polish, handles edge cases

## Success Criteria

- [ ] P@1 reaches 80%+ on gold.v3.csv (265 cases)
- [ ] "No match" failures reduced from 63 to <30
- [ ] "Wrong match" failures reduced from 56 to <30
- [ ] All high-impact failures from gold.v3.csv resolved (chicken cuts, condiments, broths)