---
title: S1.8 – Docs & changelog
labels: s1, docs, documentation
milestone: S1 – Parser + Schema
---

## Summary

Update documentation and changelog to reflect parser enhancements and new features.

## Scope

- Create/update `docs/parser.md` with parser documentation
- Update `CHANGELOG.md` with Sprint 1 changes
- Document recognized qualifiers and unit hints
- Add before/after examples

## Documentation Updates

### docs/parser.md
- Parser overview and capabilities
- Supported input formats
- Examples of parsing:
  - Fractions: `2½ cups`
  - Ranges: `2-3 eggs`
  - Qualifiers: `large boneless chicken`
  - Unit hints: `egg yolks`, `garlic cloves`
- List of recognized qualifiers
- List of recognized unit hints
- Error handling behavior

### CHANGELOG.md
- Add Sprint 1 section
- List all enhancements:
  - Fraction and range parsing
  - Qualifier extraction
  - Unit hint extraction
  - Noise handling improvements
  - PortionOverride tables
  - Feature flags

## Acceptance Criteria

- [ ] `docs/parser.md` created/updated with comprehensive documentation
- [ ] Examples show before/after parsing
- [ ] List of recognized qualifiers documented
- [ ] List of recognized unit hints documented
- [ ] `CHANGELOG.md` updated with Sprint 1 changes
- [ ] Documentation is clear and easy to follow

## Technical Notes

- Use markdown format
- Include code examples with syntax highlighting
- Add tables for qualifiers and unit hints lists
- Link to related issues/PRs if applicable

## Related Files

- `docs/parser.md` (new or update)
- `CHANGELOG.md` (update)

## Testing

- Review documentation for clarity
- Verify all examples are accurate
- Check links work

