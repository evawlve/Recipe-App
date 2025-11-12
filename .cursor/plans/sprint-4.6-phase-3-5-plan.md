# Sprint 4.6 Phase 3-5: Reaching 80%+ P@1

## Current Status
- **Current P@1**: 69.8% (185/265 correct)
- **Target P@1**: 80%+ (212+/265 correct)
- **Gap**: 27+ more correct matches needed
- **Failures**: 80 total (41 NO MATCH, 39 WRONG MATCH)

## Phase 3: Critical Ranking Fixes (Expected: +4-6pp, ~12-16 cases)

### Priority 1: Fix "Milk" Search Bug (HIGH IMPACT - 5 cases)
**Problem**: Queries for "milk" incorrectly match "Cheese, ricotta, whole milk"
- Affected: "milk", "whole milk", "skim milk", "oat milk" queries
- Root cause: Token "milk" appears in cheese name, and cheese ranks higher

**File**: `src/lib/foods/rank.ts`

**Changes**:
1. **Whole-word token matching bonus**
   - Current: "milk" in "ricotta milk" gets same score as standalone "milk"
   - Fix: Add bonus for whole-word matches (not substring of larger word)
   - Implementation: Check if token is surrounded by word boundaries

2. **Stronger category penalty for cheese when querying milk**
   - Current: -0.3 penalty for cheese when "milk" queried
   - Fix: Increase to -0.8 penalty + ensure penalty is applied BEFORE category boost
   - Add reverse check: if query is "milk" and category is "dairy" but name contains "cheese", apply penalty

3. **Exact name token prioritization**
   - If food name is exactly "Milk, Whole" and query is "milk", boost heavily
   - Penalize foods where query term appears deep in comma-separated name

**Expected Impact**: Fix 5 high-MAE failures

### Priority 2: Improve Category Penalties (MEDIUM IMPACT - 3-5 cases)
**Problem**: Wrong category matches (mustard→mustard spinach, oat milk→chocolate)

**File**: `src/lib/foods/rank.ts`

**Changes**:
1. **Expand wrong category penalties**
   - Add: "mustard" query → penalize "veg" category -0.6
   - Add: "oat milk", "almond milk" → penalize foods with "chocolate", "candy" keywords -0.8
   - Add: "vinegar" → penalize "veg" category (avoid "mustard spinach" style matches)

2. **Strengthen sauce category hints**
   - "mustard", "ketchup", "vinegar", "sriracha" → boost "sauce" category by +0.6
   - Ensure condiments don't match vegetables/spices

3. **Add beverage category protection**
   - "milk", "juice", "water" → strongly penalize solid foods -0.7

**Expected Impact**: Fix 3-5 wrong category cases

### Priority 3: Cooked/Prepared State Boost (MEDIUM IMPACT - 6 cases)
**Problem**: "salmon, cooked" matches raw salmon; "ground beef, cooked" matches raw

**File**: `src/lib/foods/rank.ts`

**Changes**:
1. **State matching bonus**
   - If query contains "cooked", "baked", "roasted", "grilled", "fried"
   - AND food name contains same state word
   - Apply bonus: +0.4

2. **State mismatch penalty**
   - If query contains "cooked" but food name contains "raw"
   - Apply penalty: -0.3

3. **Prepared food priority**
   - "canned", "prepared", "ready-to-eat" should boost when query specifies

**Expected Impact**: Fix 6 cooked vs raw cases

**Total Phase 3 Expected**: +4-6pp improvement (70% → 74-76%)

---

## Phase 4: Add Missing Foods & Aliases (Expected: +3-5pp, ~8-13 cases)

### Task 4.1: Add Plural Aliases (HIGH IMPACT - 3-7 cases)
**File**: `scripts/add-more-aliases.ts` (new script or extend existing)

**Missing Plurals**:
- "Chicken Breast" → add "chicken breasts" alias
- "Salmon" → add "salmon fillet", "salmon fillets" 
- "Ground Beef" → add "beef patty", "beef patties"
- "Chicken Thigh" → verify "chicken thighs" exists (should from Phase 2)

**Expected Impact**: Fix 3-7 NO MATCH cases

### Task 4.2: Add Missing Common Foods (MEDIUM IMPACT - 5-10 cases)
**File**: `scripts/add-user-friendly-aliases.ts` (extend TEMPLATE_FOODS array)

**Missing Foods to Add**:
1. **Heavy Cream**
   - Name: "Heavy Cream"
   - Aliases: ["heavy cream", "heavy whipping cream", "whipping cream"]
   - Category: dairy
   - Nutrition: ~820 kcal/100g, 5g protein, 7g carbs, 88g fat

2. **Sesame Oil**
   - Name: "Sesame Oil"
   - Aliases: ["sesame oil", "toasted sesame oil"]
   - Category: oil
   - Nutrition: ~884 kcal/100g, 0g protein, 0g carbs, 100g fat

3. **Sweet Potato (cooked)**
   - Check if exists in USDA data first
   - If not, add template

