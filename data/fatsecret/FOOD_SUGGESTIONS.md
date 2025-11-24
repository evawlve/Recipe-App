# FatSecret Cache Food Suggestions

## Health-Focused Categories (High Priority)

### Low-Fat & Fat-Free Dairy
**Category**: `protein:dairy` or new `dairy:low-fat`

**Cheeses (Fat-Reduced & Fat-Free)**:
- Fat-free mozzarella (shredded, string, block)
- Fat-free cheddar (shredded, block)
- Reduced-fat mozzarella (part-skim, 2% milk)
- Reduced-fat cheddar (2% milk)
- Fat-free feta
- Reduced-fat feta
- Fat-free ricotta
- Reduced-fat ricotta (part-skim)
- Fat-free cottage cheese
- 1% cottage cheese
- 2% cottage cheese
- Fat-free cream cheese
- Reduced-fat cream cheese (Neufchâtel)
- Fat-free sour cream
- Light sour cream
- Fat-free Greek yogurt
- 0% Greek yogurt
- 2% Greek yogurt
- Fat-free yogurt
- Light cream cheese
- Fat-free parmesan (grated)
- Reduced-fat Swiss cheese
- Fat-free American cheese
- Light string cheese

**Milk & Cream**:
- Skim milk (fat-free)
- 1% milk
- 2% milk
- Fat-free half & half
- Light cream
- Fat-free evaporated milk
- Fat-free condensed milk

### Keto & Low-Carb Alternatives
**Category**: `pantry:grains` or new `pantry:keto`

