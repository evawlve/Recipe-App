---
title: S1.3 – Parser: noise + punctuation robustness
labels: s1, backend, parser
milestone: S1 – Parser + Schema
---

## Summary

Handle parentheses, commas, notes, extra punctuation, and x multipliers to make the parser robust to real-world input variations.

## Scope

- Handle parentheses for qualifiers/notes: `1 cup onion (diced)`
- Handle commas separating qualifiers: `2 cloves garlic, minced`
- Handle x multipliers: `2 x 200g chicken` or `2x200g chicken`
- Gracefully handle non-ingredient noise (empty lines, emojis, separators)
- Ensure parser doesn't throw on invalid input

## Acceptance Criteria

- [ ] `1 cup onion (diced)` → `name: 'onion', qualifiers: ['diced']` (extract from parentheses)
- [ ] `2 cloves garlic, minced` → `qualifiers: ['minced']` (extract from comma-separated)
- [ ] `1 cup, packed, brown sugar` → `unit: 'cup', qualifiers: ['packed'], name: 'brown sugar'`
- [ ] `2 x 200g chicken` → `qty: 2, multiplier: 200, unit: 'g', name: 'chicken'` (or normalize to 400g)
- [ ] `2x200g chicken` → Same as above (no space variant)
- [ ] `1 (14 oz) can tomatoes` → Parse correctly (decide on behavior: qty 1, unit can, or extract 14 oz as qualifier)
- [ ] Empty line → Returns `null` (no throw)
- [ ] `---` (separator) → Returns `null` (no throw)
- [ ] Emojis in input → Returns `null` or parses what it can (no throw)
- [ ] `to taste salt` → Returns `null` or low-confidence parse (no throw)
- [ ] `pinch of salt` → Handles gracefully (may need unit support for "pinch")

## Technical Notes

- Update parser to handle parentheses extraction
- Improve comma handling for qualifier separation
- Handle x multipliers (decide on normalization strategy)
- Add error handling to prevent throws on invalid input
- Consider adding a confidence score for ambiguous parses

## Related Files

- `src/lib/parse/ingredient-line.ts`
- `src/lib/parse/quantity.ts`

## Testing

- Add test cases for all punctuation scenarios
- Add test cases for x multipliers
- Add test cases for non-ingredient noise (should return null, not throw)
- Test edge cases (malformed parentheses, multiple commas, etc.)

