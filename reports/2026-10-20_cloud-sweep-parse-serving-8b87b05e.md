# Cloud sweep of the parse and serving stages on the deployed tree `8b87b05e` + #584 #589 #590 #595 #596

cloud-43 · run 2026-10-20 (UTC) · an adversarial read-only fixture sweep of `parseIngredientLine()`, the three serving lanes `dispatchServing()` routes to, and the two open rank/serving PRs #595 and #596, on a local integration `sweep-int` = `8b87b05e` (master, live build `hXTp_QvJ8lCIr83-mzT7b`) + the five open parse/serving heads. This report changes no code. Scratch tests lived under `src/lib/__cloud43__/` and were deleted before this commit. `sweep-int` was never pushed. Every reproduction was also run on a `8b87b05e` worktree to separate pre-existing defects from PR-caused ones.

## Integration (THE TREE): all 5 merges clean, in brief order, on `sweep-int` (from `8b87b05e`)
#584 `c70/a-bit-of` 52090636 · #589 `mgr/d19-water-large-volume` 18f7b029 · #590 `mgr/d19-unit-abbrev-family` 85452728 · #595 `c70/d20-drink-dry-panel` 2e9dcf1f (brings #594 51be83be) · #596 `c70/d20-pepper-lexicon-guard` 8d2bb020. No MOVED line. Integration tip `57cff558`.

**Full suite on `sweep-int`: 382 suites passed, 9,978 passed + 1 skipped, exit 0. There is no finding #0 (INTEGRATION-RED).**

