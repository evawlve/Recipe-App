---
title: S1.2 – Parser: qualifiers + unitHint extraction
labels: s1, backend, parser
milestone: S1 – Parser + Schema
---

## Summary

Extract qualifiers (large, raw, diced, boneless, skinless, heart/head) and infer unitHint for piece-like units (leaf|clove|yolk|white|piece|slice|sheet|stalk).

## Scope

- Extract qualifiers array from ingredient lines
- Identify common qualifiers: `large`, `raw`, `diced`, `boneless`, `skinless`, `heart`, `head`, `minced`, `chopped`, `finely chopped`, `packed`
- Infer unitHint for piece-like units:
  - `leaf` (romaine leaves, lettuce leaves)
  - `clove` (garlic cloves)
  - `yolk` (egg yolks)
  - `white` (egg whites)
  - `piece` (generic pieces)
  - `slice` (bread slices, cheese slices)
  - `sheet` (nori sheets, phyllo sheets)
  - `stalk` (celery stalks)

## Acceptance Criteria

- [ ] `3 large boneless skinless chicken breasts` → `qualifiers: ['large', 'boneless', 'skinless']`
- [ ] `2 egg yolks` → `unitHint: 'yolk', name: 'egg'` (extract yolk, core name is egg)
- [ ] `3 egg whites` → `unitHint: 'white', name: 'egg'`
- [ ] `5 romaine leaves` → `unitHint: 'leaf', name: 'romaine'`
- [ ] `2 cloves garlic` → `unitHint: 'clove', name: 'garlic'`
- [ ] `1 sheet nori` → `unitHint: 'sheet', name: 'nori'`
- [ ] `1 cup onion (diced)` → `qualifiers: ['diced']` (extract from parentheses)
- [ ] `cilantro, finely chopped` → `qualifiers: ['finely chopped']`
- [ ] `1 cup, packed, brown sugar` → `qualifiers: ['packed']`

## Technical Notes

- Update `ParsedIngredient` type to include:
  - `qualifiers?: string[]`
  - `unitHint?: string`
- Create qualifier detection logic (keyword matching or pattern matching)
- Create unitHint extraction logic (identify piece-like units and extract the hint)
- Handle unitHint extraction before/after the food name

## Related Files

- `src/lib/parse/ingredient-line.ts`
- `src/types/` (if type definitions are separate)

## Testing

- Add test cases for all qualifier examples
- Add test cases for all unitHint examples
- Test edge cases (multiple qualifiers, qualifiers in different positions)

