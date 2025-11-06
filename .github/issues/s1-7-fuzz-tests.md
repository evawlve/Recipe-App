---
title: S1.7 – Parser property/fuzz tests (light)
labels: s1, backend, tests, parser
milestone: S1 – Parser + Schema
---

## Summary

Add lightweight property-based/fuzz tests for numeric robustness and error handling.

## Scope

- Add property-based tests using fast-check (or similar)
- Test numeric stability with random fractions and ranges
- Test whitespace/punctuation variations
- Ensure parser never throws on random noisy strings

## Test Categories

### Numeric Robustness
- Generate random proper fractions (½, ⅓, ¼, etc.) + ranges
- Ensure parsed `qty` is finite and > 0 for valid inputs
- Ensure parsed `qty` is within reasonable bounds (0 < qty <= 100)

### Whitespace Variations
- Generate random whitespace/punctuation variants around valid core
- Ensure parse still succeeds
- Test various unicode spaces (thin space, non-breaking space, etc.)

### Error Handling
- Generate random noisy strings (non-ingredient text)
- Ensure parser returns `null` (not throw)
- Test with emojis, special characters, malformed input

## Acceptance Criteria

- [ ] Property-based tests added (using fast-check or similar)
- [ ] Randomized fraction inputs never crash
- [ ] Parsed qty is finite and > 0 for valid inputs
- [ ] Non-ingredient noise fails gracefully (returns null, not throw)
- [ ] Tests run quickly (< 5 seconds)
- [ ] Tests are deterministic when seeded

## Technical Notes

- Install `fast-check` as dev dependency: `npm install --save-dev fast-check`
- Use `fc.assert()` for property-based testing
- Seed random generator for reproducibility
- Keep test suite lightweight (don't overdo it)

## Related Files

- `src/lib/parse/ingredient-line.test.ts` (add to existing file)
- `package.json` (add fast-check dependency)

## Testing

- Run property tests: `npm test src/lib/parse/ingredient-line.test.ts`
- Verify tests complete quickly
- Check that no crashes occur

