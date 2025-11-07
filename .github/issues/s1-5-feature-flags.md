---
title: S1.5 – Feature flags & config
labels: s1, backend, infra, config
milestone: S1 – Parser + Schema
---

## Summary

Add feature flags for safe rollout of new parser and portion resolution features.

## Scope

- Create feature flag system
- Add `ENABLE_PORTION_V2` flag (default: false)
- Add `ENABLE_BRANDED_SEARCH` flag (default: false)
- Ensure old logic untouched when flags disabled
- Make flags togglable at runtime (process restart OK)

## Feature Flags

### ENABLE_PORTION_V2
- Controls new portion resolution logic using PortionOverride tables
- Default: `false` (use old logic)
- When `true`: Use new 5-tier fallback system (will be implemented in Sprint 3)

### ENABLE_BRANDED_SEARCH
- Controls FDC API branded food search
- Default: `false` (don't search branded foods)
- When `true`: Allow searching branded foods via FDC API (from Sprint 0)

## Acceptance Criteria

- [ ] Feature flags read from `.env` file
- [ ] `ENABLE_PORTION_V2` defaults to `false`
- [ ] `ENABLE_BRANDED_SEARCH` defaults to `false`
- [ ] Flags can be toggled via environment variables
- [ ] Old logic remains untouched when `ENABLE_PORTION_V2=false`
- [ ] Old logic remains untouched when `ENABLE_BRANDED_SEARCH=false`
- [ ] Flags are accessible throughout the codebase
- [ ] Document flags in `.env.example` or README

## Technical Notes

- Create `src/lib/flags.ts` to centralize feature flag logic
- Use `process.env.ENABLE_PORTION_V2 === 'true'` pattern
- Consider using a typed flag system for better DX
- Add flags to `.env.example` with comments

## Related Files

- `src/lib/flags.ts` (new file)
- `.env.example`
- `README.md` (documentation)

## Testing

- Test with flags enabled
- Test with flags disabled
- Verify old logic still works when flags are off
- Test flag reading from environment

