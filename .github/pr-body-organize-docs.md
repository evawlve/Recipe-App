## PR Title (Conventional Commit)

```
chore(docs): organize documentation and add CI automation
```

**Closes #___ | Part of Milestone: S1 – Parser + Schema**

## Summary

This PR organizes all documentation into the `docs/` directory, adds comprehensive CI automation (Danger, eval gates, migration smoke tests), and implements workflow improvements for Sprint 1 tightening requirements.

## Change Type

- [x] `chore/docs` - Documentation or maintenance

## Scope

- [x] Docs/Infra
- [x] Parser
- [x] Schema/Migrations
- [x] Tooling/ci

## Validation (must pass locally or via CI artifacts)

- [x] **Eval suite**: `npm run eval` (no P@1 drop > 1.5pp, no MAE increase > 2g)
  - [x] Attach `reports/eval-*.json` (N/A - no parser logic changes)
- [x] **Parser tests**: `npm test src/lib/parse` (core + property)
- [x] **Parser bench**: `npm run parser:bench` (target p95 < 0.5 ms/line)
  - [x] Attach `reports/parser-bench-*.json` (N/A - no parser logic changes)
- [x] **Migrate smoke**: `npm run migrate:smoke` (apply + seed + reset clean)
- [x] **Linter/Typecheck**: `npm run lint && npm run typecheck`
- [x] **Feature flags respected**: no behavior change unless the flag is enabled
  - `ENABLE_PORTION_V2`: ☑ N/A ☐ Verified
  - `ENABLE_BRANDED_SEARCH`: ☑ N/A ☐ Verified

## Metrics & Telemetry

- [x] New counters/gauges emitted (names + sample) - N/A
- [x] Noisy logs avoided; no secrets in logs

## Risk & Rollback

**Risk level**: ☑ Low ☐ Medium ☐ High

**Rollback plan**: 
- [x] Toggle flag - N/A
- [x] Revert migration - N/A
- [x] Revert commit - Can revert if needed
- [x] Deploy previous image - N/A

**Data backfill/migration notes (if any):**
None - no database changes

## Docs & Changelog

- [x] Updated `CHANGELOG.md` - Added Sprint 0 information
- [x] Updated docs (e.g., `docs/s1-parser.md`, `docs/eval.md`)
  - Created `docs/eval.md` - Evaluation system documentation
  - Created `docs/ops.md` - Feature flags and rollout guide
  - Updated `docs/s1-parser.md` - Added normalization order, locale edge cases, performance docs
  - Updated `docs/README.md` - Added structure and links
- [x] Updated `.env.example` (if new env vars) - N/A

## Changes

### Documentation Organization
- Moved `parser.md` → `docs/s1-parser.md` (Sprint 1 specific naming)
- Moved `USDA_SATURATION_README.md` → `docs/`
- Moved `USDA_SATURATION_SUCCESS.md` → `docs/`
- Moved `MAIN_PHOTO_FEATURE.md` → `docs/`
- Added Sprint 0 information to `CHANGELOG.md`
- Created `docs/eval.md` with comprehensive evaluation system documentation
- Created `docs/ops.md` with feature flags, rollout, and rollback procedures

### CI Automation & Workflows
- **Danger**: Added `dangerfile.ts` to enforce tests when parser code changes
- **Eval Baseline**: Added `eval-main.yml` to generate baseline on main branch
- **Eval Gates**: Updated `eval.yml` to download and compare against main baseline
- **Migration Smoke**: Already exists, added caching and Prisma generate
- **Parser Bench**: Already exists, added caching
- **PR Size**: Added automatic PR size labeling (XS/S/M/L/XL)
- **Env Check**: Added workflow to verify `.env.example` parity
- **Dependabot**: Added weekly npm dependency updates

### Scripts
- Updated `ci-check-eval-gates.js` to support baseline directory argument
- Created `check-env-example.js` to validate environment variable documentation
- Added `npm run eval` script for consistency

### Code Quality
- Added `.github/CODEOWNERS` for clear code ownership
- Added npm and Prisma caching to all CI workflows
- Cleaned up completed Sprint 1 issue files (`.github/issues/s1-*.md`)

## Testing

- ✅ All existing tests pass
- ✅ Linter passes
- ✅ Typecheck passes
- ✅ Build succeeds
- ✅ No parser logic changes (documentation and CI only)

## Screenshots / Output

N/A - Documentation and CI configuration changes only

