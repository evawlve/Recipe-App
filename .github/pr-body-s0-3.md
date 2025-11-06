Adds eval/gold.csv with 100 carefully curated ingredient mapping test cases.

**Coverage:**
- Eggs, proteins, vegetables, grains, oils, dairy
- 10+ edge cases (branded products, ambiguous names, multi-word ingredients)
- Difficulty distribution: ~60% easy, ~30% medium, ~10% hard

**CSV Schema:**
- id,raw_line,expected_food_name,expected_grams,expected_source,cuisine_tag,difficulty,notes

**Sample entries:**
- Easy: "2 large eggs", "1 cup rice"
- Medium: "1 cup cooked quinoa", "1 cup greek yogurt"
- Hard: "1 cup kodiak protein pancake mix", "2% milk"

Closes #41

