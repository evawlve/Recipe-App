# #307: a leading `pound` in `pound cake` is part of the name, not a unit (2026-09-25)

Written by cloud session cloud-12, ROW 1 (mobile punch row **#307**). Branch `cloud/parse-leading-measure` in `evawlve/Recipe-App`, one PR against `master`, left OPEN for Lane A. The design is Lane A S58's (mobile `plans/v1/alpha-punch-list.md` row #307, from the brief). This session built it and pinned it.

- **Tree.** `evawlve/Recipe-App` `origin/master` at `95d2dc4` (the #456 merge).
- **Labels.** "Measured" means a command run in this checkout on 2026-09-25. "Reasoned" means read from the code. "Not run" means the step needs the box, the DB, Typesense or an LLM key, and this session had none of them.
- **Where this file lives.** The brief named `sync-docs/reports/`, but `sync-docs/` is in this repo's `.gitignore` (`git check-ignore -v` → `.gitignore:133:sync-docs/`), so a file there would not reach the PR. This file follows the cloud-7 precedent and lives in `reports/`.

## 0. Gates

| gate | result |
|---|---|
| `npm run lint:ci` | 0 errors (465 warnings; the gate is errors-only) |
| `npm run typecheck` | exit 0 |
| `env -i PATH HOME DATABASE_URL=postgresql://x:x@localhost:5432/x npm run test:ci` | exit 0, 265/265 suites, 5412 passed, 1 skipped |
| `npx jest src/lib/parse` | 19/19 suites, 402 passed, 1 skipped |

**Not run here, and Lane A has to run them before merge.** `src/lib/parse/` is on `FROZEN_INPUT_PATHS` in `scripts/eval/winner-gate.sh`, so `winner-diff` cannot see this change and the gate would exit 3. The gate for this change is the pinned composite arm (#167 method). The short seeds need a hand-written pin file. The golden eval and any live probe also need the box. After deploy, the two poisoned rows (`cake` → OFF 30063143, `soda` → OFF 0078000016161) need evicting in the same window, per the row.

## 1. The mechanism (measured on shipped `95d2dc4`, confirming S58)

`parseIngredientLine()` has three places that can consume the leading token as a unit:

1. the `startsWithUnit` decide-once, consumed in the first branch;
2. the `else if (mass || volume)` branch, guarded by `!startsWithUnit || i > 0`, which lets a declined `startsWithUnit` straight through;
3. the after-parentheses `!unit` check, which the file already calls the "THIRD count-unit consumption site".

`normalizeUnitToken('pound')` returns `lb`, and `MASS_IN_G.lb` is 453.6.

## 2. The rule as built

`leadingMeasureWordIsName(mergedTokens, hadLeadingArticle)` in `src/lib/parse/ingredient-line.ts` is decided once, next to `leadingIsBrandedAnatomy`, and all three sites honour it (guarded `i === 0`, the same template). It is true only when all of these hold:

- the leading word is a **mass or volume** unit word (count words are out of scope, so `squirt`, `slice` and `scoop` still lead portions);
- **no article** preceded it. `const hadLeadingArticle = leadingArticlePrecedesUnit(mergedTokens)` is captured *before* the shift and passed in, as S48's lens required;
- a follower **exists** and is **not `of`**;
- **the follower is a word and not a connector.** This part is new, beyond S58's rule: the follower must start with a letter (`/^\p{L}/u`) and must not be one of `and`, `&`, `+` or `plus`.

**Why I narrowed the rule, stated plainly.** S58's rule ("next token exists and is not `of`") fires on the article-less `cup and a half of rice`, which the brief asked me to state. It would have turned a correct parse into a wrong one: shipped reads qty 1.5, cup, `rice` through the same-unit continuation branch, and the rule-as-briefed reads qty 1, no unit, name `cup and a half of rice`. The same holds for `cup plus 2 tbsp flour`, which the compound branch reads as 1.12325 cups. The word-follower clause also keeps `cup, packed, brown sugar` and `cup (8 oz) milk` on their shipped parses. The narrowing only ever makes the rule fire *less*, so it cannot add a casualty the briefed rule did not have. None of the five census lines is affected by it.

## 3. Replay, before and after

The table below comes from a ts-node replay of the pure function (`scripts` tsconfig, `--transpile-only`). "Before" is `95d2dc4` and "after" is this branch. Tuples are `qty / unit / name / hint`.

| line | before | after | class |
|---|---|---|---|
| `pound cake slice` | 1 / lb / `cake` / slice | 1 / — / `pound cake` / slice | **target** |
| `pound cake` | 1 / lb / `cake` / — | 1 / — / `pound cake` / — | **target** |
| `pound cake 1 slice` | 1 / lb / `cake 1` / slice | 1 / — / `pound cake 1` / slice | **target** |
| `cup noodles` | 1 / cup / `noodles` / — | 1 / — / `cup noodles` / — | **target** |
| `pound cake, sliced` | 1 / lb / `cake` (q: sliced) | 1 / — / `pound cake` (q: sliced) | target |
| `1 slice pound cake` | 1 / slice / `pound cake` | unchanged | control |
| `2 lb pound cake` | 2 / lb / `pound cake` | unchanged | control |
| `slice of pound cake` | 1 / slice / `pound cake` | unchanged | control |
| `cup of egg whites` | 1 / cup / `egg` / white | unchanged | control (census) |
| `pinch of salt` | 1 / pinch / `salt` | unchanged | control (census) |
| `a cup and a half of teriyaki chicken` | 1.5 / cup / `teriyaki chicken` | unchanged | control |
| `an ounce of cheese` | 1 / oz / `cheese` | unchanged | control |
| `an ounce cheese` | 1 / oz / `cheese` | unchanged | control (article guard) |
| `squirt soda` | 1 / squirt / `soda` | unchanged | control (count word) |
| `quarter pounder` | 0.25 / — / `pounder` | unchanged | control (already wrong, not this rule's) |
| `half pound cake` | 0.5 / lb / `cake` | unchanged | control (`half` is a multiplier) |
| `cup and a half of rice` | 1.5 / cup / `rice` | unchanged | **stated**: the narrowing above keeps it |
| `cup plus 2 tbsp flour` | 1.12325 / cup / `flour` | unchanged | control (connector) |
| `cup (8 oz) milk` | 1 / cup / `8 oz milk` | unchanged | control (non-word follower) |
| `cup, packed, brown sugar` | 1 / cup / `brown sugar` (q: packed) | unchanged | control (non-word follower) |
| `pounds of chicken` | 1 / lb / `chicken` | unchanged | control |
| `pound` | 1 / lb / `pound` | unchanged | control (no follower) |
| `a pound cake` | 1 / lb / `cake` | unchanged | **known limit** (article reading wins) |
| `about 1 pound cake` | 1 / lb / `cake` | unchanged | **known limit** (a quantity precedes) |
| `pound ground beef` | 1 / lb / `ground beef` | 1 / — / `pound ground beef` | **named cost** (S58's) |
| `ounce cheese` | 1 / oz / `cheese` | 1 / — / `ounce cheese` | named cost |
| `cup rice` | 1 / cup / `rice` | 1 / — / `cup rice` | named cost, same class |
| `tbsp peanut butter` | 1 / tbsp / `peanut butter` | 1 / — / `tbsp peanut butter` | named cost, same class |
| `lb cake` | 1 / lb / `cake` | 1 / — / `lb cake` | same class |
| `g fuel` | 1 / g / `fuel` | 1 / — / `g fuel` | same class; this also happens to keep the G Fuel brand whole |

**The named costs.** Four kinds of line change meaning. Each one is a digitless, article-less measure with no `of`: `pound ground beef`, `ounce cheese`, `cup rice` and `tbsp peanut butter`. None of them appears among the 6,980 lines of S58's organic census (reported, not re-measured here). They now bill a default serving of a name that starts with a unit word, not one unit of the food. Lane A's arm decides whether any of them resolves to a worse food. If so, the rule gets reversed or narrowed further. For example, it could skip abbreviations, but that loses `g fuel`.

**The limits, not fixed here.** `a pound cake` still parses as a pound of `cake`, because the article gate takes precedence by design. `1 pound cake` and `about 1 pound cake` still parse as 1 lb `cake`, because a quantity precedes the word and the rule does not fire. Both are pinned as current behaviour, so any later change to them has to be deliberate.

## 4. Pins and mutation receipts

A new suite, `src/lib/parse/__tests__/leading-measure-is-name.test.ts`, holds 28 exact tuples: 5 targets, 19 controls and 4 named costs. Every control was replayed on `95d2dc4` before the edit and pinned as it came out. All mutations below were measured, each on a scratch copy restored byte-for-byte:

| mutation | red pins |
|---|---|
| drop the third-site (after-parentheses) guard | 9 of 28: every target and named cost |
| drop the second-site guard | the same 9 |
| disable the rule (`const leadingMeasureIsName = false && …`) | the same 9 |
| drop the article capture (pass `false`) | `an ounce cheese`, `a pound cake` |
| drop the connector clause | `cup and a half of rice`, `cup plus 2 tbsp flour` |

The brief expected that dropping the article capture would red `a cup and a half of teriyaki chicken`. It does not: that line's follower after the shift is `and`, which the connector clause declines on its own. The article guard is pinned by `an ounce cheese` instead. That line has the same shape (article, mass unit, word follower) with no connector to mask it.

## 5. What was not touched

Nothing changed in `unit.ts`, the quantity strip, `detectBrandInQuery` or any other brand path, `normalization-rules.json`/`RULES_VERSION`, `scripts/eval/`, the golden set, `claims.json`, `package.json` or `.env*`. The diff is one source file (CRLF preserved; `git diff --stat` counts only the lines added) plus the new test file and this report.