4. **Oat Milk**
   - Name: "Oat Milk"
   - Aliases: ["oat milk", "oatmilk"]
   - Category: dairy
   - Nutrition: ~47 kcal/100g, 1g protein, 7.5g carbs, 1.5g fat

5. **Greek Yogurt (generic)**
   - Check existing, may need alias additions

**Expected Impact**: Fix 5-10 NO MATCH cases

**Total Phase 4 Expected**: +3-5pp improvement (74-76% → 77-81%)

---

## Phase 5: Final Tuning (Expected: +1-2pp, ~3-5 cases)

### Task 5.1: Adjust Token Matching Weights
**File**: `src/lib/foods/rank.ts`

**Current Issue**: Some foods rank poorly despite good token matches

**Tuning**:
- If ALL query tokens are exact matches → boost +0.2 additional
- If query is short (1-2 words) and exact match → boost +0.3
- Adjust `w.token` from 1.8 to 2.0 if needed based on results

### Task 5.2: Fuzzy Matching Threshold Tuning
**File**: `src/lib/foods/rank.ts`

**Current**: Threshold = 0.3 base, +0.1 for queries >2 words

**Potential Adjustments**:
- Test lowering to 0.25 for 1-word queries
- Test adjusting query length normalization curve
- Monitor recall vs precision tradeoff

### Task 5.3: Add Final Edge Case Aliases
**Based on remaining failures after Phase 4**

**Expected Impact**: Fix 3-5 remaining edge cases

**Total Phase 5 Expected**: +1-2pp improvement (77-81% → 78-83%)

---

## Implementation Order

### Step 1: Phase 3 - Ranking Fixes (30-45 min)
1. Read current `src/lib/foods/rank.ts`
2. Implement whole-word token matching
3. Strengthen milk/cheese category penalty
4. Add wrong category penalties (mustard, oat milk)
5. Add cooked/prepared state matching
6. Test: `npm run eval`
7. Expected: 69.8% → 74-76%

### Step 2: Phase 4 - Missing Foods (20-30 min)
1. Extend `scripts/add-user-friendly-aliases.ts`
2. Add plural aliases for existing foods
3. Add missing template foods (heavy cream, sesame oil, oat milk)
4. Run script: `npm run add:aliases` (or new script)
5. Test: `npm run eval`
6. Expected: 74-76% → 77-81%

### Step 3: Phase 5 - Final Tuning (15-20 min)
1. Analyze remaining failures: `npm run eval:analyze`
2. Fine-tune weights based on patterns
3. Add any final missing aliases
4. Test: `npm run eval`
5. Expected: 77-81% → 80%+

### Step 4: Validation & Documentation (10 min)
1. Final eval run
2. Verify P@1 ≥ 80%
3. Update sprint plan with final results
4. Document key fixes and learnings

---

## Success Criteria

- ✅ P@1 reaches 80%+ on gold.v3.csv (212+/265 cases)
- ✅ "No match" failures reduced from 41 to <20
- ✅ "Wrong match" failures reduced from 39 to <20
- ✅ Milk search works correctly (no cheese matches)
- ✅ Category penalties prevent wrong category matches
- ✅ Cooked/raw state matching works

---

## Risk Mitigation

**Risk**: Ranking changes might hurt some currently correct matches
- **Mitigation**: Test after each phase, rollback if P@1 drops
- **Strategy**: Make incremental changes, validate frequently

**Risk**: New template foods might have incorrect nutrition data
- **Mitigation**: Use reliable USDA values or verified sources
- **Validation**: Cross-check with USDA database values

**Risk**: May not reach exactly 80% due to difficult edge cases
- **Mitigation**: 77-79% is still excellent progress (+15-17pp from start)
- **Strategy**: Document any remaining systematic issues for future sprints

---

## Time Estimate

- Phase 3: 30-45 minutes
- Phase 4: 20-30 minutes  
- Phase 5: 15-20 minutes
- Validation: 10 minutes
- **Total**: ~75-105 minutes (1.25-1.75 hours)

---

## Files to Modify

1. **src/lib/foods/rank.ts** (Phases 3, 5)
   - Whole-word token matching
   - Category penalty improvements
   - Cooked/prepared state matching
   - Weight tuning

2. **scripts/add-user-friendly-aliases.ts** (Phase 4)
   - Add plural aliases
   - Add new template foods

3. **.cursor/plans/sprint-4-6-p-1-improvement-to-80-32927960.plan.md**
   - Update with final results

---

## Expected Final Result

**Starting Point**: 62.6% P@1
**After Phase 1-2**: 69.8% P@1 (+7.2pp)
**After Phase 3**: 74-76% P@1 (+4-6pp)
**After Phase 4**: 77-81% P@1 (+3-5pp)
**After Phase 5**: 78-83% P@1 (+1-2pp)

**Total Expected Improvement**: +15-21pp (62.6% → 78-83%)

**Stretch Goal**: 80%+ P@1 ✅

