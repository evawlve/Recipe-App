# Sprint 2: Gap List (Missing Foods)

**Date**: 2025-11-09  
**Script**: `scripts/seed-portion-overrides.ts`  
**Database**: 1493 foods

## Summary

- **Total overrides attempted**: 113
- **Successfully seeded**: 66 overrides
- **Missing foods**: 21 unique foods
- **Missing overrides**: 41 total (some foods have multiple units)

## Gap List (Foods to Add in Sprint 5)

### Tier 1: Core Pantry
- **Coconut Oil** (3 units: tbsp, tsp, cup)
- **Rice, brown, medium-grain, cooked** (1 unit: cup)

### Tier 3: Vegetables & Aromatics
- **Garlic** (5 units: clove-small, clove-medium, clove-large, tbsp, tsp)
- **Onion** (3 units: piece, slice, cup)
- **Ginger** (3 units: piece, tbsp, tsp)
- **Scallion** (2 units: stalk, cup)
- **Tomato** (3 units: piece, slice, cup)

### Tier 4: International Staples
- **Miso** (2 units: tbsp, tsp)
- **Mirin** (1 unit: tbsp)
- **Soy Sauce** (2 units: tbsp, tsp)
- **Rice Vinegar** (1 unit: tbsp)
- **Gochujang** (1 unit: tbsp)
- **Gochugaru** (2 units: tbsp, tsp)
- **Fish Sauce** (2 units: tbsp, tsp)
- **Coconut Milk** (2 units: cup, tbsp)
- **Curry Paste** (1 unit: tbsp)

### Tier 5: Prepared/Packaged
- **Almond Butter** (2 units: tbsp, tsp)
- **Honey** (2 units: tbsp, tsp)
- **Bread** (1 unit: slice)
- **Tortilla** (1 unit: piece)
- **Pasta** (1 unit: cup)

## Action Items for Sprint 5

1. **Add template/curated foods** for the 21 missing items
2. **Prioritize high-impact items**:
   - Garlic, Onion, Tomato (most common aromatics)
   - Soy Sauce, Fish Sauce, Miso (most common Asian sauces)
   - Honey, Bread, Pasta (common pantry items)
3. **Verify portions** with USDA FoodData Central when available
4. **Re-run seed script** after adding foods

## Notes

- Some foods may exist in database with slightly different names (e.g., "Garlic, raw" vs "Garlic")
- Consider adding FoodAlias entries to improve matching
- International ingredients should be added with authentic portion sizes from culinary references

## Successfully Seeded (66 overrides)

### Tier 1: Core Pantry (42 overrides)
- **Eggs**: 11 overrides (whole eggs in 5 sizes, yolk, white, Grade A variants)
- **Oils**: 9 overrides (olive, avocado, canola with tbsp/tsp/cup)
- **Dairy**: 10 overrides (milk variants, Greek yogurt, butter with stick)
- **Grains**: 12 overrides (rice, oats, quinoa, flour variants)

### Tier 2: Proteins (14 overrides)
- **Chicken**: 4 overrides (breast, thigh, drumstick)
- **Beef**: 2 overrides (ground beef cup and patty)
- **Fish**: 2 overrides (salmon fillets)
- **Plant proteins**: 6 overrides (tofu, beans, lentils, chickpeas)

### Tier 3: Vegetables (8 overrides)
- **Vegetables**: 8 overrides (tomatoes-cooked/canned, broccoli, spinach, avocado, apple, banana)

### Tier 4: International (2 overrides)
- **Indian**: 2 overrides (ghee tbsp/tsp)

### Tier 5: Prepared/Packaged (4 overrides)
- **Nut butters**: 2 overrides (peanut butter)
- **Nuts**: 2 overrides (almonds)

