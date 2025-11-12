# Sprint 7: Continuing Toward 100% P@1

## Current Status
- **P@1**: 82.6% (219/265 correct)
- **Failures**: 46/265 (17.4%)
- **MAE**: 73.0g
- **Total Progress**: 62.6% → 82.6% (+20pp over Sprint 4.6-7)

## Journey Summary

### Sprint 4.6-6B: 62.6% → 80.4%
1. Added 14 missing template foods (chocolate chips, pasta, peppers, seeds, etc.)
2. Enhanced ranking algorithm (token matching, category penalties, fuzzy matching)
3. Fixed portion resolution (FoodUnit entries, densityGml)
4. Added plural aliases and missing synonyms

### Sprint 7 Phase 1-2: 80.4% → 82.6%
1. Added 6 missing nuts (hazelnuts, pine nuts, macadamia, brazil, pistachios, pecans)
2. Created infrastructure (`gold.short.csv`, diagnostic scripts)

## Remaining 46 Failures Analysis

### By Type:
- **NO MATCH**: 11 cases (4.2%)
- **WRONG MATCH**: 35 cases (13.2%)

### Top Patterns:

#### 1. **Portion Resolution Errors** (~15 cases, ~5.7pp potential)
**Issue**: Correct food found, but wrong portion calculated

Examples:
- `"1 cup skim milk"` → yogurt (60g instead of 245g)
- `"1 cup cottage cheese"` → 60g instead of 226g  
- `"1 cup coconut oil"` → 54.6g instead of 218g
- `"2 large eggs"` → 280g instead of 100g (piece unit issue)

**Root Causes**:
- Default 60g fallback being used when specific unit not found
- Piece units (eggs, chicken breasts) calculating incorrectly
- Density-based calculations failing for some categories

**Fix Strategy**:
- Investigate portion resolution logic in `eval/run.ts`
- Add more FoodUnit entries for common volume/piece units
- Fix egg piece calculation (should be ~50g per large egg, not 140g)

#### 2. **Wrong Category Matches** (~12 cases, ~4.5pp potential)
**Issue**: Search finds wrong food due to ranking/category confusion

Examples:
- `"1 cup oat milk"` → chocolate candy (!)
- `"1 cup salt"` → vegetable (lambsquarters)
- `"1 cup tomato, diced"` → tomato sauce (canned)

**Root Causes**:
- Simple ingredients (salt, sugar, tomato) matching complex prepared foods
- Beverage queries matching solids (oat milk → chocolate)
- Category penalties not strong enough

**Fix Strategy**:
- Add even stronger category penalties for cross-category matches
- Boost "raw" and "fresh" foods when query doesn't specify preparation
- Add keyword penalties: if query is "salt" alone, penalize anything with other foods

#### 3. **Missing Foods** (~11 cases, ~4.2pp potential)
**Issue**: Foods not in database

Examples:
- `"1 cup tofu, cubed"` → NO MATCH (tofu exists but not "cubed" variant)
- `"1 cup casein protein powder"` → NO MATCH
- `"1 cup plant-based protein powder"` → NO MATCH
- `"1 cup soy milk"` → NO MATCH

**Fix Strategy**:
- Add protein powder templates (whey, casein, plant-based)
- Add soy milk template
- Add tofu aliases ("tofu cubed" → "tofu, firm")

#### 4. **Branded Food Requests** (~3 cases, ~1.1pp potential)
**Issue**: User requests specific brand

Examples:
- `"1 cup fage greek yogurt"` → NO MATCH (we have generic greek yogurt)
- Branded protein powders

**Fix Strategy**:
- Add common brand aliases to generic foods
- Or accept this as out-of-scope (users should use generic)

#### 5. **Edge Cases & Complex Queries** (~5 cases, ~1.9pp potential)
Examples:
- `"1 cup sweet potato mashed"` → finding "mashed" separately
- Cooked vs raw confusion (zucchini, green beans, cauliflower)
- Multiple qualifiers (boneless skinless chicken breast)

**Fix Strategy**:
- Improve multi-word qualifier matching
- Better cooked/raw state penalties
- Add more specific aliases

## Proposed Phase Plan: 82.6% → 95%+

### **Phase A: Fix Portion Resolution** (Expected: +5-6pp → ~88%)
**Goal**: Fix the 60g default fallback issue and piece unit calculations

**Tasks**:
1. Debug portion resolution in `eval/run.ts`:
   - Why is cottage cheese resolving to 60g?
   - Why is coconut oil resolving to 54.6g?
   - Why are eggs calculating as 140g per egg?

2. Add missing FoodUnit entries:
   - Cottage cheese: 1 cup = 226g
   - All oils: 1 cup = 218g (standard)
   - Eggs: piece = 50g (standard large egg)

3. Test against gold.short.csv after each fix

**Expected Impact**: Fixes 10-15 portion error cases → +4-6pp

### **Phase B: Strengthen Wrong Category Matching** (Expected: +4-5pp → ~92%)
**Goal**: Prevent cross-category confusion (beverages → solids, raw → sauces)

