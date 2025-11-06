---
title: S1.1 – Parser: numeric normalization (fractions, ranges)
labels: s1, backend, parser
milestone: S1 – Parser + Schema
---

## Summary

Enhance the ingredient parser to handle vulgar fractions (½ ⅓ ¼ ¾ ⅔), unicode spaces, and numeric ranges (2–3, 2 - 3, 2 to 3, 1½-2).

## Scope

- Handle vulgar fractions (½ ⅓ ¼ ¾ ⅔) in quantity parsing
- Support numeric ranges with various formats:
  - En-dash/em-dash: `2–3`, `2—3`
  - Hyphen: `2-3`
  - "to" keyword: `2 to 3`
  - Combined with fractions: `1½-2`
- Handle unicode spaces (thin space, non-breaking space)
- Ensure whitespace/commas do not break parsing

## Acceptance Criteria

- [ ] `2½ cup` → `qty: 2.5, unit: 'cup'`
- [ ] `1½-2 tsp` → `qty: 1.75, unit: 'tsp'` (average of range)
- [ ] `2–3 large eggs` → `qty: 2.5, qualifiers: ['large']` (en-dash)
- [ ] `2 - 3 cups` → `qty: 2.5, unit: 'cup'` (spaced hyphen)
- [ ] `2 to 3 tbsp` → `qty: 2.5, unit: 'tbsp'` ("to" keyword)
- [ ] `¼ tsp salt` → `qty: 0.25, unit: 'tsp'`
- [ ] `1 ½ cup milk` → `qty: 1.5, unit: 'cup'` (space variant)
- [ ] `2 ½ tbsp butter` → `qty: 2.5, unit: 'tbsp'` (thin space support)
- [ ] Whitespace variations don't break parsing
- [ ] Commas in numbers don't break parsing

## Technical Notes

- Update `src/lib/parse/quantity.ts` to handle fractions and ranges
- Consider using a fraction parsing library or regex patterns
- Range parsing should average the values (e.g., 2-3 → 2.5)
- Ensure backward compatibility with existing quantity parsing

## Related Files

- `src/lib/parse/quantity.ts`
- `src/lib/parse/ingredient-line.ts`

## Testing

- Add test cases to `src/lib/parse/ingredient-line.test.ts`
- Test all fraction variants
- Test all range formats
- Test edge cases (boundary values, malformed input)

