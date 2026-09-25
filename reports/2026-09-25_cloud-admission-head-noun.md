# #308: `new york cheese pizza` must require `pizza` (2026-09-25)

Written by cloud session cloud-12, ROW 2 (mobile punch row **#308**). Branch `cloud/admission-head-noun` in `evawlve/Recipe-App`, one PR against `master`, left OPEN for Lane A. Lane A S58 wrote the design (from the brief). This row is design-and-pin: the narrowing and its casualties are decided below.

- **Tree.** `evawlve/Recipe-App` `origin/master` at `95d2dc4` (the #456 merge). This branch is independent of the #307 branch (evawlve/Recipe-App#457).
- **Labels.** "Measured" means a command run in this checkout on 2026-09-25. "Reasoned" means read from the code. "Not run" means the step needs the box, the DB, Typesense or an LLM key.
- **Where this file lives.** It is in `reports/`, not `sync-docs/reports/`, because this repo gitignores `sync-docs/` (`.gitignore:133`).

## 0. Gates

| gate | result |
|---|---|
| `npm run lint:ci` | 0 errors (465 warnings; the gate is errors-only) |
| `npm run typecheck` | exit 0 |
| `env -i PATH HOME DATABASE_URL=postgresql://x:x@localhost:5432/x npm run test:ci` | exit 0, 264/264 suites, 5391 passed, 1 skipped |
| `npx jest scripts/eval/__tests__/winner-diff.test.ts` (it recomputes the one-hop closure) | 198/198 |
| `one_hop_symbol_changed origin/master` for the five `filter-candidates.ts` members of `ONE_HOP_SYMBOLS` (sourced from `one-hop-guard.sh`) | all five unchanged: `detectGrainCookingContext`, `FOODS_WITH_COOKING_STATE`, `VOLUME_COOKED_GRAINS`, `COOKED_VOLUME_UNIT_RE`, `GRAIN_DRY_SIGNAL_RE` |

**Not run here, and Lane A has to run them before merge.** `winner-gate.sh --cold-seeds` needs to run on the never-asked seed and on the 120-line class ("no-brand, ≥ 3 tokens, winner lacks the last token"). That class includes right answers, so it has to be read by root cause. The golden eval and any live probe also need the box. Only pure functions were replayed here.

## 1. The mechanism (measured on shipped `95d2dc4`)

`deriveMustHaveTokens()` takes the first two core tokens. `keepAFoodToken()` re-aims the second slot onto the head noun (K2), but only on a brand-detected line (`if (!detection.isBranded || !detection.matchedBrand) return selected;`). `new york cheese pizza` is not brand-detected (`brand=-`), so its slots are `['new','york']`. A synthetic six-record pool shows the result: the strict filter admits all five "New York …" records, Muenster included. The relaxed filter (key `york`) admits the same five.

## 2. The rule as built

`keepGenericHeadNoun(selected, allCore)` in `src/lib/mapping/filter-candidates.ts` runs on the non-brand return of `keepAFoodToken()`. **When a line has at least 4 core tokens and its head noun (the last core token, K2's definition) is not already required, the rule appends that head noun.**

- **Why the threshold is 4.** A 3-core-token version reds the existing `grilled chicken breast` → `['grilled','chicken']` pin, which is measured (see mutation 3). That pin says non-brand queries "must not move at all". At 4 or more tokens, the two positional slots cover at most half of the name.
- **Why the rule appends instead of re-aiming** (the brief's candidate was `[core[0], head]`).
  - **Appending only subtracts** from the strict pass. The admitted set is a subset of the shipped one, so a winner can change only on a line whose shipped winner lacks the head noun, which is Lane A's gate class (reasoned from the code).
  - **Re-aiming** would also drop `york`, and would admit `new … pizza` records the shipped filter deletes. That collateral falls outside the class.
  - On the synthetic pool both designs admit the same two pizzas (reasoned: both pizzas carry `new`), so the pool does not separate them. The mutation test does (see mutation 4).
- **The relaxed pass changes too, and I kept that deliberately.** Relaxed runs only when the strict pool is empty, and it requires the *last* must-have token. The code's own comment calls that token "the primary noun". On these lines it is now the head noun (`pizza`) instead of the second modifier (`york`). Lines under 4 core tokens relax exactly as before.
- **`headNounReAimable` is unchanged and stays brand-only.** The tolerant compound / near-spelling head match is not extended to generic lines, so the invariant "same predicate and same input as `keepAFoodToken()`" still holds for the only lines where it acts. A generic head noun is matched word-bounded, with only the plural and synonym rescues. Pinned: `New York Minipizza` is **not** admitted for `new york cheese pizza`. That pin reds if the gate is removed.

## 3. Replays (`deriveMustHaveTokens`, ts-node, pure)

"Parsed" is the name `parseIngredientLine()` hands the mapper, which is what production passes (the `slice` hint never reaches these functions).

| input | shipped | this branch | note |
|---|---|---|---|
| `new york cheese pizza` (parsed form of `… slice`) | `new, york` | `new, york, pizza` | **target** |
| `grilled chicken caesar salad` | `grilled, chicken` | `grilled, chicken, salad` | fires (4 core) |
| `bacon egg cheese sandwich` | `bacon, egg` | `bacon, egg, sandwich` | fires |
| `peanut butter jelly sandwich` | `peanut, butter` | `peanut, butter, sandwich` | fires |
| `turkey club sandwich wrap` | `turkey, club` | `turkey, club, wrap` | fires |
| `chocolate chip cookie dough ice cream` | `chocolate, chip` | `chocolate, chip, cream` | fires; `cream` is inside `ice cream` records |
| `pizza slice` (raw) / `pizza` (parsed) | `pizza, slice` / `pizza` | unchanged | brief seed; under 4 core tokens |
| `chicken caesar salad` | `chicken, caesar` | unchanged | brief seed; 3 core |
| `buffalo chicken pizza slice` (raw) | `buffalo, chicken` | `buffalo, chicken, slice` | brief seed, **raw form only**. See §4 |
| `buffalo chicken pizza` (parsed) | `buffalo, chicken` | unchanged | 3 core |
| `new york strip steak` | `new, york` | unchanged | brief seed; `strip` is in `MODIFIER_TOKENS`, so 3 core |
| `grilled chicken breast` | `grilled, chicken` | unchanged | existing pin |
| `cheese pizza`, `tzatziki chips`, `pizza` | — | unchanged | two- and one-token lines |
| `trader joes scandinavian swimmers` | `trader, swimmers` | unchanged | brand fixture (K2) |
| `costco mini croissants` | `costco, croissants` | unchanged | brand fixture |
| `kirkland signature` | `kirkland, signature` | unchanged | brand fixture |
| `sams club members mark chicken` | `sams, chicken` | unchanged | brand fixture |
| `pizza hut cheese sticks` | `pizza, sticks` | unchanged | brand-led, K2 |

Synthetic `filterCandidatesByTokens(pool, 'new york cheese pizza')`, where the pool is Muenster, two NY-style cheese pizzas, NY Cheddar, a generic `Pizza, cheese, regular crust` and NY Cheesecake:

| pass | shipped | this branch |
|---|---|---|
| strict | the 5 "New York …" records, Muenster included | the 2 NY-style pizzas |
| relaxed | the same 5 | the 2 NY-style pizzas + the generic pizza |

## 4. Casualties, decided

- **Every ≥ 4-core-token non-brand line now requires its last core token.** For a dish name the last core token is almost always the dish, which is the point of the rule. Where a record spells the head differently (`fries` vs `French Fried Potatoes`), the strict pool loses those records. If the pool empties, the relaxed pass requires the head alone. Lane A's class read is where these show up.
- **A trailing non-dish word becomes the head** if it survives `MODIFIER_TOKENS`: a flavour, a size, or a portion word left in a raw string. The raw `buffalo chicken pizza slice` gets `slice`. Production hands the post-parse name (`buffalo chicken pizza`, 3 core, unchanged), so this case needs a caller that bypasses the parser. None is known (reasoned; not measured on the box).
- **3-core-token lines are deliberately left alone**, including the shape of the target (`grilled chicken breast`, `chicken caesar salad`). They stay in the 120-line class as unfixed members.

## 5. Pins and mutation receipts

The pins extend `src/lib/mapping/__tests__/possessive-brand-token-filter.test.ts` with 7 cases. The file now has 26 tests, and all the existing pins are byte-identical. All mutations below were measured, each on a scratch copy restored byte-for-byte:

| # | mutation | red |
|---|---|---|
| 1 | disable the slot (`return selected`) | 4: append, cheese-vs-pizza, relaxed-to-head, minipizza |
| 2 | ungate `headNounReAimable` (`= true`) | 2: the existing tzatziki pin and the new minipizza pin |
| 3 | threshold 3 instead of 4 | 2: the existing `grilled chicken breast` pin and the new 3-core boundary pin |
| 4 | re-aim `[core[0], head]` instead of append | 1: the append pin |

## 6. What was not touched

Nothing changed in `src/lib/search/`, `normalization-rules.json`/`RULES_VERSION`, any brand list or the lexicon, `detectBrandInQuery`, the five `ONE_HOP_SYMBOLS`, `scripts/eval/`, the golden set or `knownIssue`, `claims.json`, `package.json` or `.env*`. The diff is `filter-candidates.ts` (one new function and a one-line call site), the test extension and this report.
