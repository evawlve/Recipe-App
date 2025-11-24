# Category Gaps Analysis

## Coverage Snapshot (after dairy/keto/canned/supplement/nut butter runs)

- **Cache size:** 371 foods (all manifest entries hydrated).
- **New categories filled:** `dairy:low-fat` (18 items), `pantry:keto` (23), `pantry:canned` (35), `protein:supplements` (15), `pantry:nut-butters` (7).
- **Uncategorized:** 64 entries (mostly herbs/aromatics, branded prepared foods, or rows without descriptive keywords).

## Underrepresented Categories

| Category | Count | Gaps | Priority |
| --- | --- | --- | --- |
| **Beverages** | 4 | Brewed coffees/teas, kombucha, plant milks, RTD protein shakes | High |
| **Produce – Fruits** | 7 | More berries, citrus, frozen fruit blends | Medium |
| **Produce – Vegetables/Herbs** | 37 | Herbs, scallions, shallots, leeks, aromatics | Medium |
| **Pantry – Grains & Starches** | 31 | Everyday breads, wraps, buns, tortillas | Medium |
| **Protein – Seafood** | 8 | Frozen fillets, canned seafood, smoked fish | Medium |
| **Protein – Chicken cuts** | 1‑2 per subcategory | More thighs/wings/drumsticks/tenders (raw + cooked) | Medium |

## Next Categories to Hydrate

1. **Beverages (`data/curated/beverages.csv`)**  
   - Unsweetened coffee/tea, matcha, kombucha, sparkling water, protein shakes, meal replacements, plant milks, electrolyte drinks.
2. **Produce – Herbs & Aromatics (`data/curated/produce_herbs.csv`)**  
   - Fresh herbs, scallions, shallots, leeks, peppers, ginger, lemongrass.
3. **Pantry – Breads & Wraps (`data/curated/breads_wraps.csv`)**  
   - Whole wheat bread, sourdough, pita, naan, wraps, bagels, buns, tortillas, lavash.
4. **Protein – Seafood (`data/curated/seafood_extra.csv`)**  
   - Frozen shrimp/salmon/cod/tilapia, scallops, mussels, canned sardines/salmon, smoked salmon, tuna pouches.
5. **Chicken Variety (future CSV)**  
   - Add more branded/raw/cooked thighs, wings, drumsticks, shredded chicken, deli packs to boost the subcategory counts.

## Action Plan

### Phase 2 (Current)
1. Build manifests for `beverages`, `produce_herbs`, `breads_wraps`, and `seafood_extra`.
2. Hydrate each queue, run verify/serving-gap/backfill scripts, and re-check `data/fatsecret/cache-categories.txt`.
3. Trim the “Uncategorized” bucket by ensuring manifest notes contain descriptive keywords (e.g., “Fresh basil herb”).

### Phase 3
1. Create a `data/curated/chicken_variety.csv` covering bone-in/boneless thighs, wings, drumsticks, tenders, cooked shredded packs.
2. Add more canned/frozen seafood plus smoked fish entries.
3. Expand beverages with brand-specific protein shakes and zero-sugar energy/electrolyte drinks.

## Expected Impact

- **Macro/gym users** get beverages, herbs, breads, and seafood staples without leaving the cache.
- **Uncategorized** count should fall below 40 once herb/bread manifests hydrate.
- Cache size should climb toward 430‑450 foods after the next hydration wave, keeping Phase 2 goal (≥95% IngredientFoodMap coverage) on track.
