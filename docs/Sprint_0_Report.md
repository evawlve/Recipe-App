# Sprint 0 Report — Baseline & FDC API Setup

Date: 2025-11-06
Milestone: Sprint 0 — Audit, Baseline & FDC API Setup

## Goals
- Understand current DB coverage (what foods exist, what's missing)
- Set up FDC API client with rate limiting + caching
- Create gold evaluation dataset (~100 cases)
- Record baseline metrics

## Deliverables
- FDC API client: src/lib/usda/fdc-api.ts (rate limited, cached)
- Gold dataset: eval/gold.v1.csv (100 rows, versioned)
- Eval harness: eval/run.ts → reports/eval-baseline-YYYYMMDD.json
- DB audit: scripts/audit-db-coverage.ts → reports/db-audit-YYYYMMDD.md

## Baseline Metrics (gold.v1)
Source: reports/eval-baseline-20251108.json
- Mapping P@1: 38.0%
- Portion MAE: 114.0 g
- Provisional rate: 34.0%

**Database State:** 1493 foods (Foundation + SR Legacy mini dataset + additional foods)

Notes:
- Baseline updated to reflect current database state with 1493 foods
- Lower P@1 (38% vs 47%) likely due to more candidate foods affecting search ranking
- Many misses stem from portion resolution (unit hints) and candidate ranking (uncooked vs cooked)
- Branded path validated separately via smoke script; ENABLE_BRANDED_SEARCH remains false

## DB Coverage Highlights
Source: reports/db-audit-20251106.md
- Foods: 3,585
- Units: 1,882
- Barcodes: 0 (GTIN coverage not yet populated)
- Sources: usda=3500, template=76, community=9
- Top categories (by count): meat (1202), dairy (327), rice_uncooked (112), fruit (98), veg (79), legume (61), sauce (53), oil (49), flour (47), sugar (24)
- Top unit labels present: "1 cup, diced" (1179), "1 cup" (292), "1 tbsp" (218), "1 tsp" (73), egg sub-units present (yolk/white)

## Top Gaps & Findings
- GTINs: 0 barcodes — branded dedupe/verification will need GTINs (planned Sprint 5)
- Portions: Many misses on cooked vs uncooked and volume→grams resolution; needs overrides and unit-hint plumbing
- Ranking: Candidate ranking favors uncooked variants in some grains/veg; needs cooked-state boosting and category priors
- Branded coverage: Smoke tests pass; leave flag off until Sprint 5 on-demand path
- Synonyms/International variants: Not yet addressed (planned Sprint 4)

## Risks
- Over-reliance on density fallback inflates MAE
- Missing GTINs will hinder branded QA until seeded
- Gold drift: without ID/regex hints, name changes can break P@1; mitigated via expected_food_id_hint

## Next Steps
- Sprint 1: Parser + Schema improvements for unit-hint and quantity normalization
- Sprint 2: PortionOverride seed (+150 cases to gold.v2), focus on piece/leaf/clove
- Sprint 4: Synonyms + qualifier parsing (+100 cases to gold.v3)
- Sprint 5: Branded on-demand (+100 branded to gold.v4); seed GTINs
- Sprint 7: User-pain set (+50 to gold.v5)

## Artifacts
- Eval report: reports/eval-baseline-20251106.json
- DB audit: reports/db-audit-20251106.md
- Dataset: eval/gold.v1.csv (versioned; immutable)

## Closeout
- PRs:
  - S0.1 FDC API Client: #46 (closes #39, #43, #44)
  - S0.2 DB Audit Script: #47 (closes #40)
  - S0.3 Gold Dataset v1 + Eval Harness: #48 (closes #41)
- All Sprint 0 issues are covered by above PRs; this report finalizes Sprint 0.

Milestone readiness: ✅ Ready to close upon merging PRs.
