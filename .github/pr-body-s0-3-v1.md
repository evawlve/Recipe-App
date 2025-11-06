Adds eval/gold.v1.csv with 100 carefully curated, high-leverage ingredient mapping test cases.

**Structure:**
- Versioned as `gold.v1.csv` (immutable, future versions will be v2, v3, etc.)
- Stratified by form (raw/cooked/canned/prepared), unit type (piece/leaf/clove/volume/mass), cuisine tags
- Source tier stratification: override | usda_portion | density | heuristic | branded
- Includes 10 branded cases for future Sprint 5 validation

**CSV Schema:**
- id,raw_line,expected_food_name,expected_grams,expected_source,expected_source_tier,form,unit_type,cuisine_tag,difficulty,expected_food_id_hint,expected_unit_hint,notes

**New Columns:**
- `expected_food_id_hint`: Stable substring/regex to disambiguate expected food (prevents name drift)
- `expected_unit_hint`: Unit type enum (leaf|clove|yolk|white|piece|slice|sheet|stalk) for unit-hint plumbing

**Coverage:**
- Eggs, proteins, vegetables, grains, oils, dairy
- Ambiguity cases: egg white vs yolk, garlic variants
- Difficulty distribution: ~60% easy, ~30% medium, ~10% hard

**Future Expansion Plan:**
- Sprint 2: +150 cases → gold.v2.csv (piece/leaf/clove overrides)
- Sprint 4: +100 cases → gold.v3.csv (international synonyms)
- Sprint 5: +100 branded → gold.v4.csv (branded on-demand)
- Sprint 7: +50 user-pain → gold.v5.csv (beta feedback)

**PR Checklist:**
- ✅ v1 rows validate (no empty required fields, ids unique)
- ✅ Difficulty mix ~60/30/10
- ✅ At least 20 piece/leaf/clove cases
- ✅ At least 10 volume→density cases
- ✅ At least 10 branded cases (flagged)
- ⏳ eval/run.ts completes < 10s locally (S0.4)
- ⏳ Baseline metrics captured (S0.7)

Closes #41