## Reachability (cloud-38's statement, copied)
- `singleItemFromText()` (`route.ts:53`): trimmed line ≤ 60 chars (meal suffix included), no `, ; + & \n` / `and` / `with` / `plus` after the `for/at/as <meal>` suffix is stripped, not `isPourOntoSecondFood()` (`route.ts:68`; since #538/#542 any TOPPING_RX measure onto/into a non-container, non-time object), ≤ 6 words. One item; no route pass runs.
- Every item on every path: `parseIngredientLine(rawText)` (`route.ts:555`, again in the mapper), then the mapper (`normalizeIngredientName`; rerank `simpleRerank` → rank-time plausibility; `hydrateAndSelectServing`).
- Added here (read on `sweep-int`): the short path hands the mapper `normalizedForm: ''` (`route.ts:71`), so the mapper's retrieval query and cache key are `parsed.name` (`map-ingredient-with-fallback.ts` preflight: `baseName = normalizedForm || parsed.name || preProcessLine`). A parse defect on a short line therefore reaches retrieval, the unit-only rejection and the serving lane unrepaired.

## Derived order 1: the parse pipeline inside `parseIngredientLine()` (`src/lib/parse/ingredient-line.ts:601`)
1. Line rewrites, innermost first: `resolveCountTag()` (#580 `x2` tags) → `stripQuantityHedges()` (S202 `-ish` / approximator / filler strips) → `resolvePackageMultipliers()` → `resolveLoosePourMeasures()` (#514 splash/drizzle/sip → fl oz).
2. Separator and instruction cleanup (`to taste`, ` - N to N unit` alternatives, `-per serving`), the synonym rewrites (`calorie free` → `sugar free`, `guardedRocketToArugula()`).
3. Tokenize: parentheses and commas are separated, a fused `<digits><letters>` token splits (`250mls` → `250` `mls`, unless `isDigitBrandToken()`), multi-word units merge (`fl oz` → `floz`).
4. Unless the line is half-and-half: `normalizeFractionalMeasure()` → `rewriteDoublePortion()` → `rewriteStackOfPancakes()` (#561).
5. `detectBrandInQuery()`, `isIdentityWholePhrase()`.
6. Cursor: `leadingHedgePrecedesQuantity()` (LEADING_HEDGES, positional, number-gated) → leading-unit check (`normalizeUnitToken(tokens[0])`) → digit / word-number brand guards (`matchDigitBrandTokens`, `matchWordNumberBrandTokens`) → `parseQuantityTokens()` (unicode / word fractions, `N and a half`, word numbers incl. `a dozen|couple|few`, `N 1/2`, ranges) → default qty 1 → `expandUnitAbbreviation()` (#590) → `N x M` multiplier → unit (`normalizeUnitToken`; a count noun such as `egg` reads as the unit; a raw token before a partitive `of` reads as a raw unit) → parenthetical / after-paren unit → name assembly → `extractQualifiers()` → `extractUnitHint()`.
7. Outside the parser, in the mapper preflight: `stripLeftoverDescriptor`, `stripPartitiveOfResidue` (a leading/trailing `of`), identity-hint / qualifier restoration, the AI parse fallback (only when `parsed.unit` is null AND `/\d+\s*(floz|fl\s*oz|oz|cup|tbsp|tsp|ml|g|lb|lbs|serving)\b/` matches), then **`UNIT_ONLY_PATTERN` → `mapping.no_food_name` → null**, then the water fast path. #584's amount hedge (`a bit of`) is applied in the mapper, not the parser.

## Derived order 2: the rung order of each lane `dispatchServing()` routes to (`hydration-lane.ts:242`)
`fdc_` / source fdc → `buildFdcResult()`; `off_` / openfoodfacts → `buildOffResult()`; `fs_` / fatsecret → `buildFatSecretResult()`; anything else → the cached-details path (`selectServing`).

**FDC (`buildFdcResult`, `hydration-lane.ts:1409`)**, initial tier `flat_100g_default` (100 g × qty), then the first branch that applies:
1. `fdc_unit_heuristic`: a unit (or a trailing `bunch|head|stalk` in the name, `TRAILING_UNIT_REGEX`) matching the UNIT_HEURISTIC_DEFAULTS table (head of lettuce, bunch of kale, spray, bouillon cube).
2. Weight unit → `weight_unit`.
3. Volume unit → own label row `fdc_label_volume` / `fdc_volume_cached` → `fdc_volume_ai` → `volume_unit` (density fallback).
4. Size qualifier (`small|medium|large|whole`) → `fdc_own_size_serving` / `fdc_own_size_cached` → `fdc_size_qualifier` → `fdc_size_key_missing` / `fdc_size_unresolved`.
5. Unitless or a piece unit (`slice|piece|chunk|wedge|strip|segment`): if qty > 3 or an explicit count unit: own piece row `fdc_own_size_serving` / `_cached` → `seed_count_default` (#581) → `fdc_sub_piece_default` → `fdc_piece_ai` → `fdc_medium_estimate` → `fdc_piece_unresolved`; else (qty ≤ 3, unitless): own low-count row `fdc_own_size_serving` / `_cached` → `seed_count_default` → `fdc_size_estimate` → `fdc_size_estimate_unresolved`.
6. An ambiguous unit or a spoon/cup unit the volume table missed → `count_unit_cached` / `count_unit_ai` / `count_unit_unresolved`.
7. Otherwise `fdc_unknown_unit`.
8. Post: a unitless qty-1 line → `bare_query_default` (the getBareQueryDefault lexicon); then the bare-query guards.

**OFF (`buildOffResult`, `hydration-lane.ts:2719`)**, tier strings in source order (the branch order was read, not probed; see Not reached): `weight_unit` → `off_label_volume` → `volume_unit` → `label_unit_match` → `label_serving_package_unit` → `serving_unit_sibling_label` → `bare_plural_serving` → `bare_label_serving` → `bare_name_sibling_serving` / `_plural` / `_tight` → `label_count_derived` → `seed_count_default` → `discrete_unit_backfill` → `bare_sibling_serving` → `label_serving_default` → `count_unresolved_floor` → `flat_100g_default`, plus `bare_prepared_drink_cup`; then `applyOffBareQueryGuard()`.

**FatSecret (`buildFatSecretResult`, `build-fatsecret-result.ts`)**: `fs_weight_direct` (:469) → `fs_label_volume` / `fs_label_volume_declared` (:550/:555) → `fs_volume_density` (:605) → `fs_label_count` (:818) → `count_unit_cached` / `count_unit_ai` (:873, the ambiguous-unit backfill) → `fs_default_serving` (:961) → `fs_serving_macros_only` / its estimate tier (:1044) → `fs_per100g_fallback` (:1068); then `GUARD_TIER_ALIAS` (`fs_default_serving` → `label_serving_default`, `fs_per100g_fallback` → `flat_100g_default`) feeds `applyOffBareQueryGuard()` (:1085).

## Method
- Read: root `CLAUDE.md` (§Mapping-pipeline change rules), the four predecessor reports' tables and HELD lists, the #595 and #596 bodies (GitHub API), `parseIngredientLine()` and `quantity.ts` / `unit.ts` / `unit-abbreviations.ts` / `count-tag.ts`, `buildFdcResult()` in full, the FatSecret tier ladder, the mapper preflight, `pouredDrinkReason()` / `dietDrinkReason()`, `getBareQueryDefault()` and `applyOffBareQueryGuard()` eligibility.
- About 330 lines through `parseIngredientLine()` (ts-node printer), covering all 12 brief shapes with ≥ 4 lines each (lists in §Held-that-held and the findings). Rule: a line must parse to the same qty × multiplier, unit and food name as its canonical twin (`1,5` ↔ `1.5`, `2 dozen` ↔ `24`, `a glass of` ↔ `1 glass of`, …).
- About 60 lines through `hydrateAndSelectServing()` on FDC fixtures (the `fdc-small-count-seed.test.ts` harness verbatim: size estimator small/medium/large 100/150/200 g, per-piece 1.4 g, ambiguous-unit backfill off) with fixture `FdcServing` rows for egg, milk, cheddar, pizza, avocado, rice, wings, almonds, carrot, butter; and 22 lines through `buildFatSecretResult()` (the `build-fatsecret-result-label-count.test.ts` mock style) on fixture Milk / Egg / Cheddar / Red Wine / Cheese Pizza records. The FatSecret lane needs no LLM for these tiers, so its grams are deterministic; FDC grams on the estimator rungs are the harness's mocked numbers, not live billing.
- 35 inputs through `assessRankTimePlausibility()` (#595) with `panel(kcal)` (carbs 60 % / fat 40 % of kcal, as cloud-42), and 41 through `getBareQueryDefault()` + 8 through `applyOffBareQueryGuard()` (#596).
- Each finding has a jest test asserting the CORRECT outcome, so it FAILS today; each fails on its target assertion with the in-test control line passing (line numbers checked in the jest output).

## Findings (ranked INTEGRATION-RED > VANISH > IDENTITY > PORTION > NO-FIRE > NOISE)

| id | stage | input | observed on `sweep-int` | expected | class | reachable | `8b87b05e` | reproduction | proposed fix (one sentence; function) / row candidate |
|---|---|---|---|---|---|---|---|---|---|
| F1 | parse → mapper preflight | `2 eggs (100 g)` / `3 eggs (150g)` / `2 eggs 100g` / `1 egg (50g)` (also `2 eggs (8 oz)`, `2 thighs (250g)`, `1 breast (200 g)` by parse) | parse: unit `egg`, **name `100 g`** (the count noun is read as the unit and the stated weight becomes the name). The mapper's `UNIT_ONLY_PATTERN` matches `100 g` → `mapping.no_food_name` → **null: the eggs vanish**. Control `2 eggs` maps | the eggs, at the stated 100 g or at 2 eggs | **VANISH** | yes: 3–4 words, no separator → short path (`normalizedForm ''`, so baseName = `100 g`). `2 eggs, 100g` goes to the segmenter and vanishes the same way if the item comes back whole | same (pre-existing) | **RV** | `parseIngredientLine()` name assembly: when the unit was read from a count noun that is itself the food (`normalizeUnitToken` count `egg` / `breast` / `thigh`) and the rest of the name is measure-only, keep the unit word as the name (as bare `2 eggs` already names `eggs`) and read the trailing weight, rather than letting the measure become the name. Owner C70. Related, HELD: cloud-40's not-counted twin line `2 eggs scrambled` → name `scrambled` is the same mechanism; F1 is its VANISH case |
| F2 | parse + heuristic segmenter | `1,5 cups milk` / `0,5 l water` / `2,5 kg potatoes` / `1,000 g flour` (decimal / thousands comma) | parser: qty 1 name `5 cups milk`; **qty 0** name `5 l water`; qty 2 name `5 kg potatoes`. `forceSegmentText()` (LLM failure path) returns ONE item `5 cups milk` (3.3×), `5 kg potatoes` (2×), `000 g flour` (parses qty **0** g), `5 l water`; `1 & 1/2 cups rice` → `1/2 cups rice` | `1.5 cups milk`, `0.5 l water`, `2.5 kg potatoes`, `1000 g flour` | **VANISH** (qty 0 rows) / **PORTION** (the rest) | yes via the segmenter: `,` is in MULTI_ITEM_SIGNALS so these never take the short path; the heuristic split is COMPUTED, the LLM split is ASSUMED (the parser runs on whatever item text returns) | same | **RA** | ONE decimal-comma normalizer (`\d,\d{1,2}\b` → `.`, `\d{1,3}(,\d{3})+` → digits) applied to the line at entry of `parseIngredientLine()` (C70) and before the route's separator test / `forceSegmentText()` split (C69), so a comma between digits is never a list separator. Two owners, one mechanism: one row candidate |
| F3 | parse (`parseQuantityTokens`) | `2 dozen eggs` / `two dozen wings` / `3 dozen cookies` / `half a dozen eggs` / `1/2 dozen eggs` | qty 2 / 2 / 3 / 0.5 / 0.5, name `dozen eggs` / `a dozen eggs`. FatSecret Egg: `2 dozen eggs` **100 g** (twin `24 eggs` 1,200 g, 12×); `half a dozen eggs` **25 g** (twin 300 g). FDC harness: 88 g / 22 g. Control `a dozen eggs` → 12 | 24 / 24 / 36 / 6 / 6 | **PORTION** | yes: every path (short line) | same | **RB**, **RH** | `parseQuantityTokens()`: after any quantity it reads (digits, word number, fraction, `half a`), consume a following `dozen` as × 12, the way the `a dozen` article branch already counts it. Not cloud-38 D12 (approximator before `a dozen`) and not the HELD label-count `a dozen pizza rolls` (record label count) |
| F4 | parse (`parseQuantityTokens`) | `2 or 3 slices of pizza` / `2 or 3 cookies` / `3 or 4 almonds` / `two or three eggs` / `1 or 2 slices of bread` | qty 2, unit null, name **`or 3 of pizza`** / `or 3 cookies` / `or 2 of bread` (the measure word is lost too). FatSecret Cheese Pizza: **1,712 g** = 2 whole pizzas (twin `2-3 slices of pizza` 267.5 g, 6.4×) | the range the `-` / `to` forms read: 2.5 slices of pizza, 2.5 cookies | **PORTION** (IDENTITY effect on the query: the name starts `or`) | yes: every path (short line) | same | **RC**, **RH** | `parseQuantityTokens()`: read `<N> or <M>` (digits or word numbers, M > N) as the same range the `N-M` / `N to M` branch reads |
| F5 | parse (`leadingHedgePrecedesQuantity`) | `probably 2 slices of pizza` / `perhaps 2 eggs` / `i think 2 eggs` / `just 2 eggs` (also `prob`, `only 1 banana`) | qty 1, the whole line is the name (`probably 2 of pizza`). FatSecret: `probably 2 slices of pizza` **856 g** = 1 whole pizza (twin 214 g, 4×). Control `maybe 2 eggs` → 2 eggs | the un-hedged twin | **PORTION** | yes: every path (short line) | same | **RF**, **RH** | `leadingHedgePrecedesQuantity()`: accept 1–2 leading tokens when `parseQuantityTokens()` recognises the rest and the prefix is not a brand (`detectBrandInQuery` / `matchWordNumberBrandTokens`, which already keep `7 up` / `3 musketeers`), instead of requiring LEADING_HEDGES membership. Not cloud-36 C14 (#518's listed hedges) |
| F6 | parse (`parseQuantityTokens`) | `a quarter of a pizza` / `a quarter of an avocado` / `a third of a pizza` / `an eighth of a pie` (also `a third of a cup of rice`; `two thirds of a cup of milk` → unit `thirds`) | qty 1, whole line as name. FatSecret: `a quarter of a pizza` **856 g** (twin `quarter of a pizza` 214 g, 4×). Control `half a banana` → 0.5 | 0.25 / 0.25 / ⅓ / ⅛ of the food | **PORTION** | yes: every path | same | **RD**, **RH** | `parseQuantityTokens()`: let `a`/`an` count as the article before the word fractions (`half` / `quarter` / `third`; `eighth` is not in `wordFractions` either) as it already does before `dozen` / `couple` / `few`. Borderline with MGR's HELD `quarter of a digiorno` (package fraction vs label serving): that mechanism is which serving a fraction scales; this one is the fraction never being read |
| F7 | parse / unit (`normalizeUnitToken`) | `250mls milk` / `8 fl. oz. milk` / `3 ozs cheese` (also `1 ltr water`, `2 tblsp honey`) | unit null, names `mls milk` / `floz. milk` / `ozs cheese`; the AI parse fallback does not trigger (its regex needs `ml\b` / `fl\s*oz` / `oz\b`). FatSecret Milk: `250mls milk` **61,000 g** = 250 cups (twin 257.8 g, 236×); `8 fl. oz. milk` **1,952 g** = 8 cups (twin 247.3 g, 7.9×). `3 ozs cheese` bills 85 g on FatSecret only because the default serving is 1 oz (FDC harness 450 g) | `ml` / `floz` / `oz` | **PORTION** | yes: every path | same | **RE**, **RH** | `normalizeUnitToken()`: fold a trailing plural `s` and abbreviating periods (`fl.`, `oz.`) onto the known spelling before the table lookup, so every unit accepts its plural / dotted form (keeping the named `gs` exclusion). **Same owner function as cloud-42 F4 (`qt` / `gal` / `pt`, HELD): one row candidate with it** |
| F8 | pepper lexicon (#596, `getBareQueryDefault`) → `applyOffBareQueryGuard` | `doctor pepper` / `dr-pepper` / `cherry pepper` / `thai pepper` / `hatch pepper` / `pasilla pepper` / `stuffed pepper` (also `piquillo`, `carolina reaper`, `hot cherry pepper`; `pepper steak` by lexicon only) | the spice alternative still matches, and the guard **caps a declared label serving (355 / 30 / 10 / 45 / 250 g) to 2.5 g** (up to 142×). Control `dr pepper` → null, no cap | the label serving, as #596 gives `dr pepper` | **PORTION** | yes: bare 2-word lines on the short path (`capMayOverrideLabelServing()` lets 3+ word names keep their label, so `pepper jack cheese` / `sea salt chips` are not capped) | same (the pre-#596 regex) | **R596** | `getBareQueryDefault()`: invert the pepper alternative to a positive spice reading (`pepper` is the 1-tsp spice only when bare or preceded by a spice modifier: black / white / ground / cracked / cayenne / crushed red / lemon), rather than growing the lookbehind's refusal list by one more variety. Inside #596's own claimed class ("a brand or chili-variety word before pepper"). `ghost`, `red`, `chili`, `chile` are out by the body (HELD) |
| F9 | rank-time (#595, `pouredDrinkReason`) | `coffee with creamer` / `coffee with a splash of creamer` / `coffee w/ creamer` / `iced coffee with whipped cream` / `coffee with ground cinnamon`, on a 300 kcal/100 g panel | silent: the exemption list is tested over the WHOLE `queryName`, so a topping word after `with` (`creamer`, `whipped`, `ground`) exempts the poured drink. Control `coffee with cream` fires | fires (head `coffee`, the panel is not a drink) | **NO-FIRE** | yes: these reach rerank as the queryName (the segmenter keeps `X with Y` whole when it does not split, and `coffee w/ creamer` takes no `with` split) | n/a (#595 adds the rule) | **R595** (first block) | `pouredDrinkReason()`: test the exemptions against `words` (the queryName head clause it already computes for the head) plus headLine's head clause. **Distinct from cloud-42 D2** (a sibling's word in headLine): D2's fix keeps the whole-queryName read, so it does not reach F9; land both as ONE row candidate (one exemption scope). Cost to state: `coffee with butter` / `with protein powder` would then fire, which is right on a dry panel (their poured panels are ≤ 150) |
| F11 | parse (article-led measure) | `a glass of wine` / `a mug of coffee` / `a pack of gum` / `a shot of espresso` / `a spoonful of peanut butter` (also `a portion of fries`, `a dollop of sour cream`, `a jug of milk`, `an order of fries`) | qty 1, unit null, the whole line is the name. The digit / word-number twins read the measure: `1 glass of wine` and `one glass of wine` → unit `glass`, name `wine`; `2 mugs of coffee` → `mugs` / `coffee`. FatSecret Red Wine bills 147 g on both forms (the label count reads the raw line), so the visible effect is the retrieval query and cache key, `a glass of wine` | unit `glass`, name `wine`, as the twin | **NO-FIRE** (IDENTITY effect on retrieval, unmeasured offline) | yes: short path, baseName = parsed.name | same | **RG** | `parseIngredientLine()` article-led measure branch: accept the same raw `<word> of` unit that the `1` / `one` branch already accepts after a quantity, instead of only the units in ARTICLE_MEASURE_UNIT_SOURCE. cloud-42 noted `a glass of water` falling through the water fast path (not counted): same mechanism |
| F10 | rank-time (#595) | `cream tea` 360 / `high tea` 300 / `afternoon tea` 300 | `rank:poured_drink_kcal_*` fires and floorHit true: the head `tea` names a MEAL (scones / sandwiches), so a scone or sandwich record is partitioned below any ≤ 150 tea record | silent (not a brewed-drink line) | **NOISE** | yes: 2-word short lines | silent (caused by #595) | **R595** (second block) | none proposed: only a meal-sense word list would separate them, which the brief rules out. Seat call, as cloud-42 left `diet coke chicken` |

Class counts: INTEGRATION-RED 0 · VANISH 2 (F1, F2) · IDENTITY 0 · PORTION 6 (F3–F8) · NO-FIRE 2 (F9, F11) · NOISE 1 (F10). Row candidates: F2 (one normalizer, two owners); F3 + F4 + F6 are three separate branches of the same owner, `parseQuantityTokens()` (one C70 row, three changes); F7 joins cloud-42 F4; F9 joins cloud-42 D2.

Effect on the five PRs: none of F1–F8 or F11 is caused by #584 / #589 / #590 / #596 (all reproduce identically on `8b87b05e`). F8 sits inside #596's claimed class but was already wrong before it. F9 and F10 are #595's.

### Reproductions (each fails on `sweep-int` on its target line; the control line passes)

**RV** (`mapIngredientWithFallback`; preamble = lines 1–142 of `src/lib/mapping/__tests__/map-ingredient-with-fallback.test.ts` with paths rebased; fails 4/4 at the second expect, `mapping.no_food_name` with baseName `100 g` in the log):
```ts
    it.each(['2 eggs (100 g)', '3 eggs (150g)', '2 eggs 100g', '1 egg (50g)'])('VANISH: %s maps like `2 eggs`', async (line) => {
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'egg', source: 'ai_generated', name: 'Egg, Whole, Raw', brandName: null, score: 0.9, rawData: {} },
        ]);
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'egg', displayName: 'Egg, Whole, Raw', ingredientName: 'egg',
            caloriesPer100g: 143, proteinPer100g: 12.6, carbsPer100g: 0.7, fatPer100g: 9.5,
            servings: [{ id: 'srv-egg', label: '1 large', grams: 50 }],
        });
        const control = await mapIngredientWithFallback('2 eggs', { minConfidence: 0, skipFdc: true });
        expect(control).not.toBeNull();
        expect(await mapIngredientWithFallback(line, { minConfidence: 0, skipFdc: true })).not.toBeNull();
    });
});
```

**RA**, **RB**, **RC** (fail 3+2 / 5 / 4):
```ts
import { parseIngredientLine } from '../parse/ingredient-line';
import { forceSegmentText } from '../nlp/heuristic-segmenter';
const p = (l: string) => { const r = parseIngredientLine(l)!; return { qty: r.qty * (r.multiplier ?? 1), unit: r.unit, name: r.name }; };

describe('RA decimal comma', () => {
  it.each([['1,5 cups milk', 1.5, 'cup', 'milk'], ['0,5 l water', 0.5, 'l', 'water'], ['2,5 kg potatoes', 2.5, 'kg', 'potatoes']])(
    '%s', (line, qty, unit, name) => {
      expect(p('1.5 cups milk')).toEqual({ qty: 1.5, unit: 'cup', name: 'milk' });
      expect(p(line)).toEqual({ qty, unit, name });
    });
  it.each(['1,5 cups milk', '2,5 kg potatoes'])('heuristic split keeps %s whole', (line) => {
    expect(forceSegmentText(line).map((i) => i.rawText)).toEqual([line]);
  });
});
describe('RB dozen after a number', () => {
  it.each([['2 dozen eggs', 24], ['two dozen wings', 24], ['half a dozen eggs', 6], ['1/2 dozen eggs', 6], ['3 dozen cookies', 36]])(
    '%s', (line, qty) => {
      expect(p('a dozen eggs').qty).toBe(12);
      const r = p(line);
      expect(r.qty).toBe(qty);
      expect(r.name).not.toMatch(/dozen/);
    });
});
describe('RC `N or M` range', () => {
  it.each([['2 or 3 cookies', 'cookies'], ['3 or 4 almonds', 'almonds'], ['two or three eggs', 'eggs'], ['1 or 2 slices of bread', 'bread']])(
    '%s', (line, name) => {
      expect(p('2-3 cookies').name).toBe('cookies');
      expect(p(line).name).toBe(name);
    });
});
```

**RD**, **RE**, **RF**, **RG** (fail 4 / 3 / 4 / 5; RG = F11):
```ts
import { parseIngredientLine } from '../parse/ingredient-line';
const p = (l: string) => { const r = parseIngredientLine(l)!; return { qty: r.qty * (r.multiplier ?? 1), unit: r.unit, name: r.name }; };

describe('RD article-led fraction', () => {
  it.each([['a quarter of a pizza', 0.25, 'pizza'], ['a quarter of an avocado', 0.25, 'avocado'], ['a third of a pizza', 1 / 3, 'pizza'], ['an eighth of a pie', 0.125, 'pie']])(
    '%s', (line, qty, food) => {
      expect(p('half a banana').qty).toBe(0.5);
      const r = p(line);
      expect(r.qty).toBeCloseTo(qty);
      expect(r.name).toMatch(new RegExp(`^(an? )?${food}$`));
    });
});
describe('RE unit plural / dotted spelling', () => {
  it.each([['250mls milk', 250, 'ml'], ['3 ozs cheese', 3, 'oz'], ['8 fl. oz. milk', 8, 'floz']])(
    '%s', (line, qty, unit) => {
      expect(p('250ml milk')).toMatchObject({ qty: 250, unit: 'ml' });
      expect(p(line)).toMatchObject({ qty, unit });
    });
});
describe('RF leading hedge outside the list', () => {
  it.each([['probably 2 slices of pizza', 2, 'pizza'], ['perhaps 2 eggs', 2, 'eggs'], ['i think 2 eggs', 2, 'eggs'], ['just 2 eggs', 2, 'eggs']])(
    '%s', (line, qty, name) => {
      expect(p('maybe 2 eggs')).toMatchObject({ qty: 2, name: 'eggs' });
      expect(p(line)).toMatchObject({ qty, name });
    });
});
describe('RG article-led measure word outside the unit table', () => {
  it.each([['a glass of wine', 'glass', 'wine'], ['a mug of coffee', 'mug', 'coffee'], ['a pack of gum', 'pack', 'gum'], ['a shot of espresso', 'shot', 'espresso'], ['a spoonful of peanut butter', 'spoonful', 'peanut butter']])(
    '%s', (line, unit, name) => {
      expect(p('1 glass of wine')).toMatchObject({ unit: 'glass', name: 'wine' });
      expect(p(line)).toMatchObject({ qty: 1, unit, name });
    });
});
```

**RH** (`buildFatSecretResult`, the FatSecret grams behind F3–F7; fails 7/7):
```ts
const mockFind = jest.fn();
jest.mock('../db', () => ({ prisma: { fatSecretFood: { findUnique: (...a: unknown[]) => mockFind(...a) } } }));
import { buildFatSecretResult } from '../mapping/build-fatsecret-result';
import { parseIngredientLine } from '../parse/ingredient-line';
const sv = (servingId: string, description: string, md: string, grams: number, numberOfUnits = 1, volumeMl: number | null = null) =>
    ({ servingId, description, measurementDescription: md, grams, volumeMl, numberOfUnits, nutrients: { calories: grams * 0.6, protein: 1, carbohydrate: 1, fat: 1 } });
const FOODS: Record<string, any> = {
    milk: { fsId: '793', name: 'Milk', defaultServingId: 'c', servings: [sv('c', '1 cup', 'cup', 244, 1, 236.6), sv('fo', '1 fl oz', 'fl oz', 30.5, 1, 29.6), sv('g', '100 g', 'g', 100, 100)] },
    egg: { fsId: '3092', name: 'Egg', defaultServingId: 'l', servings: [sv('l', '1 large', 'large', 50), sv('cu', '1 cup', 'cup', 243), sv('g', '100 g', 'g', 100, 100)] },
    pizza: { fsId: '55', name: 'Cheese Pizza', defaultServingId: 'sl', servings: [sv('sl', '1 slice', 'slice', 107), sv('pz', '1 pizza (12")', 'pizza', 856), sv('g', '100 g', 'g', 100, 100)] },
};
const grams = async (line: string, food: string) => {
    const f = FOODS[food];
    mockFind.mockResolvedValue({ brandName: null, foodType: 'Generic', nutrientsPer100g: { kcal: 60, protein: 3, carbs: 5, fat: 3 }, fetchedAt: new Date(), createdAt: new Date(), updatedAt: new Date(), ...f });
    const r = await buildFatSecretResult({ id: `fs_${f.fsId}`, source: 'fatsecret', name: f.name, brandName: null, score: 1, foodType: 'Generic', rawData: {} } as never, parseIngredientLine(line)!, 0.9, line);
    return r!.grams;
};
it.each([
    ['250mls milk', '250ml milk', 'milk'], ['8 fl. oz. milk', '8 fl oz milk', 'milk'], ['2 dozen eggs', '24 eggs', 'egg'],
    ['half a dozen eggs', '6 eggs', 'egg'], ['2 or 3 slices of pizza', '2-3 slices of pizza', 'pizza'],
    ['probably 2 slices of pizza', '2 slices of pizza', 'pizza'], ['a quarter of a pizza', 'quarter of a pizza', 'pizza'],
])('FatSecret lane: %s bills within 2x of its twin %s', async (line, twin, food) => {
    const t = await grams(twin, food);
    const g = await grams(line, food);
    expect(g / t).toBeGreaterThan(0.5);
    expect(g / t).toBeLessThan(2);
});
```

**R596** (fails 7/7: `applyOffBareQueryGuard` returns 2.5 g):
```ts
import { applyOffBareQueryGuard } from '../servings/bare-query-guard';
import { getBareQueryDefault } from '../ai/ambiguous-serving-estimator';
import { parseIngredientLine } from '../parse/ingredient-line';
const cap = (q: string, grams: number) => applyOffBareQueryGuard({
    grams, servingTier: 'bare_label_serving', parsed: parseIngredientLine(q), rawLine: q, queryName: q, foodName: q, servingDescription: `1 serving (${grams} g)`,
} as never);
it.each([['doctor pepper', 355], ['dr-pepper', 355], ['cherry pepper', 30], ['thai pepper', 10], ['hatch pepper', 45], ['pasilla pepper', 30], ['stuffed pepper', 250]])(
    'not the spice tsp: %s', (q, grams) => {
        expect(getBareQueryDefault('dr pepper')).toBeNull();
        expect(cap('dr pepper', 355)).toBeNull();
        expect(cap(q, grams)?.grams ?? grams).toBe(grams);
        expect(getBareQueryDefault(q)?.grams).not.toBe(2.5);
    });
```

**R595** (fails 5 + 3):
```ts
import { assessRankTimePlausibility } from '../mapping/macro-plausibility';
const panel = (kcal: number) => ({ kcal, protein: 3, carbs: (kcal * 0.6) / 4, fat: (kcal * 0.4) / 9 });
const poured = (q: string, kcal: number) =>
    assessRankTimePlausibility(q, 'x', panel(kcal)).reasons.some((r) => r.startsWith('rank:poured_drink_'));
it.each(['coffee with creamer', 'coffee with a splash of creamer', 'coffee w/ creamer', 'iced coffee with whipped cream', 'coffee with ground cinnamon'])(
    'FIRES (topping word is not the product): %s', (q) => {
        expect(poured('coffee with cream', 300)).toBe(true);
        expect(poured(q, 300)).toBe(true);
    });
it.each(['cream tea', 'high tea', 'afternoon tea'])('SILENT (a meal, not a brewed drink): %s', (q) => {
    expect(poured('tea biscuits', 360)).toBe(false);
    expect(poured(q, 360)).toBe(false);
});
```

## Serving rungs probed (row 1 b)
Twelve rungs, 3 FDC-lane harness lines or more that should reach each and the variant / twin pairs that must not:
- FDC `fdc_label_volume`: `1 cup almonds` 143, `1 cup shredded cheese` 113, `1 tbsp butter` 14.2, `1 quart milk` 976, `a cup of rice` 158 (own rows). Must not: `8 fl. oz. milk`, `250mls milk` (F7; they leave the volume branch).
- FDC `weight_unit`: `1 oz cheese` 28.4, `1 lb wings` 453.6. Must not: `3 ozs cheese` (F7).
- FDC `fdc_own_size_serving`: `2 large eggs` 100 (large row), `2 slices pizza` 214, `3 slices of cheese` 84, `a carrot` 61, `5 carrots` 305. Must not: `2 dozen eggs` (88 g, F3), `probably 2 eggs` (44 g, F5) — both reach it with the wrong qty.
- FDC `fdc_size_qualifier`: `a large avocado` 200. FDC `seed_count_default`: `30 almonds` 36 (1.2 g row). FDC `fdc_piece_ai`: `6 wings`, `10 wings`. FDC `fdc_size_estimate`: `1 avocado`, `half an avocado` 0.5 ×, `quarter of a pizza` 0.25 ×. Must not: `a quarter of an avocado` (1 ×, F6), `2 or 3 cookies` (F4).
- FDC `bare_query_default`: `a pat of butter` 14 g.
- FatSecret `fs_weight_direct` (`3 oz cheese` 85.1), `fs_label_volume` (`8 fl oz milk` 247.3, `250ml milk` 257.8, `1.5 cups milk` 371.3), `fs_label_count` (`2 slices of pizza` 214, `quarter of a pizza` 214, `1 glass of wine` 147), `count_unit_ai` (`2 eggs` 100, `24 eggs` 1,200), `fs_default_serving` — every F3–F7 variant lands here or on `fs_label_count` with the twin's measure lost (RH).
- Not probed: OFF (every `buildOffResult` tier; its fixture harness was not built in the time box), FDC `fdc_unit_heuristic`, `fdc_volume_ai`, `volume_unit` (one incidental line: `a pint of milk` 473.2), `fdc_size_key_missing` / `_unresolved`, `fdc_sub_piece_default`, `fdc_medium_estimate`, `fdc_piece_unresolved`, `fdc_size_estimate_unresolved`, `count_unit_*` (only the mocked-off `count_unit_unresolved` was reached), `fdc_unknown_unit`, `flat_100g_default`; FatSecret `fs_label_volume_declared`, `fs_volume_density`, `fs_serving_macros_only`, `fs_per100g_fallback`.
- No rung-level finding of its own: every serving defect seen is a parse defect carried into the rung. Harness caveat, not counted: on FDC the explicit `2 eggs` / `12 eggs` (unit `egg`) and `1 stick butter` / `a bowl of rice` take the ambiguous-unit route, which this harness mocks off (100 g each); production asks the LLM there, as cloud-42 noted.

## #595 and #596 as the subject (row 1 c), beyond F8–F10
- #596, held as the body says: `dr pepper`, `dr. pepper`, `drpepper`, `diet dr pepper`, `dr pepper zero`, `dr pepper float`, `jalapeno` / `jalapeño pepper`, `green pepper`, `sweet pepper`, `mini sweet pepper`, `roasted red pepper(s)`, `fire roasted red pepper` → not the spice; `pepper`, `black` / `white` / `ground` / `cayenne` / `lemon` / `red pepper` → 2.5 g; `peppers`, `stuffed peppers`, `green peppercorns` → null (a plural or a longer word never matches `pepper\b`). Deliberately out by the body: `ghost pepper`, `red pepper`, `chili pepper flakes`. `chipotle pepper` / `ancho pepper` stay 2.5 g and are not counted (a dried chile can be a spice).
- #596, other spice tokens, pre-existing and outside its rule, noted not counted: `sea salt chips`, `salt and vinegar chips`, `pepper jack cheese`, `black pepper jerky` match the lexicon, but the 3+ word `capMayOverrideLabelServing()` keeps their label serving, so no cap; `pepper steak` matches the lexicon but the guard did not cap it in the probe.
- #595, held as the body says: `espresso` 241 fires; `coffee` 151 fires and 150 is silent; `black coffee`, `decaf coffee`, `coffee decaf`, `hot tea`, `tea hot`, `cold brew`, `green tea with ginger`, `tea with honey`, `tea with milk and sugar`, `coffee with sugar`, `iced coffee with a donut` fire; `coffee creamer`, `coffee crisp` 500, `chai seeds` 480, `coffee with butter` (bulletproof, exempt by design) are silent; `home brew` fires on a 300 panel but a beer pool sits below 150, so it is harmless. Item `coffee` under headLine `coffee with creamer` / `iced coffee with whipped cream` and item `tea` under headLine `cream tea`: the headLine scope is cloud-42 D2 (HELD).

## Held (known, measured here, not counted)
- cloud-42 F4 `qt` / `gal` / `pt`: `1 pt ice cream` → name `pt ice cream`. F7 shares its owner.
- cloud-40 HELD #580 class: `2 tacos x 2`, `4 cookies x 2`, `2 bananas x2` → name `… x 2`; `2 eggs x2` → name `x2`, `2 eggs x 2` → name `x 2`; `x2 eggs` → name `x2 eggs` (#581 header); `eggs x2` → 2 eggs (pinned).
- cloud-40 parser twins: `3 eggs scrambled` → name `scrambled`; `2 eggs (large)` → null parse (as `2 eggs large`).
- cloud-38 D10 filler adjective: `a big apple` → whole line (no unit follows `big`).
- Parked: `a 12 oz can of coke`, `a 20oz bottle of coke` → whole line, unit null (the `a 2 liter bottle of water` class). `a bottle of coke` = bottle (the bottle decision).
- MGR seat-row mechanisms: `quarter of a pizza` scales the record's whole-pizza label (`fs_label_count` 0.25 × 856 g) — package fraction vs label serving.

## Inputs I expected to break that HELD
- Fractions and mixed numbers: `1 1/2 cups rice`, `1½ cups`, `2 ½ cups`, `2½ tbsp`, `¼ cup`, `⅓ cup`, `.5 cup`, `.75 cup`, `one half cup`, `half a banana`, `half an avocado`, `half of a bagel`, `one and a half cups`, `1 and a half cups`, `a slice and a half of pizza`, `1 and 1/2 slices of pizza`.
- Ranges and multiplication: `2-3 eggs`, `2–3 eggs` (en dash), `2 - 3 eggs`, `2 to 3 eggs`, `3-4 oz chicken`, `1 to 2 tbsp butter`; `2 x 3 oz chicken` → 2 × 3 oz, `3 x 2 tbsp peanut butter`, `2x 100g chicken` → 200 g, `3x eggs`, `4 x eggs`, `2 x eggs`, `eggs (x2)`, `x 2 eggs`.
- Count words: `a couple eggs`, `a couple of eggs`, `couple slices of bacon`, `couple of beers`, `a few almonds`, `few cookies`, `a dozen eggs`, `2 pairs of eggs` (unit `pairs`), `a handful of almonds`, `2 handfuls`, `a bunch of grapes`.
- Abbreviations: `2 tbsps`, `1 tsp.`, `3 tsps`, `2 lb`, `2 lbs.`, `1 c.`, `2 T butter`, `1 Tbs`, `1 tbls`, `100 gr`, `100gr`, `1 oz.`, `8 fl oz`, `8floz`, `12 fl oz coke`, `250 ml`, `2 kgs`, `1 kilo`.
- Hedges: `roughly 2 cups`, `maybe 2 eggs`, `like 3 eggs`, `about a cup of rice`, `about 2 eggs`, `around 200g`, `approx 100g`, `approximately 2 cups`, `~100g rice`, `like half a sandwich`, `maybe a cup of rice`, `like a handful of almonds`.
- Size words: `2 large eggs`, `a small apple`, `1 medium banana`, `medium banana`, `a large coffee`, `a small handful of almonds` (unit `small`, name `handful of almonds`: the size word wins the unit slot; not counted).
- Unicode / typo / containers: `½ cup rice`, `1 cup of rice`, `2 cup rice`, `cup of coffee`, `1 tablespoon of peanutbutter`; `a can of tuna`, `a bag of chips`, `a box of mac and cheese`, `a jar of salsa`, `a carton of eggs`, `a packet of oatmeal`, `a tub of yogurt`, `a sleeve of crackers`, `2 cans of beer`, `a container of yogurt`, `a liter of coke`, `a scoop of ice cream`, `a piece of cake`, `a bar of chocolate`, `a stick of gum`, `a cube of cheese`, `a pinch` / `a dash of salt`; `a sip of coke` / `a drizzle of honey` → 0.5 fl oz (#514).
- Bare decimals before a brand: `1.5 cliff bars`, `2.5 kirkland protein bars`, `1.5 quest bars`, `0.5 pumpkin pie`, `3.5 oz tillamook cheese`, `16.9 oz fiji water`, `12.5 oz chicken breast` all keep qty and name.

## Not counted (below the 2× PORTION line, or unmeasurable offline)
- `1-1/2 cups flour` → qty 1 (1.5×), `1/2-1 cup rice` → 1 (vs 0.75), `1 & 1/2 cups rice` → name `& 1/2 cups rice`, `3 extra large eggs` → unit null, name `extra eggs`, qualifier `large` (132 vs 168 g), `2 jumbo eggs` → unit null (88 vs 126 g), `several crackers` and `a pair of eggs` → qty 1 (only a word list would add them), `a lil bit of rice` / `a tiny bit of rice` (#584's hedge reads `a bit of` / `a little bit of` only), `just a bite of cake`.
- Unit after the name: `eggs 2`, `banana 1`, `coffee 2 cups`, `rice 1 cup`, `oats 1/2 cup` (qty 1, the measure stays in the name), and parenthetical weights `chicken breast (6 oz)`, `1 bagel (100g)`, `steak (8oz)`, `1 serving (28g) chips` (the weight joins the name). Where `parsed.unit` is null and the line matches the mapper's unit regex (`6 oz`, `100g`) the AI parse fallback recovers it in production (mocked off here); `coffee 2 cups` and `eggs 2` match no part of that regex (`cup\b` misses `cups`), so they bill one unit. Unmeasured offline, so not counted; the regex miss is a one-line note for the owner of the preflight.
- No-quantity unit lines: `tbsp butter`, `tsp sugar`, `oz cheese` → unit null, the unit in the name (`cup of coffee` reads its unit). Grams depend on the bare-query lexicon.

## Not reached (time box)
- The OFF lane, entirely (no `buildOffResult` fixture harness was built).
- Route-level runs of F1 / F2 inside multi-item text, and the LLM segmenter's real item text for decimal commas.
- #584 / #589 / #590 were not re-attacked as subjects (cloud-42 covered #589 / #590; #584 only incidentally: `a lil bit of` / `a tiny bit of` stay whole lines).

## Commands and exits
| command | exit |
|---|---|
| `[ "$(git rev-parse --is-shallow-repository)" = true ] && git fetch --unshallow origin \|\| true` | 0 |
| `git fetch origin +refs/heads/master:refs/remotes/origin/master` | 0 |
| `git merge-base --is-ancestor 8b87b05e origin/master` | 0 |
| THE TREE (`git checkout -b sweep-int 8b87b05e`; 5 × `git fetch origin <branch>` + head check + `git -c user.name=cloud43 -c user.email=cloud43@invalid merge --no-edit FETCH_HEAD`) | all clean, no MOVED line |
| `npm ci` | 0 |
| `env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="postgresql://x:y@localhost:5432/z" npx jest --ci --testPathIgnorePatterns /node_modules/ src/ops/curated/__tests__/seed-curated.test.ts > full.log 2>&1` (on `sweep-int`) | 0; 382 suites, 9,978 passed + 1 skipped |
| RV / RA–RC / RD–RG / RH / R596 / R595 on `sweep-int` (same env, one file each, `> <file> 2>&1`) | 1 / 1 / 1 / 1 / 1 / 1 (4 / 14 / 16 / 7 / 7 / 8 failed, each on its target line) |
| the same on a `8b87b05e` worktree | 1 / 1 / 1 / 1 / 1 / 1 (4 / 14 / 16 / 7 / 7 failed; R595 5 failed + 3 passed: the FIRES rows fail because no rule exists, the F10 SILENT rows pass, so F10 is #595's) |
| `git worktree remove` of the base worktree; `rm -r src/lib/__cloud43__` | 0 |
