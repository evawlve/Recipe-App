# Spanish eval corpus — a baseline, NOT part of any gate

**These cases never enter `scripts/eval/golden-set.json` and the nightly sweep never runs them.**
They are a measured starting point that every later Spanish change gates against.

| file | what |
|---|---|
| `spanish-corpus-2026-09-12.json` | 43 cases: `rawText`, the English the user MEANS, `expectName`, scale-free per-100 g bands |
| `baseline-results-2026-09-12.json` | what the pipeline returned, one probe each, cold |
| `baseline-grades-2026-09-12.json` | per-case verdict and axis, with the reasoning for each |
| `probe-spanish-corpus.py` | the harness; `DEV_API_KEY` in the env, one `nosave=1&nocache=1&debug=1` POST per line |

Baseline taken 2026-09-12 against box build `kmS4DBxJl0uKD8BxvhZKJ`: **32.6% of lines materially
wrong [20.5, 47.5]**, decomposing as packaged 0/6 · bare staples 1/12 · dishes 2/6 · quantities 5/9
· bare `con`/`y` composites 6/7.

**Read the category ordering, not the point estimates** — one draw per line, one grader, and
segmentation is demonstrably a draw (one line returned 2 items on 09-12 and 3 on 09-11).

Full reasoning, the failure classes and what they imply for insertion order:
`KindaHealthyMobile/sync-docs/reports/2026-09-12_spanish-eval-corpus-baseline.md`, which owns them.
Planner entry: that repo's `reports/2026-09-11_spanish-version-scoping-and-insertion.md` (punch #170).

Re-running this rewrites nothing but these files; it does write `MappingEventLog` and the three
stub tables (`nosave=1` does not suppress those), and `FoodMapping` must stay +0.