**Tasks**:
1. Enhanced category penalties in `rank.ts`:
   - Very strong penalty (-3.0) for beverage query → solid food
   - Very strong penalty (-3.0) for single ingredient → prepared food
   - Boost "raw" foods when query doesn't specify cooking

2. Add name simplicity scoring:
   - Prefer "Salt, Table" over "Lambsquarters with salt"
   - Prefer "Tomatoes, raw" over "Tomato sauce, canned"
   - Count commas - fewer = simpler = better for generic queries

3. Test incrementally

**Expected Impact**: Fixes 8-12 wrong category cases → +3-5pp

### **Phase C: Add Missing Foods** (Expected: +3-4pp → ~95%)
**Goal**: Fill in remaining NO MATCH gaps

**Tasks**:
1. Create protein powder templates:
   - Whey protein powder
   - Casein protein powder  
   - Plant-based protein powder

2. Add beverage templates:
   - Soy milk (unsweetened)
   - Almond milk (if not exists)

3. Add tofu aliases:
   - "tofu cubed" → "tofu, firm"
   - "tofu extra firm" → existing tofu

4. Test

**Expected Impact**: Fixes 8-10 NO MATCH cases → +3-4pp

### **Phase D: Edge Case Polish** (Expected: +2-3pp → ~97%)
**Goal**: Handle complex qualifiers and edge cases

**Tasks**:
1. Improve multi-word matching:
   - "sweet potato mashed" should match complete phrase
   - "boneless skinless chicken breast" should match all qualifiers

2. Add brand aliases for very common brands:
   - "fage" → "greek yogurt, nonfat"
   - Consider if this is desired or out of scope

3. Cooked/raw improvements:
   - Stronger penalties when state mismatch
   - Better detection of cooking keywords

**Expected Impact**: Fixes 5-8 edge cases → +2-3pp

### **Phase E: Final Optimization** (Expected: +1-2pp → ~98%+)
**Goal**: Handle the long tail of remaining failures

**Tasks**:
1. Analyze remaining ~5-10 failures
2. Case-by-case fixes:
   - Custom aliases
   - Specific ranking adjustments
   - Data corrections

3. Accept some failures as:
   - Too specific/rare
   - User error (typos, uncommon names)
   - Out of scope (very specific brands)

**Expected Impact**: Fixes 3-5 final cases → +1-2pp

## Strategy Considerations

### When to Stop?
- **95%**: Excellent - covers vast majority of common use cases
- **98%**: Outstanding - only edge cases remain
- **100%**: Likely impossible - would require:
  - Perfect data coverage (all foods ever)
  - Perfect ranking (no ambiguity)
  - Perfect portion database
  - No user errors

### Recommendation:
**Target 95% P@1** as the "production-ready" goal. Beyond that:
- Diminishing returns (each% becomes exponentially harder)
- May require overfitting to specific test cases
- Real-world usage likely has different distribution

### Scalability Strategy:
As you expand `gold.csv` from 265 to thousands of test cases:
1. **Categorize failures** into patterns (as we've done)
2. **Fix patterns systematically** (not individual cases)
3. **Build infrastructure** for rapid iteration:
   - `gold.short.csv` for focused testing
   - Failure pattern analysis scripts
   - Automated regression testing

4. **Maintain quality over coverage**:
   - Ensure fixes don't break existing cases
   - Test against full gold.v3.csv after each phase
   - Track P@1 trends over time

## Next Steps (Immediate)

1. **Create Phase A script** (`scripts/fix-portion-resolution.ts`)
2. **Debug portion calculation** in eval
3. **Fix eggs, cottage cheese, oils**
4. **Test** and measure impact
5. **Iterate** through Phases B-E

## Success Metrics

- [x] **80% P@1** - ✅ Achieved! (82.6%)
- [ ] **85% P@1** - In Progress (Phases A-B)
- [ ] **90% P@1** - Target (Phase C)
- [ ] **95% P@1** - Stretch Goal (Phases D-E)
- [ ] **98%+ P@1** - Excellence (Phase E + Polish)

## Files Created This Sprint

### Scripts:
- `scripts/create-gold-short.ts` - Extract failures to focused test set
- `scripts/debug-search.ts` - Diagnostic tool for food search
- `scripts/sprint-7-add-nuts-template.ts` - Add 6 missing nuts
- `scripts/sprint-7-import-nuts.ts` - USDA import attempt (not used)

### Configuration:
- `eval/gold.short.csv` - Focused failure test set (46 cases)

### NPM Commands:
- `npm run create:gold-short` - Generate gold.short.csv
- `npm run eval:short` - Test against failures only
- `npm run sprint7:nuts` - Add nuts to database

## Conclusion

We've successfully established a **systematic, scalable framework** for improving P@1:

1. **Measure** (`npm run eval`)
2. **Analyze** (`npm run eval:analyze`, failure patterns)
3. **Focus** (`gold.short.csv` for rapid iteration)
4. **Fix** (targeted scripts for each pattern)
5. **Test** (incremental eval, regression checks)
6. **Iterate** (repeat until goals met)

This framework can scale to:
- Thousands of test cases
- Multiple food domains
- Continuous improvement over time
- Production monitoring and alerts

**Ready to proceed with Phase A (portion fixes)?**

