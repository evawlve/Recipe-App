# Cloud review of the 29 PRs queued for deploy 3 (#557–#585), merged together before any of them merges
cloud-40 · run 2026-10-20 · read-only adversarial review of a LOCAL integration branch `review-int` = `081a3aef` (master, deploy 2, live as build `pPXuKrX-PI_8GIfm8xL2M`) + the 29 PR heads merged in the brief's order (tip `415aea8b`, never pushed). No code changes; this PR commits this report file and nothing else.

## Integration (BUILD IT)
All 29 merged **clean**, in order, and **no head moved** from the brief's pins. Merged heads:
#557 `c69/d19-left-out-food` 8d5b1cb9 · #558 `c69/d19-dish-provenance-meal` 96d9d687 · #559 `c70/tea-size-words` 286567c9 · #560 `c70/filler-count-noun` 9345d0a7 · #561 `c70/bare-short-stack` 48f76414 · #562 `c69/d19-dose-correction` 6725b7a8 · #563 `c69/d19-interjection-gap` a1e3002d · #564 `c69/d19-echo-spoon` 96cd877e · #565 `c70/leftover-descriptor` ec441571 · #566 `c70/ai-normalize-deadline` 0da31e88 · #567 `c69/d19-sized-stock` 0264cec6 · #568 `c69/d19-drank-stock` 208c0c0a · #569 `c69/d19-echo-later-span` 76f79482 · #570 `c69/d19-count-noun-stock` 9645fdc5 · #571 `c69/d19-made-with-head` 79b6c083 · #572 `c70/approximator-count` ab4cc7bd · #573 `c69/d19-solo-removal` 938440a6 · #574 `c69/d19-milk-with-use` 40418b9e · #575 `c69/d19-trailing-and` a07db9ea · #576 `c69/d19-addition-tail` 5947d8c9 · #577 `c69/d19-dish-gap-word` a678f47c · #578 `c70/pour-onto-heuristic` ece9e756 · #579 `c70/relaxed-vessel-head` 5c19d9d2 · #580 `c70/count-tag` 3e8de685 · #581 `c70/fdc-small-count-seed` 3b45cfa6 · #582 `c70/n-prose-01-tier` e057295f · #583 `c70/a-few` e8095d87 · #584 `c70/a-bit-of` ce8cd7f1 · #585 `c68/seeds-2026-10-19` c6a0ebee.

**Full suite on `review-int`** (`test:ci` command, offline env): exit 0, **379/379 suites, 9,822 passed + 1 skipped, 0 red**, which matches MGR's 01:00Z build. **No INTEGRATION-RED.** The re-pinned sibling expectations hold by rule: `a bottle of wine, um, drank half` → `1/2 bottle of wine`; `6 eggs, had 2` → `2 eggs`; `a bag of chips, um, ate 3` → `3 chips`.

