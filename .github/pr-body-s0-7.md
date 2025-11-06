Adds docs/Sprint_0_Report.md summarizing Sprint 0.

Baseline metrics:
- Precision@1: 47%
- MAE (grams): 115g
- Provisional rate: 32%

DB audit and artifacts:
- Eval report: reports/eval-baseline-20251106.json
- DB audit: reports/db-audit-20251106.md
- Dataset: eval/gold.v1.csv

Next steps:
- Sprint 1: Parser + schema for unit-hint and quantity normalization
- Sprint 2: PortionOverride seed (+150 cases, gold.v2)
- Sprint 4: Synonyms + qualifiers (+100 cases, gold.v3)
- Sprint 5: Branded on-demand (+100 cases, gold.v4)

Closes #45
