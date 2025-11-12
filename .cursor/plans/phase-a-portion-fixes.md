# Phase A: Fix Portion Resolution Issues

## Goal
Fix portion calculation errors to improve P@1 from 82.6% → ~88% (+5-6pp)

## Current Analysis

### Portion V2 Status
- **Currently**: `ENABLE_PORTION_V2 = false` (using old resolver)
- Using `resolveGramsFromParsed` + `deriveServingOptions`
- No 60g hardcoded default found - issues are more specific

### Identified Issues

#### 1. **Egg Portion Calculation** (High Impact - 1 case, but critical)
**Problem**: "2 large eggs" → 280g instead of 100g  
**Root Cause**: Egg piece unit calculating as 140g per egg instead of ~50g

**Investigation Needed**:
- Check FoodUnit entries for "Eggs, Grade A, Large, egg whole"
- Likely has a "1 egg" unit set to 140g (incorrect)
- Should be ~50g per large egg

**Fix**: Update egg FoodUnit to 50g per egg

#### 2. **Chicken Breast Portion** (1 case)
**Problem**: "2 large chicken breasts" → 226g instead of 280g  
**Root Cause**: Piece calculation incorrect

**Investigation Needed**:
- Check FoodUnit for "Chicken Breast"  
- Expected: ~140g per large breast
- Getting: ~113g per breast

**Fix**: Update chicken breast FoodUnit

#### 3. **Wrong Food Matches** (Multiple cases - NOT portion issues)
**Examples**:
- "1 cup milk" → Finding "Milk, 2%" instead of "milk, whole"
- "2 tbsp butter" → Finding "Butter" instead of "Butter, Unsalted"

**Root Cause**: Ranking algorithm not preferring exact qualifier matches  
**Scope**: This is a **ranking issue**, not a portion issue  
**Defer to**: Phase B (Category/Ranking Improvements)

#### 4. **NO MATCH Cases** (Multiple - NOT portion issues)
**Examples**:
- "1 cup broccoli florets"
- Various other missing foods

**Scope**: Missing foods in database  
**Defer to**: Phase C (Add Missing Foods)

### Re-Scoped Phase A Goals

After analysis, the **true portion errors** are limited to:
1. Eggs (280g → 100g)
2. Chicken breasts (226g → 280g)  
3. Potentially a few others in the remaining 46 failures

**Expected Impact**: +0.5-1.5pp (not the original +5-6pp estimate)

The majority of failures are **WRONG FOOD** matches, not portion errors.

## Revised Strategy

### Option A: Fix Known Portion Issues Only
**Tasks**:
1. Debug egg portion calculation
2. Fix egg FoodUnit entry (50g per large egg)
3. Debug chicken breast portion  
4. Fix chicken breast FoodUnit entry (140g per large breast)
5. Run eval to measure impact

**Estimated Impact**: +0.5-1pp → ~83-84% P@1  
**Time**: Low - focused fixes

### Option B: Skip Phase A, Go to Phase B (Ranking Fixes)
**Rationale**: 
- Most failures are WRONG FOOD, not wrong portions
- Fixing ranking will have much higher impact
- Phase B tasks:
  - Prefer exact qualifier matches ("whole milk" over "2% milk")
  - Boost simpler names
  - Better category penalties

**Estimated Impact**: +3-5pp → ~86-88% P@1  
**Time**: Medium - ranking algorithm changes

### Option C: Do Both (Sequential)
**Phase A**: Quick portion fixes (+1pp)  
**Phase B**: Ranking improvements (+4-5pp)  
**Total**: +5-6pp → ~88% P@1

## Recommendation

**Go with Option C**: Do both phases, but adjust expectations:
- **Phase A** (Quick): Fix eggs + chicken breasts → +0.5-1pp
- **Phase B** (Main): Ranking improvements → +4-5pp
- **Total**: ~88% P@1

This is more accurate than the original plan which overestimated portion issues.

## Phase A Detailed Plan

### Task 1: Investigate Egg Portion Calculation
**Query database for egg FoodUnit entries**:

```typescript
// scripts/debug-egg-portion.ts
const egg = await prisma.food.findFirst({
  where: { name: { contains: 'Eggs, Grade A, Large', mode: 'insensitive' } },
  include: { units: true }
});
console.log('Egg food:', egg?.name);
console.log('Units:', egg?.units);
```

**Expected finding**: FoodUnit entry like `{ label: "egg", grams: 140 }` or similar

### Task 2: Fix Egg FoodUnit Entry
**Update to correct weight**:

```typescript
// Fix egg unit to 50g per egg (standard large egg weight)
await prisma.foodUnit.updateMany({
  where: {
    foodId: eggFoodId,
    label: { in: ['egg', '1 egg', 'large egg'] }
  },
  data: { grams: 50 }
});
```

### Task 3: Investigate Chicken Breast Portion
**Same process as eggs**:
- Query FoodUnit entries
- Identify incorrect weight
- Update to 140g per large breast

### Task 4: Scan for Other Piece Unit Issues
**Check all piece-based FoodUnit entries**:

```sql
SELECT f.name, fu.label, fu.grams 
FROM FoodUnit fu 
JOIN Food f ON f.id = fu.foodId 
WHERE fu.label LIKE '%piece%' 
   OR fu.label LIKE '%egg%'
   OR fu.label LIKE '%breast%'
   OR fu.label LIKE '%thigh%';
```

**Verify common piece weights are reasonable**:
- Eggs: ~50g
- Chicken breast: ~140g  
- Chicken thigh: ~70-80g
- Drumstick: ~100g

### Task 5: Test Impact
**Run eval and measure**:

```bash
npm run eval
# Expected: 82.6% → 83.5-84% (+0.5-1pp)
```

## Success Metrics

- [ ] Egg portion fixed (280g → 100g for "2 large eggs")
- [ ] Chicken breast portion fixed (226g → 280g for "2 large chicken breasts")
- [ ] Other piece units verified as correct
- [ ] P@1 improves to 83-84% (+0.5-1pp minimum)
- [ ] No regressions on currently passing cases

## Next Steps After Phase A

Immediately proceed to **Phase B: Ranking Improvements** which will deliver the main +4-5pp gain by:
1. Preferring exact qualifier matches
2. Boosting simpler/generic food names
3. Strengthening category penalties
4. Name simplicity scoring

**Combined Phases A+B Impact**: 82.6% → ~88% P@1