**Breads & Buns**:
- Keto bread (various brands: Sola, Aldi, Schmidt's 647, Hero)
- Keto buns (hamburger, hot dog)
- Keto bagels
- Keto tortillas (Mission Carb Balance, La Banderita Carb Counter, Ole Xtreme Wellness)
- Low-carb tortillas
- Keto wraps
- Cloud bread
- Fathead dough

**Flours & Baking**:
- Almond flour
- Coconut flour
- Flaxseed meal
- Psyllium husk powder
- Keto baking mixes
- Low-carb pancake mix

**Sweeteners**:
- Erythritol
- Stevia (liquid, powder)
- Monk fruit sweetener
- Allulose
- Swerve (erythritol blend)
- Lakanto (monk fruit blend)

**Snacks & Crackers**:
- Keto crackers
- Pork rinds (keto-friendly)
- Keto chips
- Low-carb tortilla chips

### Protein-Focused Items
**Category**: `protein:dairy` or new `protein:supplements`

**Protein Powders**:
- Whey protein isolate (various brands)
- Casein protein
- Plant-based protein powder (pea, rice, hemp)
- Collagen peptides
- Keto protein powder
- Low-carb protein powder

**Protein Bars**:
- Quest bars
- One bars
- Built bars
- Pure Protein bars
- Keto protein bars

**High-Protein Foods**:
- Protein pasta (chickpea, lentil, edamame)
- High-protein Greek yogurt
- Skyr (Icelandic yogurt - high protein)
- Protein pancakes
- High-protein bread

## Missing Popular Categories

### Pantry – Canned & Packaged Goods
**Category**: `pantry:canned` (new)

- Canned tomatoes (diced, crushed, whole)
- Tomato paste
- Tomato sauce
- Canned beans (black, kidney, pinto, garbanzo)
- Canned corn
- Canned tuna (in water, in oil)
- Canned salmon
- Canned chicken
- Canned vegetables (green beans, peas, carrots)
- Broth/stock (chicken, beef, vegetable)
- Coconut milk (canned, light)
- Canned pumpkin

### Pantry – Pasta & Noodles
**Category**: `pantry:grains` (expand)

- Whole wheat pasta
- Chickpea pasta
- Lentil pasta
- Edamame pasta
- Rice noodles
- Soba noodles
- Ramen noodles
- Zucchini noodles (zoodles)
- Spaghetti squash

### Pantry – Breads & Wraps
**Category**: `pantry:grains` (expand)

- Whole wheat bread
- Sourdough bread
- Pita bread
- Naan
- Flatbread
- Wraps (various types)
- English muffins
- Bagels (various types)
- Hamburger buns
- Hot dog buns

### Produce – Herbs & Aromatics
**Category**: `produce:vegetables` (expand)

- Fresh basil
- Fresh cilantro
- Fresh parsley
- Fresh dill
- Fresh mint
- Fresh rosemary
- Fresh thyme
- Fresh oregano
- Scallions/green onions
- Shallots
- Leeks

### Pantry – Broths & Stocks
**Category**: `pantry:canned` or new `pantry:broths`

- Chicken broth (low-sodium, regular)
- Beef broth
- Vegetable broth
- Bone broth
- Stock cubes/powder

### Pantry – Vinegars
**Category**: `pantry:condiments` (expand)

- Balsamic vinegar
- Apple cider vinegar
- White vinegar
- Rice vinegar
- Red wine vinegar
- White wine vinegar

### Pantry – Nut Butters
**Category**: `pantry:nuts` (expand)

- Almond butter
- Cashew butter
- Sunflower seed butter
- Tahini
- Peanut butter (natural, regular, reduced-fat)
- Powdered peanut butter (PB2, PBFit)

### Pantry – Seeds
**Category**: `pantry:nuts` (expand)

- Chia seeds
- Flax seeds (ground, whole)
- Hemp seeds
- Pumpkin seeds
- Sunflower seeds
- Sesame seeds

## Hydration Workflow for New Manifests

Run the manifest builder for each curated CSV (use `--%` in PowerShell if needed):

```bash
npm run fatsecret:cache:manifest -- --curated --curated-file=data/curated/dairy_lowfat.csv --curated-output=data/fatsecret/bootstrap/dairy_lowfat.jsonl
npm run fatsecret:cache:manifest -- --curated --curated-file=data/curated/keto.csv --curated-output=data/fatsecret/bootstrap/keto.jsonl
npm run fatsecret:cache:manifest -- --curated --curated-file=data/curated/canned.csv --curated-output=data/fatsecret/bootstrap/canned.jsonl
npm run fatsecret:cache:manifest -- --curated --curated-file=data/curated/supplements.csv --curated-output=data/fatsecret/bootstrap/supplements.jsonl
npm run fatsecret:cache:manifest -- --curated --curated-file=data/curated/nut_butters.csv --curated-output=data/fatsecret/bootstrap/nut_butters.jsonl
```

Hydrate the generated queues (one at a time or grouped):

```bash
npm run fatsecret:cache:bootstrap -- --file=data/fatsecret/bootstrap/dairy_lowfat.jsonl
npm run fatsecret:cache:bootstrap -- --file=data/fatsecret/bootstrap/keto.jsonl
npm run fatsecret:cache:bootstrap -- --file=data/fatsecret/bootstrap/canned.jsonl
npm run fatsecret:cache:bootstrap -- --file=data/fatsecret/bootstrap/supplements.jsonl
npm run fatsecret:cache:bootstrap -- --file=data/fatsecret/bootstrap/nut_butters.jsonl
```

After each hydration pass, loop through verification and backfill so weight/volume + nutrient coverage stay complete:

```bash
npm run fatsecret:cache:verify -- --missing-servings
npm run fatsecret:cache:serving-gaps
npm run fatsecret:cache:backfill-servings
npm run fatsecret:cache:category-report -- --output=data/fatsecret/cache-categories.txt
```

Review `data/fatsecret/manual-review.csv` for any foods that still need manual density or nutrition entries before moving on to the next category batch.
- Poppy seeds

### Protein – Processed & Prepared
**Category**: Various protein categories

- Rotisserie chicken
- Pre-cooked chicken strips
- Pre-cooked ground beef
- Pre-cooked turkey
- Deli meats (turkey, chicken, ham - low-sodium options)
- Sausage (various types - turkey, chicken, pork)
- Hot dogs (turkey, chicken, beef)
- Meatballs (frozen, pre-cooked)

### Protein – Seafood (Expand)
**Category**: `protein:seafood` (expand)

- Canned tuna (in water, in oil)
- Canned salmon
- Canned sardines
- Canned anchovies
- Frozen shrimp
- Frozen salmon fillets
- Frozen cod
- Frozen tilapia
- Frozen scallops
- Canned crab
- Imitation crab

### Beverages (Expand)
**Category**: `beverages` (expand)

- Protein shakes (premade)
- Meal replacement shakes
- Coffee (various types)
- Tea (green, black, herbal)
- Sparkling water (various flavors)
- Diet sodas
- Zero-calorie drinks
- Kombucha
- Plant milks (soy, cashew, hemp, rice)

### Pantry – Spices & Seasonings (Expand)
**Category**: `spices` (expand)

- Garlic powder
- Onion powder
- Chili powder
- Cayenne pepper
- Red pepper flakes
- Italian seasoning
- Taco seasoning
- Fajita seasoning
- Everything bagel seasoning
- Old Bay seasoning
- Curry powder
- Garam masala
- Za'atar
- Herbes de Provence

### Baking – Essentials (Expand)
**Category**: `baking:essentials` (expand)

- Almond flour
- Coconut flour
- Oat flour
- Whole wheat flour
- Bread flour
- Cake flour
- Cornstarch
- Arrowroot powder
- Xanthan gum
- Guar gum

## Popular Brand-Specific Items

### Health-Focused Brands
- **Quest**: Quest bars, Quest chips, Quest cookies
- **Atkins**: Atkins bars, shakes, meals
- **Keto**: Various keto bread brands (Sola, Aldi, Schmidt's 647)
- **Mission**: Carb Balance tortillas
- **La Banderita**: Carb Counter tortillas
- **Ole**: Xtreme Wellness tortillas
- **Two Good**: Low-sugar yogurt
- **Oikos**: Triple Zero Greek yogurt
- **Fage**: 0% Greek yogurt
- **Chobani**: Zero Sugar yogurt
- **PB2**: Powdered peanut butter
- **PBFit**: Powdered peanut butter

### Popular Grocery Items
- **Kroger**: Store brand low-fat items
- **Aldi**: Store brand keto items
- **Walmart**: Great Value health items
- **Trader Joe's**: Popular health items
- **Costco**: Kirkland Signature health items

## Category Gaps Analysis

Based on current coverage, prioritize:

1. **Low-Fat & Fat-Free Dairy** (0 items currently) - HIGH PRIORITY
2. **Keto Alternatives** (0 items currently) - HIGH PRIORITY
3. **Protein Powders** (limited coverage) - MEDIUM PRIORITY
4. **Canned Goods** (0 items currently) - MEDIUM PRIORITY
5. **Breads & Wraps** (limited coverage) - MEDIUM PRIORITY
6. **Herbs & Aromatics** (limited coverage) - LOW PRIORITY
7. **Broths & Stocks** (limited coverage) - MEDIUM PRIORITY
8. **Nut Butters** (limited coverage) - MEDIUM PRIORITY
9. **Seeds** (limited coverage) - MEDIUM PRIORITY
10. **Processed Proteins** (limited coverage) - MEDIUM PRIORITY

## Search Strategy

When searching FatSecret for these items, use:
- Brand names + product name (e.g., "Mission Carb Balance Tortilla")
- Generic + modifier (e.g., "fat-free mozzarella", "keto bread")
- Common aliases (e.g., "part-skim mozzarella" = reduced-fat)
- Store brands (e.g., "Kroger fat-free cheddar")

## Next Steps

1. Create bootstrap files for each category:
   - `data/fatsecret/bootstrap/health-dairy.jsonl`
   - `data/fatsecret/bootstrap/keto-alternatives.jsonl`
   - `data/fatsecret/bootstrap/protein-supplements.jsonl`
   - `data/fatsecret/bootstrap/canned-goods.jsonl`
   - `data/fatsecret/bootstrap/breads-wraps.jsonl`

2. Search FatSecret API for each item and add to appropriate bootstrap file

3. Run bootstrap script to hydrate cache

4. Update category report to track new categories