## Pass order (derived from `runParse()` in `src/app/api/nlp/parse/route.ts` on `review-int`)
1. **Split source**, exactly one of:
   - item-form input (`items[]`): no route pass runs.
   - `singleItemFromText()` (`route.ts:53`): trimmed line ≤ 60 chars, no `, ; + & \n` / `and` / `with` / `plus` after the meal suffix is stripped, not `isPourOntoSecondFood()`, ≤ 6 words. One item, then **`stripSoloRemoval()` (`route.ts:383`, #573)** strips a trailing `without|minus <part>` clause. No other route pass runs.
   - otherwise SegmentationCache hit / LLM split / `forceSegmentText` heuristic, then `capSplit`, then the cache write (the UNPROCESSED split).
2. Segmenter branch only, keyed on `lineKey = canonicalizeSegLine(text)`:
   **`restoreLeadingPour` (`:459`; #578 now also cuts a one-item, empty-normalizedForm pour item) → `resolveSelfCorrections` (`:462`; #563 #575 #576) → `dropNegatedParts` (`:470`; #557 #573) → `dropDishParts` (`:478`; #558 #577) → `foldDrinkMilk` (`:485`; #574) → `rewriteExtraPortions` → `dropSegmenterEchoes` (`:498`; #569) → `readMadeWithHeads` (`:505`; #571, NEW) → `foldTrailingQuantityClauses` (`:510`; #562 #563 #564 #567 #568 #570) → `fillRestaurantBrand`**.
3. Every item on every path: `parseIngredientLine(rawText)` (`route.ts:577`, again in the mapper; #560 #561 #572 #580 #583, with `resolveCountTag()` as its innermost first step), then `mapIngredientWithFallback()`, now a wrapper (#584: the `a bit of` ½ scale after the serving is picked) over the core: preflight (#565 strips `leftover` from `parsed.name` and `baseName`), AI normalize (#566 10 s deadline + abort), `filterCandidatesByTokens` (#579 vessel re-aim on the relaxed pass), rank-time plausibility (#559), FDC hydration (#581 small-piece seed).

**Reachability** (cloud-38's rule): `singleItemFromText()` answers a short line alone, so the segmenter-branch passes never see it; the ingredient-line / unit / mapping passes run on every path. Every finding carries `reachable: yes/no` with the reason, and at route level its split SOURCE (a named captured fixture, or `ASSUMED` = a hand-written split shaped like the named fixture).

## Method
- Read: both predecessor reports; the diff `git diff 081a3aef review-int -- src ':!**/fixtures/**'` in full for every nlp file, `ingredient-line.ts`, `count-tag.ts`, `amount-hedge.ts`, `quantity.ts`, `loose-measures.ts`; for the mapping/serving/ai files, each PR's hunk; the PR bodies of #557 #563 #565 #567 #568 #570 #576 #580 (public API), scanned for named misses. I read the other bodies' claims only through their headers and pins, not in full.
- About 420 adversarial inputs as direct calls in scratch tests under `src/lib/__cloud40__/` (deleted before this commit): about 170 through `chain()` (cloud-38's preamble plus the two passes this deploy adds or exposes: `rewriteExtraPortions` and #571's `readMadeWithHeads`, in `runParse()` order), about 230 parser / predicate calls (`parseIngredientLine`, `resolveCountTag`, `readLeadingAmountHedge`, `stripSoloRemoval`, `stripLeftoverDescriptor`, `filterCandidatesByTokens`), a route harness (cloud-38's mocks), and the #566 real-client harness.
- **Single-PR controls**: the same scratch files run in `git worktree`s at `081a3aef` and at each PR head involved (a head carries its stack): #557 `8d5b1cb9`, #563 `a1e3002d`, #565 `ec441571`, #567 `0264cec6`, #568 `208c0c0a`, #570 `9645fdc5`, #575 `a07db9ea`, #576 `5947d8c9`, #580 `3e8de685`. The preamble calls `readMadeWithHeads` only where it exists.

## Row 1 (a): predecessor fixes verified with the predecessors' own reproductions (on `review-int`)
| fix | PR | reproduction | result |
|---|---|---|---|
| cloud-38 D1 | #558 | G2, R2 | PASS |
| D2 | #557 | G1, R1 | PASS |
| D3 | #562 | G3, R3 | PASS |
| D4 | #564 | G4 | PASS |
| D5 | #567 | G7, R6 | PASS |
| D7 | #568 | G6, R4 | PASS |
| D8 | #563 | G8, R5 | PASS |
| D9 | #569 | G5 | G5's first line FAILS, but it asserts a pre-fix mechanism (`coffee with oat milk` needs self-correction to rewrite the host's part). The PR's own pin (`echo-later-span.json`: `coffee with milk` + `oat milk`, the `milk` echo dropped) holds through the full chain. **Accepted by the pin.** Residual, not counted: the host still bills dairy milk next to the oat milk (a self-correction part-rewrite gap, pre-existing) |
| D10 | #560 | G11 | PASS |
| D11 | #561 | G10 | PASS |
| D12 | #572 | G12 | PASS |
| D13 | #570 | G9 | PASS |
| D14 | #559 | G13 | PASS |
| D6 | none (out of scope) | G14, R7 | still FAIL, as the brief says |
| H1 (cloud-36 C14 pin) | n/a | H1 | PASS |
| cloud-36 C1 | #578 | R1 (LLM error → heuristic) | PASS |
| C1 | #578 | R2 (one-item LLM echo WITH a normalizedForm) | FAIL. **HELD-known**: #578's header declines that case by name ("An LLM one-item echo WITH a normalizedForm (R2) is never split": 185 of 198 one-item cache rows are exact echoes) |
| C2 | #577 | G3, R5 | PASS |
| C3 | #575 | G4 | PASS |
| C4 | #576 | G5, R4 | PASS |
| C5 | #576 | G6 | PASS |
| C6 | #574 | G8, R6 | PASS |

**Totals:** cloud-38 file 13/15 pass (the 2 fails are G5 = accepted by the pin, and G14 = D6, out of scope); cloud-38 route file 6/7 (R7 = D6); cloud-36 unit 5/5; cloud-36 route 4/5 (R2 = HELD-known).

## Findings (ranked INTEGRATION-RED > VANISH > IDENTITY > PORTION > NO-FIRE)

| id | PRs | input | observed on `review-int` | expected | single-PR controls | class | reachable | split source | reproduction | proposed fix (one sentence; function; PR) |
|---|---|---|---|---|---|---|---|---|---|---|
| F1 | #576 (× #563's interjection tier) | `a turkey sandwich, actually a ham sandwich, um, too` / `a turkey sandwich, sorry, a ham sandwich, uh, as well` | `a ham sandwich` only: the turkey sandwich is removed as a corrected reading. #576's tail window adds a later comma piece only when EVERY word in it is a pure addition word, so the `um` piece stops the window and the `too` piece behind it is never read | `a turkey sandwich`, `a ham sandwich` (as `…, a ham sandwich, too` gives on `review-int`) | `081a3aef`: `a ham sandwich` (both forms, C4 open). #575 `a07db9ea`: same. **#576 `5947d8c9`: `, too` → both kept (C4 fixed); `, um, too` → `a ham sandwich`.** #563 `a1e3002d`: `a ham sandwich`. Not caused by deploy 3: master drops it too. A gap in #576's own claimed shape, opened by an interjection piece | **VANISH** | yes: `,` → segmenter | ASSUMED (`self-correction-addition-tail.json` shape) | **F1**, **RF1** | `resolveSelfCorrections()` F3 tail window: treat a later comma piece made only of `HESITATION` words (the Set #563 exports, so no new list) as transparent: skip it and keep reading, rather than letting it end the window. **#576** (follow-up) |
| F2 | #567 (segment shape) × a self-correction | `a family size bag of chips, ate 3, sorry, 4`, with the corrected count split off as its own item `4` | `4 family size bag of chips`: FOUR family-size bags. #567's segment branch needs a consume verb right before the count item's span, and `sorry` sits there, so the line falls to the plain segment fold, which writes the count onto the bag | `4 chips` | `081a3aef`: `4 family size bag of chips`. #567 `0264cec6`: same. #568 / #570 heads: same. Pre-existing; inside #567's claimed "in the gap and the segment shape" | **PORTION** (×4 family-size bags, thousands of kcal) | yes | ASSUMED (`stock-consumed.json` two-item shape) | **F2**, **RF2** | `foldTrailingQuantityClauses()` #567 segment branch: when the tokens right before the count item are a self-correction marker, take the consume verb from the gap group before the marker (the corrected clause), so the restated count reaches `countStock()` and never the generic segment fold. **#567** (follow-up) |
| F3 | #557 × #565 | `a coke and left out pizza from last night` (split `a coke` + `left out pizza`, nf `pizza`) | #557 now keeps `left out pizza`, reading it as leftover pizza (its own body). But the item reaches the mapper as rawText `left out pizza`: `parseIngredientLine` names it `left out pizza`, and #565's `stripLeftoverDescriptor()` strips only `leftover`/`left-over`, so `parsed.name` (which #565 says feeds searchQuery / confidenceGate / assessConfidence / rerank) keeps `left out`. `leftover pizza` reaches the mapper as `pizza` | the kept item reaches the mapper as its own reading: `pizza` (as `leftover pizza` does) | `081a3aef`: `a coke` only (D2 VANISH). #557 `8d5b1cb9`: item kept as `left out pizza`. #565 `ec441571`: `a coke` only (the removal still fires). The name defect needs both PRs | **NO-FIRE** (IDENTITY effect on rerank, unmeasured offline: no DB) | yes | ASSUMED (cloud-38 R1 split) | **F3** | `dropNegatedParts()`: where the adjectival `left out` reading keeps an item (`isAdjectival` declines the removal), hand the mapper the reading the pass chose: rewrite the item's rawText to drop the two-word verb, keeping any quantity. It belongs with the pass that decided the reading, not in #565's descriptor regex (a word list grown by one). **#557** (follow-up) |
| F4 | #580 (guard g) | `wine x2 glasses` / `chips x2 bags` / `beer x2 cans` / `milk x2 glasses` / `water x2 bottles` | qty 2, unit null, names `wine glasses` / `chips bags` / `beer cans`: the tag rule `<head> x<N> [rest]` → `<N> <head> [rest]` turns the container that N counts into the food's head noun. Guard (g) declines only the pack regex (`pack|ct|case|carton|box|tray`), though #580's body states "a pack/container word after N declines" | as the twin: `2 glasses of wine` → qty 2, unit `glass`, name `wine` | `081a3aef`: qty 1, name `wine x2 glasses` (also wrong: tag unread, `glasses` last). #580 `3e8de685`: as on `review-int`. A gap in #580's own guard, not a regression: the count is now read, but the head noun is still the container, which is the relaxed-pass head-noun mechanism #579's header describes (`plate` → the veal cut) | **NO-FIRE** (IDENTITY effect: the last required token is a container) | yes: every path (parser) | n/a (parser) | **F4** | `resolveCountTag()` TAIL_X / PAREN_X_NOUN: when the first word of `rest` is a unit the unit table reads (`normalizeUnitToken().kind` not `unknown`, which already covers glass/bag/can/bottle/scoop), emit the twin `<N> <unit> of <head> [rest…]` rather than reading the unit word through, and route guard (g)'s regex and guard (f)'s mass/volume decline through that same table. **#580** (follow-up) |

**Class counts (final table): INTEGRATION-RED 0 · VANISH 1 · IDENTITY 0 · PORTION 1 · NO-FIRE 2 · NOISE 0 (4 findings; 6 failing finding reproductions: F1 F2 F3 F4 unit + RF1 RF2 route. The HELD-known H2a–e / RH2 tests also fail, by design).** None is caused by a single deploy-3 PR: F1, F2 and F4 are gaps in the PRs' own claimed shapes (F1 and F2 fail identically on `081a3aef`), and F3 needs #557 and #565 together.

### Per-PR verdicts
- #557: merge, then fix F3 in a follow-up
- #558: merge
- #559: merge
- #560: merge
- #561: merge
- #562: merge
- #563: merge
- #564: merge
- #565: merge (F3's fix belongs on #557)
- #566: merge
- #567: merge, then fix F2 in a follow-up
- #568: merge
- #569: merge
- #570: merge
- #571: merge
- #572: merge
- #573: merge
- #574: merge
- #575: merge
- #576: merge, then fix F1 in a follow-up (not a HOLD: the VANISH is on `081a3aef` too, so #576 does not cause it)
- #577: merge
- #578: merge
- #579: merge
- #580: merge, then fix F4 in a follow-up
- #581: merge
- #582: merge
- #583: merge
- #584: merge
- #585: merge

**No HOLD.** No finding is a VANISH or IDENTITY that a PR causes.

## HELD-known, measured, not counted
- **H2: a self-correction inside a one-item trailing stock clause is not read** (#568's body names it: "only the first clause is read"; #563's body names the gap fold's multi-item defect). These are the brief's own interaction lines. On `review-int`: `a 6 pack of beer, um, drank 2, wait, 3` → `2 beer`; `a 6 pack of beer, drank 2, wait, 3` → `2 beer`; `6 eggs, had 2, wait, 3` → `2 eggs`; `a bag of chips, um, ate 3, no wait, 5` → `3 chips`; `a family size bag of chips, ate 3, sorry, 4` → `3 chips`; `a family size bag of chips, ate half, actually a third` → `1/2 family size bag of chips` (and with `a third` split off, `a third` stays as an orphan item). Controls: `081a3aef` billed the WHOLE stock for each (6 beers, 6 eggs, the bag; `3 family size bag of chips` = THREE bags for the family-size line), except `a bag of chips, ate 3, no wait, 5` → `3 chips` already. So deploy 3 moves every one of them closer to the truth (#568 for `drank`, #570 for `6 eggs`, #563 for `um`, #567 for the family-size bag), but none yet reads the correction. Reproduction H2a–e and RH2 (they assert the corrected count). If this class is ever un-named, the fix is the same shape as F2's: after choosing `first`, let a later gap group that opens with a self-correction marker (the markers `self-correction.ts` already defines, exported) and parses to a clause replace it.
- **cloud-36 C1 R2** (one-item LLM echo with a normalizedForm): declined by name in #578's header.
- **`a few blueberries x2`** → qty 3, name `blueberries x2`. Article-led tag lines are #580's labelled KNOWN MISS (`a bagel x2`), and #581's seed declines a digit in the name by its header (`x2 blueberries`). Consequence noted: qty 3 lands on the FDC low-count arm with the seed declined, i.e. the AI-`medium`-per-piece path #581 exists to avoid (~3 × a serving). `a few chips x2` is the same shape. Judged HELD by both headers. The cheapest exit is #580's own KNOWN MISS being lifted for `a few` (which parses as a quantity since #583), so I name it here, not as a finding.
- **#580 guard (f)**: `coffee x2 cups` / `beer x2 pints` keep master's parse (qty 1, tag in the name), declined by name (mass/volume after N). F4's fix would cover them.
- **`at least 2 wings x2` / `about 3 wings x2` / `2 wings x2` / `about 3 tacos x2`** → qty 2–3, name `… x2`: master's pre-existing class, named in #580's body.
- **#573**: `chili without beans` bills plain chili (named). Same class, not counted: `a mojito without rum` / `a bloody mary without vodka` / `a pina colada without rum` → the full drink (an absent defining part; SOLO_ABSENCE covers `alcohol`, not the spirit names). `a burrito bowl without rice`, `a sub without the bread`, `a burger without the patty`, `a cheeseburger without cheese` bill the full dish, which is the same posture the segmented path's removals take (drop the part, bill the host's default).
- **#557**: `a coke, left out pizza` / `a salad, then left out pizza` drop the pizza. This is #557's stated rule (a bare `left out` that opens its own clause is a removal: `coffee, left out pizza` drops the pizza, per its body).
- **#564 topping**: `peanut butter with honey, 2 tbsp` loses its stated amount (named miss). `coffee with sugar, 2 tsp` and `toast with butter, 2 tsp` drop the spoon measure and bill the host at its default, per design.
- **#565**: `left over pizza` (two words) is out of scope by its body.
- **#579**: non-monotone on its fire set, by its header. Observed on a hand-made pool (ASSUMED): `veggie platter` with no `Veggie Platter` record re-aims onto `veggie` and admits only `Veggie Burger`, dropping master's `Vegetable Platter`; `fajita plate|platter` admits `Fajita Seasoning` next to `Fajita Platter`. That needs a pipeline-level winner diff on the box (CLAUDE.md §Mapping-pipeline), which I cannot run.
- **#566**: a real-client run of 12 concurrent normalize lines (10 slots, all hanging) gives, after the 10 s deadline, every line `normalize_deadline_exceeded`, active 0 / pending 0, no fetch after expiry, no cache write, and a fresh line fetching at once (`deadline.test.ts`, PASS). At the expiry INSTANT, a queued line whose deadline falls in the same millisecond can take the freed slot and start one fetch that is aborted in the same tick (10 → 12 fetches when all 12 deadlines coincide). With real staggered arrivals the waiter still has budget, so this is the spec, not a finding.
- **Parser twins (pre-existing, not counted)**: `eggs x2 large` → `null` parse, as its twin `2 eggs large` already does on master. `eggs x2 scrambled` → unit `egg`, name `scrambled`, as `2 eggs scrambled` on master. #580 only routes the tag into those shapes.

## Inputs expected to break that HELD
- **#563 × #575/#576**: `a beef taco, um, and 2 chicken tacos, sorry` keeps both (master dropped the beef taco); `a beef taco and 2 chicken tacos, um` and `2 tacos and 3 tacos, um` keep both; `a turkey sandwich, um, a ham sandwich, too` keeps both; `a latte, and a coke, and 2 lattes, sorry` → `a coke`, `2 lattes`; `a beef taco, and a chicken taco, no` keeps both; `a turkey sandwich, actually a ham sandwich, as well as chips` and `…, too much mayo` still correct (not additions).
- **#558/#571/#577 on one dish line**: `a burrito i made with chicken from last night for lunch, also a coke` keeps the coke in all 4 split shapes tried (parts split off, or the clause kept inside the item); `a homemade burrito with chicken from yesterday for lunch and steak` and `… from the place at lunch and rice` keep the steak / rice (master dropped them); `a homemade burrito with chicken, rice from last night for dinner, also eggs` keeps eggs (master dropped them); `a homemade pizza with pepperoni, onions, a salad`, `a homemade sandwich with turkey, cheese, apple`, `… beans, cheese, an apple`, `…. a coke` keep the last food; `a homemade omelette with ham, swiss|cheddar, and spinach` and `a homemade burger with cheese, lettuce, tomato and fries` drop only the parts. `pasta i made with olive oil and garlic`, `2 pancakes i made with oat flour`, `a smoothie i made with banana and milk, 2 cups` → `2 cups of smoothie …` (nf head `smoothie`).
- **#573 × #565 (fast path)**: `leftover pizza without cheese` → `leftover pizza` → mapper name `pizza`. `oatmeal without sugar`, `fries without salt`, `chicken without (the) skin` stay as typed (absence parts); `a burrito minus 2 tortillas` stays (digit).
- **#584 × #565 / #581**: `a bit of leftover rice` / `a little bit of left-over rice` → hedge 0.5, mapper name `a bit of rice`. `a bit of blueberries` is a bare qty-1 line, so #581's seed declines (`isBareUnitlessQty1`) and the ½ applies to the normal serving, never to one berry. `a bit of half and half` → 0.5 of half-and-half. The scale is consistent downstream: the route derives fiber/sugar/sodium from `mapped.grams`, so the halved grams scale the micros too.
- **#580 × #583 × #581**: `grapes x3` → 3 grapes; `blueberries x3` → 3; `coke x12 pack` / `water (x24 case)` / `water x24 case` keep master's parse; `coke x 12` → 12; `omega 3 x2` / `v8 x2` decline (digit before the tag); `toast x0` declines; `chicken (x2 thighs)` → `2 chicken thighs`; `sushi x8 pieces` → 8, hint piece; `a few slices of pizza` → 3 slices (master garbled it to `a few of pizza`); `a few` / `few` alone → null parse (no food).
- **#572**: `at least 100 calories of almonds`, `under 200 calorie snack`, `over 9000 calories`, `at least 2 percent milk`, `over 2% milk`, `at least 5 star meal`, `at least 2 day old bread`, `at least 7 grain bread`, `under 4 ingredient cookies`, `at least 2 alarm chili`, `at least 5 spice` stay whole; `at least 3 musketeers`, `over 7 up` → the product name. Twin-consistent, not counted: `at least 3 cheese pizza` → qty 3 `cheese pizza`, like its twin `3 cheese pizza`.
- **#560/#561**: `a full stack` / `a tall stack` → 5 pancakes, `a short stack` → 3; `a good bowl of soup`, `a full plate of pasta`, `a solid piece of steak`, `a generous scoop of ice cream`, `a full can of coke`, `a full bag of chips` now read their unit; `a good burger` unchanged. Not counted (no unit word follows the filler): `a full glass of milk`, `a full rack of ribs`, `a good dozen eggs` stay whole, as on master.
- **#578**: `a splash of syrup on pancakes`, `a drizzle of honey on toast`, `2 splashes of milk in coffee`, `a pinch of salt on eggs`, `a splash of baileys in hot chocolate` (heuristic items, empty nf) split; `a splash of milk in my`, `a splash of cream in it`, `a splash of lime in a corona` (article object, named miss) stay whole.
- **#562**: `a protein shake with 2 scoops, actually 1 scoop` → `1 scoop of protein powder`; `… half a scoop, wait, 1 scoop` → `1 scoop of protein powder`; `… 2 scoops, actually 1 scoop of ice cream` / `… sorry, a banana` / `… then 3 scoops of ice cream` keep the food.
- **#574**: `a latte and milk with cereal|cookies|oreos|brownies` keep the milk; `… with sugar|honey|whipped cream` fold it; `… with ice` folds.
- **#579**: `cheese plate` → cheese records + `Cheese Platter` (master: the veal cut, `Paper Plate`); `fruit platter` → `Fruit Platter`; `seafood platter` → `Seafood Platter` + `Seafood Salad`; `taco|shrimp|rice|sushi|chicken plate` re-aim onto the food; `meat plate`, `nacho platter` fall back to master (food token admits nothing); `a plate` / `plate` unchanged.

**Not reached in the time box:** #582 (golden assertion only) and #585 (tsv seeds only) were read as diffs, not attacked. #571 / #577 / #574 / #562 / #564 got about 6–12 inputs each. #579 / #581 / #584 were judged at the predicate / pure-function level (no DB, so no winner diff). I read the PR bodies only for #557 #563 #565 #567 #568 #570 #576 #580; the other bodies' named controls were taken from the pass headers and fixtures.

## Reproductions (verbatim scratch files; each test asserts the CORRECT outcome, so a FAIL is the finding)

Unit preamble `src/lib/__cloud40__/pre.ts` (cloud-38's `chain()` plus `rewriteExtraPortions` and #571's `readMadeWithHeads`, in `runParse()` order; `readMadeWithHeads` is called only where it exists, so the same file runs in the `081a3aef` control worktree):

```ts
import { restoreLeadingPour } from '@/lib/parse/loose-measures';
import { resolveSelfCorrections } from '@/lib/nlp/self-correction';
import { dropNegatedParts } from '@/lib/nlp/negated-part-drop';
import * as DP from '@/lib/nlp/dish-part-drop';
import { foldDrinkMilk } from '@/lib/nlp/drink-milk-fold';
import { rewriteExtraPortions } from '@/lib/nlp/extra-portion';
import { dropSegmenterEchoes } from '@/lib/nlp/segmenter-echo-drop';
import { foldTrailingQuantityClauses } from '@/lib/nlp/trailing-quantity-fold';
import { canonicalizeSegLine } from '@/lib/nlp/seg-line-key';
export type It = { rawText: string; normalizedForm: string; brand: string };
export const s = (r: string, n = r.replace(/^(a|an|the|some)\s+/i, '')): It => ({ rawText: r, normalizedForm: n, brand: '' });
// runParse() order on review-int: pour -> correction -> negated -> dish -> drink -> extra-portion -> echo -> made-with head -> fold (brand fill omitted)
export function chainItems(line: string, items: It[]): It[] {
  const k = canonicalizeSegLine(line);
  let x = restoreLeadingPour(k, items).items;
  x = resolveSelfCorrections(k, x).items; x = dropNegatedParts(k, x).items; x = DP.dropDishParts(k, x).items; x = foldDrinkMilk(k, x).items;
  x = rewriteExtraPortions(k, x).items; x = dropSegmenterEchoes(k, x).items; const mw = (DP as Record<string, unknown>).readMadeWithHeads as undefined | ((k: string, x: It[]) => { items: It[] }); if (mw) x = mw(k, x).items;
  return foldTrailingQuantityClauses(k, x).items;
}
export const chain = (line: string, items: It[]): string[] => chainItems(line, items).map(i => i.rawText);
```

Unit tests `src/lib/__cloud40__/repro.test.ts` (F1, F2, F4 = findings; H2a–e = HELD-known, see above):

```ts
// cloud-40 reproductions (unit). Each asserts the CORRECT outcome, so a FAIL is the finding.
import { parseIngredientLine } from '@/lib/parse/ingredient-line';
import { chain, s } from './pre';

const H2: [string, string, string, string][] = [
  ['H2a', 'a 6 pack of beer, drank 2, wait, 3', 'beer', '3 beer'], ['H2b', '6 eggs, had 2, wait, 3', 'eggs', '3 eggs'],
  ['H2c', 'a bag of chips, um, ate 3, no wait, 5', 'chips', '5 chips'], ['H2d', 'a bag of chips, ate 3, no wait, 5', 'chips', '5 chips'],
  ['H2e', 'a family size bag of chips, ate 3, sorry, 4', 'chips', '4 chips'],
];
test.each(H2)('%s (HELD-known, #568 body: only the first clause is read) correction x one-item stock clause: %s bills the corrected count', (_id, line, nf, want) => {
  expect(chain(line, [s(line.split(',')[0], nf)])).toEqual([want]);
});

test('F2 correction x segment stock: a corrected count split off as its own item re-counts the food, never the bags', () => {
  expect(chain('a family size bag of chips, ate 3, sorry, 4', [s('a family size bag of chips', 'chips'), s('4')])).toEqual(['4 chips']);
});

test('F1 addition tail x interjection: `, um, too` after a restated item is still an addition', () => {
  expect(chain('a turkey sandwich, actually a ham sandwich, um, too', [s('a turkey sandwich'), s('a ham sandwich')]))
    .toEqual(['a turkey sandwich', 'a ham sandwich']);
  expect(chain('a turkey sandwich, sorry, a ham sandwich, uh, as well', [s('a turkey sandwich'), s('a ham sandwich')]))
    .toEqual(['a turkey sandwich', 'a ham sandwich']);
});

test('F4 count tag: a container word after N is the unit, as in the twin `2 glasses of wine`', () => {
  for (const [line, twin] of [['wine x2 glasses', '2 glasses of wine'], ['chips x2 bags', '2 bags of chips'], ['beer x2 cans', '2 cans of beer']]) {
    const a = parseIngredientLine(line)!, b = parseIngredientLine(twin)!;
    expect([a.qty, a.unit, a.name]).toEqual([b.qty, b.unit, b.name]);
  }
});
```

`src/lib/__cloud40__/repro-lo.test.ts` (F3; imports #565's module, so it runs only where #565 is merged):

```ts
// cloud-40 F3: #557 keeps `left out pizza` as a food; the mapper's descriptor strip (#565) must then see the provenance adjective.
import { parseIngredientLine } from '@/lib/parse/ingredient-line';
import { stripLeftoverDescriptor } from '@/lib/mapping/leftover-descriptor';
import { chain, s } from './pre';

test('F3 removals x leftover: the kept `left out pizza` reaches the mapper as pizza, like `leftover pizza`', () => {
  const kept = chain('a coke and left out pizza from last night', [s('a coke'), s('left out pizza', 'pizza')]);
  expect(kept).toEqual(['a coke', 'left out pizza']);
  const name = (l: string) => stripLeftoverDescriptor(parseIngredientLine(l)!.name, l, null).baseName;
  expect(name(kept[1])).toBe(name('leftover pizza'));
});
```

Route tests `src/lib/__cloud40__/route-repro.test.ts` (header and mocks are cloud-38's `route-repro.test.ts` verbatim, in its report; only the describe name changed):

```ts
  test('RH2 (HELD-known) correction x one-item stock: `drank 2, wait, 3` bills 3 beers (ASSUMED one-item split, stock-consumed.json CHIPS shape)', async () => {
    llm([seg('a 6 pack of beer', 'beer')]);
    await POST(req('a 6 pack of beer, drank 2, wait, 3'));
    expect(mapped()).toEqual(['3 beer']);
  });

  test('RF2 correction x segment stock: `ate 3, sorry, 4` never bills four family-size bags (ASSUMED split)', async () => {
    llm([seg('a family size bag of chips', 'chips'), seg('4')]);
    await POST(req('a family size bag of chips, ate 3, sorry, 4'));
    expect(mapped()).not.toContain('4 family size bag of chips');
  });

  test('RF1 addition tail x interjection: `, um, too` keeps the turkey sandwich (ASSUMED split)', async () => {
    llm([seg('a turkey sandwich'), seg('a ham sandwich')]);
    await POST(req('a turkey sandwich, actually a ham sandwich, um, too'));
    expect(mapped().sort()).toEqual(['a ham sandwich', 'a turkey sandwich']);
  });
});
```

#566 harness `src/lib/__cloud40__/deadline.test.ts` (expected PASS; real client, `global.fetch` mock):

```ts
// #566: real client + fetch mock. 12 concurrent normalize lines that all hang: after the 10 s deadline every line resolves to the
// deadline error, the 2 queued ones never fetch, the semaphore is empty (active 0, pending 0), and a fresh call fetches at once.
process.env.OPENAI_API_KEY = 'jest-fake-key-never-dialled';
const mockGet = jest.fn(async () => null); const mockSave = jest.fn(async () => undefined);
jest.mock('@/lib/mapping/validated-mapping-helpers', () => ({ getAiNormalizeCache: () => mockGet(), saveAiNormalizeCache: () => mockSave() }));
const fetchMock = jest.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_r, rej) => {
  init?.signal?.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }, { once: true }); }));
(global as any).fetch = fetchMock;
const sc = require('@/lib/ai/structured-client') as typeof import('@/lib/ai/structured-client');
const norm = require('@/lib/mapping/ai-normalize') as typeof import('@/lib/mapping/ai-normalize');
test('#566 deadline frees every normalize slot and the queue', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
  for (const k of ['log', 'warn', 'error'] as const) jest.spyOn(console, k).mockImplementation(() => undefined);
  const lim = sc.getConcurrencyLimit('normalize');
  const calls = Array.from({ length: lim + 2 }, (_, i) => norm.aiNormalizeIngredient(`food ${i}`));
  await jest.advanceTimersByTimeAsync(0);
  const started = fetchMock.mock.calls.length;
  expect(sc.getActiveCount('normalize')).toBe(lim); expect(sc.getPendingCount('normalize')).toBe(2);
  await jest.advanceTimersByTimeAsync(norm.AI_NORMALIZE_DEADLINE_MS + 1);
  const res = await Promise.all(calls);
  expect(res.every(r => r.status === 'error' && (r as { reason?: string }).reason === norm.AI_NORMALIZE_DEADLINE_REASON)).toBe(true);
  const atExpiry = fetchMock.mock.calls.length; await jest.advanceTimersByTimeAsync(120_000); expect(fetchMock.mock.calls.length).toBe(atExpiry);
  expect([sc.getActiveCount('normalize'), sc.getPendingCount('normalize')]).toEqual([0, 0]);
  void norm.aiNormalizeIngredient('fresh line'); await jest.advanceTimersByTimeAsync(0);
  expect(fetchMock.mock.calls.length).toBe(atExpiry + 1);
  expect(mockSave).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(60_000); jest.useRealTimers();
});
```

## Commands run (exits)
Jest env everywhere: `env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="postgresql://x:y@localhost:5432/z" npx jest <path> > <log> 2>&1; echo "exit=$?"`.

| # | command | exit / result |
|---|---|---|
| 1 | `[ "$(git rev-parse --is-shallow-repository)" = true ] && git fetch --unshallow origin \|\| true` | 0 |
| 2 | `git fetch origin +refs/heads/master:refs/remotes/origin/master` | 0 |
| 3 | `git merge-base --is-ancestor 081a3aef origin/master` | 0 |
| 4 | `git checkout -b review-int 081a3aef`; per line in order: `git fetch origin +refs/heads/<b>:refs/remotes/origin/<b>`, head compare, `git -c user.name=cloud40 -c user.email=cloud40@invalid merge --no-edit origin/<b>` | 0 for all 29; no MOVED; no CONFLICT; tip `415aea8b` |
| 5 | `npm ci` | 0 |
| 6 | `npx jest --ci --testPathIgnorePatterns /node_modules/ src/ops/curated/__tests__/seed-curated.test.ts > full.log` (= `test:ci`) on `review-int` | exit=0: 379/379 suites, 9,822 passed + 1 skipped |
| 7 | cloud-38 reproductions (`c38.test.ts`, `c38-route.test.ts`) on `review-int`, using this report's `pre.ts` | exit=1: unit 13 passed / 2 failed (G5 accepted by the PR's pin, G14 = D6); route 6 / 1 (R7 = D6) |
| 8 | cloud-36 reproductions (C2–C6 unit `c36.test.ts`; R1 R2 R4 R5 R6 `c36-route.test.ts`) on `review-int` | unit exit=0 5/5; route exit=1 4 passed / 1 failed (R2, HELD-known by #578) |
| 9 | probes `probe-a` … `probe-h` (print-only) on `review-int` and in a `git worktree` at `081a3aef` (`node_modules` symlinked) | exit 0 each (probe-c imports post-master modules, so its master twin is probe-d) |
| 10 | `repro.test.ts` on `review-int` | exit=1: 8 failed (H2a–e HELD, F1 F2 F4) |
| 11 | `repro-lo.test.ts` on `review-int` | exit=1: 1 failed (F3) |
| 12 | `route-repro.test.ts` on `review-int` | exit=1: 3 failed (RH2 HELD, RF2, RF1) |
| 13 | `deadline.test.ts` on `review-int` | exit=0: 1 passed |
| 14 | single-PR controls: `repro.test.ts` and a print twin (`probe-f`) in worktrees at `081a3aef`, `a1e3002d`, `0264cec6`, `208c0c0a`, `9645fdc5`, `a07db9ea`, `5947d8c9`, `3e8de685`, `8d5b1cb9`, `ec441571` | `repro.test.ts`: every F/H test fails at every ref (`3e8de685` changes only F4's received value). Observed values per ref are in the findings table and H2 |
| 15 | `curl -s https://api.github.com/repos/evawlve/Recipe-App/pulls/<N>` for #557 #563 #565 #567 #568 #570 #576 #580 | 0 (bodies read for named misses) |
| 16 | `rm -rf src/lib/__cloud40__`; `git worktree remove --force` ×10; `git checkout -b cloud/review-deploy3-557-585 origin/master`; `git add reports/2026-10-20_cloud-review-deploy3-557-585.md` (by path); `git commit -F <file outside the checkout>` | 0 |
