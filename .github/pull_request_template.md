## PR Title (Conventional Commit)

```
feat(parser): add range parsing for 1½–2 tsp
```

**Closes #___ | Part of Milestone: S1 – Parser + Schema**

## Summary

<!-- 2–3 lines: what & why -->

## Change Type

- [ ] `feat` - New feature
- [ ] `fix` - Bug fix
- [ ] `refactor` - Code refactoring
- [ ] `perf` - Performance improvement
- [ ] `chore/docs` - Documentation or maintenance
- [ ] `db/migration` - Database schema changes
- [ ] `tooling/ci` - Build, CI, or tooling changes

## Scope

- [ ] Parser
- [ ] Schema/Migrations
- [ ] Branded Import (FDC)
- [ ] Resolver
- [ ] Search/Ranking
- [ ] UI
- [ ] Docs/Infra

## Validation (must pass locally or via CI artifacts)

- [ ] **Eval suite**: `npx ts-node eval/run.ts` (no P@1 drop > 1.5pp, no MAE increase > 2g)
  - [ ] Attach `reports/eval-*.json`
- [ ] **Parser tests**: `npm test src/lib/parse` (core + property)
- [ ] **Parser bench**: `npm run parser:bench` (target p95 < 0.5 ms/line)
  - [ ] Attach `reports/parser-bench-*.json`
- [ ] **Migrate smoke**: `npm run migrate:smoke` (apply + seed + reset clean)
- [ ] **Linter/Typecheck**: `npm run lint && npm run typecheck`
- [ ] **Feature flags respected**: no behavior change unless the flag is enabled
  - `ENABLE_PORTION_V2`: ☐ N/A ☐ Verified
  - `ENABLE_BRANDED_SEARCH`: ☐ N/A ☐ Verified

## Metrics & Telemetry

- [ ] New counters/gauges emitted (names + sample)
- [ ] Noisy logs avoided; no secrets in logs

## Risk & Rollback

**Risk level**: ☐ Low ☐ Medium ☐ High

**Rollback plan**: 
- [ ] Toggle flag
- [ ] Revert migration
- [ ] Revert commit
- [ ] Deploy previous image

**Data backfill/migration notes (if any):**
<!-- Describe any data migrations, backfills, or manual steps required -->

## Docs & Changelog

- [ ] Updated `CHANGELOG.md`
- [ ] Updated docs (e.g., `docs/s1-parser.md`, `docs/eval.md`)
- [ ] Updated `.env.example` (if new env vars)

## Screenshots / Output

<!-- Console output, perf charts, or UI snaps -->
