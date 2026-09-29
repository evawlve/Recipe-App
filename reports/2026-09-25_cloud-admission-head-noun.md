# #308: `new york cheese pizza` should resolve to a pizza (2026-09-25)

Written by cloud session cloud-12, ROW 2 (mobile punch row **#308**). Branch `cloud/admission-head-noun` in `evawlve/Recipe-App`, evawlve/Recipe-App#458 against `master`, left OPEN for Lane A. Lane A S58 wrote the original design (from the brief). The first build (v1, "append the head noun") was RED on Lane A S59's two cold gates. This file describes **v2**, which is built to Lane A's reading of that red. v1 and the reasons it failed are kept in §5 as the record of why v2 has this shape.

- **Tree.** The branch head after Diego's `1f1c0f8a` (`origin/master` merged in, which carries #455 and #457). `git diff origin/master --stat` on the v2 commit shows only this PR's three files.
- **Labels.** "Measured" means a command run in this checkout on 2026-09-25. "Reasoned" means read from the code. "Not run" means the step needs the box, the DB, Typesense or an LLM key.
- **Where this file lives.** It is in `reports/`, not `sync-docs/reports/`, because this repo gitignores `sync-docs/` (`.gitignore:133`).

## 0. Gates (v2)

| gate | result |
|---|---|
| `npm run lint:ci` | 0 errors (465 warnings; the gate is errors-only) |
| `npm run typecheck` | exit 0 |
| `env -i PATH HOME DATABASE_URL=postgresql://x:x@localhost:5432/x npm run test:ci` | exit 0, 267/267 suites, 5428 passed, 1 skipped |
| `npx jest scripts/eval/__tests__/winner-diff.test.ts` | 198/198 |
| `one_hop_symbol_changed origin/master` for the five `filter-candidates.ts` members of `ONE_HOP_SYMBOLS` (sourced from `one-hop-guard.sh`) | all five unchanged |

**Not run here, and Lane A has to run them before merge.** Lane A re-gates on both seed files, `seeds308.txt` (171 lines) and `seeds308b.txt` (the top 100 of v1's firing population), with the 250-line random regression. Only pure functions and synthetic pools were exercised here.

## 1. The mechanism (measured on shipped `95d2dc4`)

`deriveMustHaveTokens('new york cheese pizza')` → `['new','york']`. K2's head-noun slot acts only on a brand-detected line, and `york` has no lexicon hit, so on this line every "New York …" record is admitted and `New York Muenster Cheese` wins.

## 2. The rule (v2)

The rule lives in `filterCandidatesByTokens()` in `src/lib/mapping/filter-candidates.ts`, and runs on the **strict pass only**. It fires when all of these hold:

- the line is not brand-detected (`!headNounReAimable`);
- the derivation reached the positional core-token path;
- there are at least 4 core tokens (`GENERIC_FULL_COVERAGE_MIN_CORE`);
- more than one candidate was admitted.

When it fires, the shipped admission is re-run with **every core token** required. If that set is non-empty and smaller than the shipped one, the pool narrows to it. Otherwise the pool is exactly what shipped.

- **`deriveMustHaveTokens()` returns exactly what it did on master.** It gains an optional `out` parameter that exposes the core-token list on the one path that produces it. Its only caller is `filterCandidatesByTokens()`.
- **The relaxed pass is byte-identical to master.** Its key is still the last shipped must-have token.
- **It can never empty a pool.** The narrowed set is a subset of the shipped admitted set by construction (reasoned): it applies the same `every()` predicate over a superset of tokens, the tolerant head match stays off because the line is not brand-detected, and the rule yields whenever the narrowed set is empty.
- **A winner can change only on a line where some admitted record names the whole query and the shipped winner does not.** Every other line is byte-identical (reasoned).

How v2 answers Lane A's three readings of the v1 red:

| Lane A's reading of the v1 red | how v2 handles it |
|---|---|
| **Descriptor-final lines**: the "head" is not the food (`extract`, `style`, `meal prep`, `dinner`, `jar`, `lata`) | v2 never picks a head. A `greek yogurt vanilla extract nonfat` record must carry all four core words to be preferred. A yogurt record doesn't, so the rule yields and the shipped pool (the yogurt) stands. |
| **Token-sorted forms**: the last token is arbitrary (`chicago dog hot portillo style`) | Full coverage is order-free. A sorted form behaves the same as its natural spelling. |
| **Brand-led lines the detector misses** (`jimmy johns turkey sub`, `mccanns steel cut rolled oats`): a head-bearing record without the brand words displaced the brand's record, or the pool emptied | A record only qualifies if it carries the brand words too. `Lin's Turkey Sub` and `Roland Steel Cut Oats` (reasoned from their names) cannot qualify. When no record carries every word, the pool is the shipped one. |
| **"No-fire on relaxed-pass emptiness"** | The strict pool never empties because of this rule, and the relaxed pass is unchanged. So the rule cannot create a relaxed retry that shipped didn't have, and never takes part in one. |

I did not build a stop-list of descriptor finals. Full coverage makes it unnecessary for every case in both of Lane A's red tables, and a closed word list would need its own population measurement.

## 3. Pins (synthetic pools) and mutation receipts

The pins are in the `#308` block of `src/lib/mapping/__tests__/possessive-brand-token-filter.test.ts`. The file has 27 tests, all passing, and every pre-existing pin is unchanged.

| pin | query / pool | result |
|---|---|---|
| derivation unchanged | `deriveMustHaveTokens('new york cheese pizza')` | `['new','york']`, same as master |
| target | NY pool: Muenster, 2 NY-style cheese pizzas, NY Cheddar, a generic pizza, NY Cheesecake | the 2 NY-style pizzas |
| order-free | `cheese new pizza york` on the same pool | the same 2 pizzas |
| yields, never empties | `greek yogurt vanilla extract nonfat` on Greek vanilla yogurt, Greek plain yogurt, Vanilla Extract | the 2 yogurts, which is the shipped pool |
| brand-miss shape | `jimmy johns turkey sub` on JJ `Turkey Tom`, JJ `Italian Sub` | both kept (shipped); `Italian Sub` has the head but not `turkey` |
| relaxed unchanged | NY pool, `relaxed: true` | the 5 `york` records, same as master |
| 3-core boundary | `grilled chicken breast` on `Grilled Chicken`, `Grilled Chicken Breast` | both kept |
| brand-detected | `pizza hut cheese sticks` on `Breadsticks`, `Cheese Sticks` (Pizza Hut) | both kept; the rule does not run |

All mutations below were measured, each on a scratch copy restored byte-for-byte:

| mutation | red |
|---|---|
| disable the rule | target and order-free |
| no fallback (take the narrowed set even when empty) | yields-never-empties and the brand-miss shape |
| run it on the relaxed pass | relaxed unchanged |
| run it on brand-detected lines | brand-detected |
| threshold 3 | 3-core boundary |
| v1 shape (require only shipped + last core token) | order-free and the brand-miss shape |

## 4. What Lane A should expect (reasoned, not measured)

- **Firing population.** v2 can fire only where v1 could: non-brand lines with at least 4 core tokens, and only when more than one candidate is admitted. It is inert on every line of that set where no admitted record carries every core word, and there the result is identical to master. The movers are therefore a strict subset of the lines where v1 could move, restricted to lines where some admitted record names the whole query.
- **v1's wins may shrink.** A win survives only where the right record spells every core word. On gate 1, the NY pizza fix holds: `New York Style! Real Cheese Pizza` carries `new`, `york`, `cheese` and `pizza`. Coffee-Mate, Oscar Mayer and Ore-Ida are only listed as brand names in the gate output, so whether those wins survive has to come from the re-gate.
- **The residual risk is the rule itself.** A record that repeats all the query's words can still be the wrong food. That is inherent to a coverage preference, and it is the class to read by root cause on the re-gate.

## 5. v1, and why it was RED (Lane A S59, recorded on the PR)

v1 changed `deriveMustHaveTokens()` itself. On a non-brand line with at least 4 core tokens, it **appended** the last core token (`['new','york','pizza']`). Lane A measured the effect over 6,843 distinct `MappingEventLog.normalizedForm` values: the must-have set changed on 356 forms (1,605 organic events). On gate 2, the top 100 of those, 12 winners changed and 4 went to no winner. On gate 1, the 171-line class, 16 winners changed and 8 went to no winner, and the 250-line regression had 0 movers.

**Right answers that went wrong or empty:**
- `greek yogurt vanilla extract nonfat` → Vanilla Extract;
- `chicago dog hot portillo style` → hot dog buns;
- `una coca cola de lata` → no winner;
- `grilled chicken meal prep`, `hungry-man salisbury steak dinner`, `butter chicken sauce jar` → no winner.

**Brands lost:**
- `jimmy johns turkey sub`;
- `cheddars monte cristo sandwich`;
- `mccann's steel cut rolled oats`;
- `soylent meal replacement shake`.

The replays in this checkout reproduce the mechanism on each form. The appended token was `extract`, `style`, `lata`, `with`, or the last word of a token-sorted form. The brand detector returns `isBranded=false` on `texas roadhouse`, `cheesecake factory`, `dutch bros`, `gold peak`, `real good`, `first watch`, `ore ida`, `churchs`, `soylent`, `ensure` and `mccann`. And the empty strict pool made the relaxed retry require the appended token alone.

## 6. What was not touched

Nothing changed in `src/lib/search/`, `normalization-rules.json`/`RULES_VERSION`, any brand list or the lexicon, `detectBrandInQuery`, the five `ONE_HOP_SYMBOLS`, `scripts/eval/`, the golden set or `knownIssue`, `claims.json`, `package.json` or `.env*`.
