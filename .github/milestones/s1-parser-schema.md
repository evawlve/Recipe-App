# Sprint 1 – Parser + Schema

**Due Date:** End of Week 1  
**Status:** In Progress

## Overview

Enhance the ingredient parser to handle real-world input variations (fractions, ranges, qualifiers) and add schema support for portion overrides.

## Goals

- Parse vulgar fractions (½ ¼), ranges (1-2), qualifiers (large, raw)
- Add PortionOverride + UserPortionOverride tables
- Add feature flags for safe rollout
- Ensure parser handles real-world inputs

## Issues

- [ ] S1.1 – Parser: numeric normalization (fractions, ranges)
- [ ] S1.2 – Parser: qualifiers + unitHint extraction
- [ ] S1.3 – Parser: noise + punctuation robustness
- [ ] S1.4 – Schema migration: PortionOverride + UserPortionOverride
- [ ] S1.5 – Feature flags & config
- [ ] S1.6 – Parser unit tests (core suite)
- [ ] S1.7 – Parser property/fuzz tests (light)
- [ ] S1.8 – Docs & changelog

## Success Criteria

- [ ] All parser tests pass (25 core cases + property tests)
- [ ] Can parse "2½ egg yolks" → qty: 2.5, unitHint: yolk
- [ ] Can parse "2-3 large eggs" → qty: 2.5, qualifiers: ['large']
- [ ] PortionOverride table queryable in Prisma Studio
- [ ] Migration runs without errors
- [ ] Feature flags configured and working
- [ ] Documentation updated

## Related

- Sprint 0: Baseline metrics and FDC API setup
- Sprint 2: Portion seeds (200-300 portion overrides)
- Sprint 3: Resolver integration (resolvePortion() with 5-tier fallback)

