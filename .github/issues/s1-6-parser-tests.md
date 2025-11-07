---
title: S1.6 – Parser unit tests (core suite)
labels: s1, backend, tests, parser
milestone: S1 – Parser + Schema
---

## Summary

Create comprehensive table-driven test suite with 25 deterministic test cases covering all parser behaviors.

## Scope

- Create test file: `src/lib/parse/ingredient-line.test.ts`
- Implement 25 core test cases covering:
  - Fractions & ranges (S1.1)
  - Piece-like hints (S1.2)
  - Qualifiers (S1.2)
  - Punctuation & noise (S1.3)
  - Unicode & spacing
  - Edge cases
- Use parameterized/jest.each for table-driven tests
- Ensure 100% pass locally and in CI

## Test Cases

### Fractions & Ranges (5 cases)
1. `2½ cups flour` → `qty: 2.5, unit: 'cup', name: 'flour'`
2. `½ cup oats` → `qty: 0.5, unit: 'cup', name: 'oats'`
3. `1 ½ cup milk` → `qty: 1.5, unit: 'cup', name: 'milk'` (space variant)
4. `1½-2 tsp vanilla extract` → `qty: 1.75, unit: 'tsp', name: 'vanilla extract'`
5. `2–3 large eggs` → `qty: 2.5, qualifiers: ['large'], name: 'eggs'` (en-dash)

### Piece-like Hints (5 cases)
6. `2 egg yolks` → `unitHint: 'yolk', name: 'egg'`
7. `3 egg whites` → `unitHint: 'white', name: 'egg'`
8. `5 romaine leaves` → `unitHint: 'leaf', name: 'romaine'`
9. `2 cloves garlic` → `unitHint: 'clove', name: 'garlic'`
10. `1 sheet nori` → `unitHint: 'sheet', name: 'nori'`

### Qualifiers (5 cases)
11. `3 large boneless skinless chicken breasts` → `qualifiers: ['large', 'boneless', 'skinless']`
12. `1 cup onion (diced)` → `qualifiers: ['diced']`
13. `cilantro, finely chopped (1/2 cup)` → `qty: 0.5, unit: 'cup', qualifiers: ['finely chopped']`
14. `1 cup, packed, brown sugar` → `unit: 'cup', qualifiers: ['packed'], name: 'brown sugar'`
15. `2 cloves garlic, minced` → `qualifiers: ['minced']`

### Punctuation & Noise (5 cases)
16. `1 (14 oz) can tomatoes` → Parse correctly (decide behavior)
17. `2 x 200 g chicken` → Handle multiplier correctly
18. `2x200g chicken` → Same as above (no space)
19. `pinch of salt` → Handle gracefully
20. `to taste salt` → Returns null or low-confidence (no throw)

### Unicode & Edge Cases (5 cases)
21. `¼ tsp salt` → `qty: 0.25, unit: 'tsp'`
22. `2 ½ tbsp butter` → `qty: 2.5, unit: 'tbsp'` (thin space)
23. `1–2 ½ cups` → `qty: 1.75, unit: 'cup'` (dash + fraction combo)
24. Empty line → Returns `null` (no throw)
25. `---` or emojis → Returns `null` (no throw)

## Acceptance Criteria

- [ ] Test file created: `src/lib/parse/ingredient-line.test.ts`
- [ ] All 25 test cases implemented
- [ ] All tests pass locally
- [ ] All tests pass in CI
- [ ] Tests use table-driven approach (jest.each or similar)
- [ ] Tests cover all behaviors from S1.1, S1.2, S1.3
- [ ] Tests are deterministic (no flakiness)

## Technical Notes

- Use Jest testing framework
- Use `describe.each` or `test.each` for parameterized tests
- Structure tests by category (fractions, qualifiers, etc.)
- Include both positive and negative test cases
- Test edge cases and error handling

## Related Files

- `src/lib/parse/ingredient-line.test.ts` (new file)
- `src/lib/parse/ingredient-line.ts`
- `jest.config.js`

## Testing

- Run `npm test src/lib/parse/ingredient-line.test.ts`
- Verify all tests pass
- Check CI pipeline passes

