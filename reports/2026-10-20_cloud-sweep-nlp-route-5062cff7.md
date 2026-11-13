# Cloud sweep of the NLP route passes on the deployed tree `5062cff7`
cloud-44 · run 2026-10-20 (UTC) · read-only adversarial fixture sweep of `evawlve/Recipe-App` `master` = `5062cff7` (live as build `OXDweVItXZnBPzrwDiTii`), on a local branch `sweep-nlp` (never pushed). No code is changed. This PR commits only this report.

## Tree and full suite
- `5062cff7` is an ancestor of `origin/master` (exit 0). Nothing merged on top.
- Full suite (offline env, `test:ci` command): **exit 0, 382/382 suites, 9,878 passed + 1 skipped, 0 red. No INTEGRATION-RED.**

## Pass order (derived from `runParse()` in `src/app/api/nlp/parse/route.ts` on `5062cff7`)
1. **Split source**, exactly one of:
   - item-form input (`items[]`): no route pass runs.
   - `singleItemFromText()` (`route.ts:53`): trimmed line ≤ 60 chars (meal suffix included), no `, ; + & \n` / `and` / `with` / `plus` after the `for/at/as <meal>` suffix is stripped, not `isPourOntoSecondFood()` (`route.ts:67`), ≤ 6 words. One item, then **`stripSoloRemoval()` (`route.ts:383`, #573)** strips a trailing `without|minus <part>` clause. No other route pass runs.
   - otherwise SegmentationCache hit / LLM split (`segmentTextWithAi`, `SEG_PARSER_VERSION = 'seg-v2'`) / `forceSegmentText` heuristic when the LLM errors or times out (`route.ts:442`), then `capSplit`, then the cache write (the UNPROCESSED split).
2. Segmenter branch only, keyed on `lineKey = canonicalizeSegLine(text)` (`route.ts:407`), confirmed in this order:
   **`restoreLeadingPour` (`:459`) → `resolveSelfCorrections` (`:462`) → `dropNegatedParts` (`:470`) → `dropDishParts` (`:478`) → `foldDrinkMilk` (`:485`) → `rewriteExtraPortions` (`:493`) → `dropSegmenterEchoes` (`:498`) → `readMadeWithHeads` (`:505`) → `foldTrailingQuantityClauses` (`:510`) → `fillRestaurantBrand` (`:521`)**.
3. Every item on every path: `parseIngredientLine(rawText)`, then `mapIngredientWithFallback()`.

**Reachability** (cloud-38's rule): `singleItemFromText()` answers a short line alone, so the segmenter-branch passes never see it. Every line below was checked against the condition with a copy of it in the harness (`shortPath()`). Every line in the findings takes the segmented path. Each finding carries `reachable` and its split SOURCE: `COMPUTED` (the real `forceSegmentText()` output, which is what the route uses when the LLM fails) or `ASSUMED` (a hand-written LLM split shaped like the named fixture or header shape).

## Method
- Read: root `CLAUDE.md` (§Mapping-pipeline change rules); the findings tables and HELD lists of cloud-36, cloud-38, cloud-40, cloud-42 and cloud-43; `route.ts` in full; the headers and the code paths I attacked in `trailing-quantity-fold.ts` (gap fold, segment fold, stock), `self-correction.ts` (main loop and qty kind), `negated-part-drop.ts`, `dish-part-drop.ts` (header and trigger), `drink-milk-fold.ts`, `segmenter-echo-drop.ts`, `extra-portion.ts`, `restaurant-brand-fill.ts`, `loose-measures.ts` (`restoreLeadingPour`, `isPourOntoSecondFood`), `heuristic-segmenter.ts` (`splitAndClean`, `forceSegmentText`), and `ai-segmenter.ts` (version only). The fixtures under `src/lib/nlp/__tests__/fixtures/` were grepped for pins on each candidate.
- About 230 lines through a harness in `src/lib/__cloud44__/` (deleted before this commit): `chain()` = cloud-40's preamble **plus `fillRestaurantBrand`**, in `runParse()` order (verbatim below), about 190 on ASSUMED LLM splits and about 30 on the COMPUTED `forceSegmentText()` split; about 20 `parseIngredientLine` calls on the items that survive; and a route harness (cloud-38's mocks, plus an LLM-error mock for the heuristic path) for every finding.
- Each finding was checked against the five predecessor tables and HELD lists, every pass header's KNOWN MISSES / Known miss / Named misses / Known gaps / Named false positive / NON-FIRES text, and the fixture pins. Each has a one-item or reordered **control that passes**, to show the mechanism is the one named.

## Findings (ranked VANISH > IDENTITY > PORTION > NO-FIRE > NOISE)

| id | pass | input | observed (what reaches the mapper) | expected | class | reachable | split source | reproduction | proposed fix (one sentence; function; pass) / row candidate |
|---|---|---|---|---|---|---|---|---|---|
| F1 | heuristic segmenter (`forceSegmentText` → `splitAndClean`) | `half & half in coffee and a bagel` / `mac & cheese and a coke` / `m&ms and a coke` / `a&w root beer and fries` (also `salt & vinegar chips`, `pb&j`, `ben & jerrys`, `cookies & cream ice cream`, `ham & cheese sandwich`, `b&e sandwich`) | `half in coffee` + `a bagel`: the creamer's `half` fragment has no content word and is filtered, and `half in coffee` parses as qty 0.5 of `in coffee`. `mac` + `cheese` + `a coke`; `m` + `ms`; `w root beer` (the `a` fragment is dropped); `pb` + `j`; `salt` + `vinegar chips`. `DELIMITER_SPLIT_RE` splits on any `&`/`+`, even inside a word, and `maskAtomicPhrases()` masks only the ` and ` spelling, so `mac & cheese` misses the `mac and cheese` mask | `half & half in coffee` + `a bagel`; `mac & cheese`; `m&ms`; `a&w root beer` (as `mac and cheese and a coke` → `mac and cheese` + `a coke`, measured) | **VANISH** (half & half); **IDENTITY** (the rest) | yes: `&` is in MULTI_ITEM_SIGNALS, so every such line goes to the segmenter, and the heuristic split is what the route uses whenever the LLM errors or passes its deadline | **COMPUTED** | **F1**, **RF1**, **RF1b** | `splitAndClean()`: split on `&` / `+` only when whitespace stands on both sides, and let `maskAtomicPhrases()` accept `&` as a spelling of `and` in the phrases it already lists (no new phrase). **Row candidate A, with F6** (one function family, `heuristic-segmenter.ts`; owner C69). Not cloud-43 F2: that is a digit comma and `1 & 1/2` |
| F2 | trailing-quantity fold (gap fold, partial and plain clause) | `a pizza and a coke, i gave half the pizza to my friend` / `a burrito and a coke, only ate half the burrito` / `a sandwich and chips, i gave half the sandwich to my son` (the segmenter drops the clause) | unchanged: `a pizza`, `a burrito`, `a sandwich` billed whole. The gap fold reads a trailing clause only against the item right before it (`t === n - 1`); `covers(a coke, ['pizza'])` fails and no earlier item is tried. Controls: `a coke and a pizza, i gave half the pizza…` → `1/2 pizza`; the one-item `a burrito, only ate half the burrito` → `1/2 burrito` | `1/2 pizza` / `1/2 burrito` / `1/2 sandwich`, the other item unchanged | **PORTION** (2×: the whole item for a half) | yes: `,` / `and` → segmenter | ASSUMED (partial-eat.json clause-dropped shape, two items) | **F2**, **RF2** | `foldTrailingQuantityClauses()` gap fold: when the clause after the LAST item names a food that item does not cover, give it to the one earlier live item that does cover it (unique `covers()` match, no clause of its own), under the same partial / plain guards. The header's "multi-item lines with an UNNAMED clause" miss stays: the name removes the ambiguity. **Row candidate B** (owner C69) |
| F3 | self-correction (qty kind) | `a coffee and a donut, actually make that two` / `a coffee and 1 donut, make that 3` / `toast and 2 eggs, no wait, 3` / `toast and 2 eggs, actually 3` | `a coffee`, `a donut`, **`two`**: no correction, and the quantity item survives and reaches the mapper (`parseIngredientLine('two')` is null, so it bills nothing). The qty kind needs the previous item "alone in its comma piece", and `and` puts the coffee in the donut's piece. Controls: `a coffee, a donut, actually make that two` → `2 donut`; `toast, 2 eggs, wait no, 3` → `3 eggs`; `2 eggs and toast, actually 3 eggs` (a restated food) → `3 eggs` | `2 donut` / `3 donut` / `3 eggs` | **PORTION** (2× and 3× on the donut lines; 1.5× on the egg lines) | yes | ASSUMED (self-correction.json qty shape with an `and`-joined first piece) | **F3**, **RF3** | `resolveSelfCorrections()` qty kind: accept the previous live item when it is the LAST item of its comma piece and the correction gap follows it directly (the marker sits right after it). Keep "alone" for a previous item followed by anything else in its piece. **Row candidate C** (owner C69). See F5 for the orphan item |
| F4 | negated-part drop (`negatedInLine`) | `a salad without dressing and a coke` / `a burrito without beans, and chips` / `tacos minus sour cream, and a margarita` (split [host \| bare part \| next]) | the bare part is billed: `dressing`, `beans`, `sour cream`. `negatedInLine()` refuses a negator that follows the host in the same comma piece, a guard written for `a latte no cappuccino` (a correction). It is applied to every NEG entry, but `without` / `minus` / `except` are never correction markers. Controls: `a salad with no dressing and a coke`, `a salad, no dressing, and a coke`, `a burrito, without beans, and chips` → the part is dropped | `a salad`, `a coke` / `a burrito`, `chips` / `tacos`, `a margarita` | **NO-FIRE** (PORTION effect: a removed part billed) | yes: a separator elsewhere in the line (the comma-less `a salad without dressing` alone is short-path, and `stripSoloRemoval` covers it there) | ASSUMED (negated-part-removals.json bare-part shape, `a burrito with no sour cream or cheese` → [burrito \| sour cream \| cheese]) | **F4**, **RF4** | `negatedInLine()`: apply the "opens its piece or follows with/but/and" guard only to the `no` entries, since a correction reading exists only for `no`. **Joins cloud-38 D6's row** (same guard: D6 is the `no` half, HELD), but the rationale differs and this half needs no NO_LEADS test. NOT the pinned refute row V20 (`… without the bun …` with item `the bun`, HELD below) |
| F5 | trailing-quantity fold (segment fold) | `pizza and a coke, 3 slices` / `two eggs and bacon, 3 strips` / `pizza and a coke, 2 of them` (the clause split off as its own item) | the fold declines (the target is not alone in its comma piece, the same "row 2" guard) and **passes the food-less item to the mapper**, which parses it as a food: `3 slices` → name `slices`, `3 strips` → `strips`, `2 of them` → `of them`. None matches the mapper's `UNIT_ONLY_PATTERN`, so each is a retrieval for a non-food. Control: `eggs, toast, 2 slices` → `2 slices of toast` | the clause never reaches the mapper as a food name (folded, or dropped as no food) | **NO-FIRE** (IDENTITY effect: a non-food item retrieved as a food; the records it would hit are unmeasured offline, no DB) | yes | ASSUMED (the header's shape A: "the segmenter emits the clause as its OWN segment") | **F5**, **RF5** | `foldTrailingQuantityClauses()` segment fold: a segment that `parseClause()` reads as food-less and that no guard lets fold is dropped with a receipt (fold kind `orphan`), the way the `topping` kind already drops a split-off spoon measure, instead of being returned as an item. Not a new word list: `parseClause` already decides "food-less". **Row candidate D** (owner C69). It also removes F3's `two` item, but not F3's under-bill |
| F6 | heuristic segmenter (`cleanFragment`) | `um eggs and uh toast` / `um eggs and uh toast and like um coffee` | items `um eggs`, `uh toast`, `like um coffee`; `parseIngredientLine` names them `um eggs`, `uh toast`, `like um coffee`. `LEADING_FILLER_RE` strips only and / also / then / plus / i had / had / ate | `eggs`, `toast`, `coffee` | **NO-FIRE** (IDENTITY effect on the retrieval query, unmeasured offline) | yes: the LLM-error path | **COMPUTED** | **F6** | `cleanFragment()`: also strip leading tokens in the `HESITATION` set #563 exports (no new list) before the filler loop. **Row candidate A, with F1** |
| F7 | trailing-quantity fold (gap fold `first`) | `leftover chili from last night, about 2 cups` / `pizza yesterday, 2 slices` / `oatmeal this morning, about a cup` / `pasta tonight, 2 bowls, and a salad` (also `cereal earlier, 2 bowls`, `rice at noon, maybe 2 cups`; the segmenter drops the clause) | unchanged: the default serving. The gap fold takes the first non-skip comma group after the item as THE clause. Here that group is the rest of the item's own piece (`from last night`, `yesterday`, `this morning`), which does not parse, so the real clause in the next piece is never read. Only `for\|at\|as <meal>` is skipped (`FRAME_WORDS` × `MEAL_WORDS`). Controls: `rice for dinner, maybe 2 cups` and `rice, maybe 2 cups` → `2 cups of rice`; the segment shape (`about a cup` split off) folds | `2 cups of (leftover) chili` / `2 slices of pizza` / `1 cup of oatmeal` / `2 bowls of pasta` | **NO-FIRE** (PORTION effect: 2× wherever the default serving is one cup / one slice / one bowl) | yes | ASSUMED (stock-consumed.json CHIPS shape: a one-item split, clause dropped) | **F7**, **RF7** | `foldTrailingQuantityClauses()` gap fold, `first`: when the first group is the remainder of item t's OWN comma piece and does not parse as a clause, skip it and read the next group, the rule dish-part-drop's header already states for its own scan ("words after an item … never count"). Not the HELD `drank half last night` / `had 2 later`: there the time word comes AFTER the clause. **Row candidate E** (owner C69) |

**Class counts: INTEGRATION-RED 0 · VANISH 1 (F1, with IDENTITY rows in the same mechanism) · IDENTITY 0 standalone · PORTION 2 (F2, F3) · NO-FIRE 4 (F4, F5, F6, F7) · NOISE 0. 7 findings, 14 failing reproductions (7 unit + 7 route; F1 has two route tests).**

**Row candidates (one per mechanism):** A = F1 + F6 (`heuristic-segmenter.ts`: `&` split and fragment hygiene); B = F2 (gap-fold target for a named clause); C = F3 (self-correction qty kind after an `and`-joined item); D = F5 (drop a declined food-less segment); E = F7 (gap-fold `first` skips the item's own piece tail); F4 joins cloud-38 D6's open row (`negatedInLine` guard scope). None needs a word list grown by one entry. F3 and F5 interact (F5's drop removes F3's orphan item); land C first, or both together.

## Held (known, measured here, not counted)
- **Food-named stock clauses** (trailing-quantity-fold STOCK named miss "food-named counts (`ate 20 chips` in some shapes)"): `2 beers, had 1 beer` → `2 beers` (while `2 beers, had 1` → `1 beers`); `6 eggs, had 2 eggs` → `6 eggs`; `a bag of chips, ate half the chips` → the whole bag (while `…, ate half` → `1/2 bag of chips`); the brief's two-food lines `a bag of chips and a coke, ate half the chips`, `a bottle of wine and some cheese, drank half the wine` and `6 wings and 2 beers, had 1 beer` (with or without a split-off `1 beer` item, which bills 3 beers) inherit this. A fraction naming the food is the same family as the named count, so I did not count it. If it is ever un-named, F2's fix covers the multi-item half.
- **Multi-item UNNAMED clauses** (partial-eat named miss; the stock gap paths say "on a one-item line only"): `a 6 pack of beer and a pizza, drank 2`, `a dozen donuts and a coffee, ate 2`, `a 12 pack of beer and chips, drank 4`, `3 tacos and a burrito, ate 2`, `a coke and a bag of chips, ate half`, `a pizza and a salad, i gave half to my friend`, `a sandwich and chips, half`.
- **Fold ambiguity guard** (aloneInPiece, header FALSE-POSITIVE CLASS): `pizza and wings, 2 slices`, `chicken and rice, about 2 cups` (gap shape) bill both at default. F5 is only about the orphan item when the clause is split off.
- **Non-leading pour** (`loose-measures.ts` Known gaps): `a splash of syrup on pancakes and a splash of milk in coffee` → the second `milk` bills a default serving.
- **cloud-38 D6** (`<host> no <part>` comma-less): open, HELD. **Refute pin V20/V20b** (`negated-part-removals.json`): `a burger without the bun and fries` with the item `the bun` keeps `the bun`, pinned by the seat. A bare `bun` with `the` between it and the negator is the same pin family, not counted.
- **Partial-eat target shape** (header: the target must read `a|an|one X`): `a sandwich and fries, i gave half the fries to my kid` → fries whole.
- **Dish drop default-keep posture / class table** (Option A): `pasta i made with olive oil and garlic` and `homemade soup with chicken and noodles` keep the parts with bare-split items (no class for pasta / soup); `homemade chili with beans and cornbread` keeps beans; `a smoothie i made with banana, spinach and protein powder` keeps the powder; `a burrito with rice, beans and chicken, and chips` keeps every part (no `homemade` / `made with`, out of trigger by design). Only a class-table entry would change these, which the brief rules out as a fix.
- **`hold the mayo and cheese`**: the `and` part (`cheese`) is billed. The header limits inheritance to `or` / `nor`, because `and` also joins the next food (`no onions and fries`).
- **Short path by design** (the brief's separator rule): `a coffee then a bagel` is one item, `a coffee then a bagel`.
- **cloud-43 F2**: decimal / thousands comma, both halves. `2+ eggs and toast` (heuristic) → `eggs`, `toast`: the `2` is lost with the `+` split. That is F1's `+` mechanism on a quantity, so F1's fix covers it. Not counted separately.
- **C69's local wine row**: `a bottle of wine, um, drank half` is not re-run.

## Inputs I expected to break that HELD (segmented path unless marked)
- **Corrections across items:** `2 eggs and toast, actually 3 eggs` → `3 eggs`, `toast`; `a latte, no wait, a cappuccino, and a scone` → `a cappuccino`, `a scone`; `a coffee and a muffin, wait no, a croissant` → `a coffee`, `a croissant`; `3 tacos and rice, sorry, 2 tacos` → `2 tacos`, `rice`; `a burger and fries, make that onion rings` → `a burger`, `onion rings`; `2 eggs, toast, and a coffee, actually make that 3 eggs`; `a bagel and coffee, no wait, tea` → `a bagel`, `tea`; `2 eggs and 2 toast, 3 eggs actually` → `2 toast`, `3 eggs`; `toast, and 2 eggs, actually 3` → `3 eggs`.
- **Hesitations (LLM split):** `a bagel, um, and like a coffee`, `a coffee, uh, i think a muffin` (both kept, no swap); `oatmeal, like, a cup, and a banana` → `1 cup of oatmeal`; `a sandwich, um, two of them, and chips` → `2 sandwich`; `a coffee, um, a muffin, uh, actually 2 muffins` → `2 muffin`.
- **Provenance and meal frames:** `leftover pizza from last night for lunch and a salad for dinner`; `leftover chili from yesterday, about a cup, and crackers` → `1 cup of leftover chili` (clause split off); `a burrito from chipotle for lunch and chips` → both under chipotle; `coffee for breakfast, a salad for lunch, and pasta for dinner`; `pizza from last night, 2 slices, and a coke` → `2 slices of pizza`; `a burger for lunch, 2 of them, and fries` → `2 burger`; `a sandwich for lunch, half, and a coke` → `1/2 sandwich`; `pizza for dinner, 2 slices, then ice cream`; `oatmeal this morning, about a cup, and coffee` (segment shape) → `1 cup of oatmeal`; `rice for dinner, maybe 2 cups` / `rice at dinner, maybe 2 cups` → `2 cups of rice`.
- **Removals:** `a burger, hold the onions, and fries` (with the split item `hold the onions` or `onions`); `a pizza with no cheese and a coke`; `a burger, minus the bun, and fries` (item `minus the bun`); `a burrito with everything but the beans and a coke`.
- **Dish + parts:** `a homemade burrito with rice and beans, and chips` → burrito, chips; `a burrito i made with rice and beans, plus a coke` / `…, and a coke`; `i made a sandwich with turkey and cheese, and had chips`; `a homemade pizza with pepperoni and a salad with ranch` (ranch kept with the salad); `a homemade burrito with rice and beans and guac on the side` (guac kept); `homemade fried rice with eggs and peas, and orange chicken`; `a homemade sandwich with ham and cheese and soup`.
- **Echoes (new shapes; all dropped correctly):** the second and third parts of a `with` list (`a coffee with milk and sugar` + `milk` + `sugar`; `pancakes with syrup and butter`; `a bagel with cream cheese and lox`; `a burger with cheese and bacon`; `oatmeal with berries and honey`; `a hot dog with ketchup and mustard plus chips`; a comma list `a burrito bowl with rice, beans, and chicken`); `w/` (`a salad w/ chicken`); `topped with`; a modified part (`with grilled chicken` + `grilled chicken`); a host joined by `and` (`chicken and rice with broccoli` + `broccoli`).
- **Pours and toppings:** `cereal with milk and a banana` (both splits); `toast with butter and jam and coffee`; `a splash of milk in my coffee and a muffin` (the bare `milk` split restored to `a splash of milk`); `coffee with a splash of milk and a bagel`; `a drizzle of honey on oatmeal and a coffee`; `a latte with oat milk and a croissant` (milk folded); `… and a croissant with butter`; `a pat of butter on toast and eggs`.
- **Counts and doses:** `a protein shake with 2 scoops and a banana, then another shake` → `2 scoops of protein powder`, banana, `another shake`; `a whey shake with 2 scoops in almond milk and a banana` → powder + `almond milk` + banana; `wings, 6 of them, and 2 beers` → `6 wings`; `wings and beer, 6 wings` → `6 wings`, `beer`; `2 scoops of protein in milk and an apple` (milk kept: it is drunk).
- **Wrong binding:** `half a sandwich and chips` (the half stays on the sandwich); `a cup of rice and beans`; `eggs, toast, 2 slices` → `2 slices of toast`.
- **Separators (heuristic, COMPUTED):** `eggs; toast; coffee`; `chicken/rice and beans` (no slash split); `chips + salsa and a beer`; `hot n spicy chips + a coke`; `chips and salsa and a beer` (atomic phrase kept); `a dr. pepper, and fries`.

## Not reached (time box)
- Shapes 5, 7 and 12 got the most lines; shape 11 got about 14 and shape 9 about 10. I did not run single-PR controls at earlier refs (every finding's mechanism is shown by a passing control on `5062cff7` instead). I did not measure the mapper's retrieval for F5's / F6's phantom names (no DB). I did not attack `extra-portion` beyond the shapes the other passes produce, `fillRestaurantBrand` beyond `4c`, or the stream wire.

## Reproductions (verbatim scratch files; each test asserts the CORRECT outcome, so a FAIL is the finding)

Unit preamble `src/lib/__cloud44__/pre.ts` (cloud-40's `chain()` plus `fillRestaurantBrand`, in `runParse()` order; `heur()` is the COMPUTED heuristic split; `shortPath()` copies `singleItemFromText()`'s condition):

```ts
import { restoreLeadingPour, isPourOntoSecondFood } from '@/lib/parse/loose-measures';
import { resolveSelfCorrections } from '@/lib/nlp/self-correction';
import { dropNegatedParts } from '@/lib/nlp/negated-part-drop';
import { dropDishParts, readMadeWithHeads } from '@/lib/nlp/dish-part-drop';
import { foldDrinkMilk } from '@/lib/nlp/drink-milk-fold';
import { rewriteExtraPortions } from '@/lib/nlp/extra-portion';
import { dropSegmenterEchoes } from '@/lib/nlp/segmenter-echo-drop';
import { foldTrailingQuantityClauses } from '@/lib/nlp/trailing-quantity-fold';
import { fillRestaurantBrand } from '@/lib/nlp/restaurant-brand-fill';
import { canonicalizeSegLine } from '@/lib/nlp/seg-line-key';
import { forceSegmentText } from '@/lib/nlp/heuristic-segmenter';
export type It = { rawText: string; normalizedForm: string; brand: string };
const LEAD = /^(?:(?:a|an|the|some|\d+(?:\.\d+)?|one|two|three|four|five|six)\s+)+/i;
export const s = (r: string, n = r.replace(LEAD, ''), brand = ''): It => ({ rawText: r, normalizedForm: n, brand });
// runParse() order on 5062cff7: pour -> correction -> negated -> dish -> drink -> extra-portion -> echo -> made-with head -> fold -> brand fill
export function chainItems(line: string, items: It[]): It[] {
  const k = canonicalizeSegLine(line);
  let x = restoreLeadingPour(k, items).items;
  x = resolveSelfCorrections(k, x).items; x = dropNegatedParts(k, x).items; x = dropDishParts(k, x).items; x = foldDrinkMilk(k, x).items;
  x = rewriteExtraPortions(k, x).items; x = dropSegmenterEchoes(k, x).items; x = readMadeWithHeads(k, x).items;
  x = foldTrailingQuantityClauses(k, x).items;
  return fillRestaurantBrand(x).items;
}
export const chain = (line: string, items: It[]): string[] => chainItems(line, items).map(i => i.rawText);
export const heur = (line: string): It[] => forceSegmentText(line).map(i => ({ rawText: i.rawText, normalizedForm: i.normalizedForm, brand: i.brand }));
// singleItemFromText()'s short-path condition, copied from route.ts:53-71
const MEAL_SUFFIX = /\s*(?:for|at|as)\s+(breakfast|lunch|dinner|snacks?)\s*\.?\s*$/i;
const MULTI = /[,;\n+&]|\b(?:and|with|plus)\b/i;
export function shortPath(text: string): boolean {
  const t = text.trim(); if (!t || t.length > 60) return false;
  const m = t.match(MEAL_SUFFIX); const r = m ? t.slice(0, m.index).trim() : t;
  if (!r || MULTI.test(r) || isPourOntoSecondFood(r)) return false;
  return r.split(/\s+/).length <= 6;
}
```

Unit tests `src/lib/__cloud44__/repro.test.ts` (F1–F7):

```ts
// cloud-44 reproductions (unit, through chainItems() in runParse() order). Each asserts the CORRECT outcome, so a FAIL is the finding.
import { chain, heur, s } from './pre';

test('F1 heuristic split: `&` inside a word or an `and`-phrase spelled with `&` is not a list separator (forceSegmentText)', () => {
  expect(chain('half & half in coffee and a bagel', heur('half & half in coffee and a bagel'))).toEqual(['half & half in coffee', 'a bagel']);
  expect(chain('mac & cheese and a coke', heur('mac & cheese and a coke'))).toEqual(['mac & cheese', 'a coke']);
  expect(chain('m&ms and a coke', heur('m&ms and a coke'))).toEqual(['m&ms', 'a coke']);
  expect(chain('a&w root beer and fries', heur('a&w root beer and fries'))).toEqual(['a&w root beer', 'fries']);
});

test('F2 a trailing clause that NAMES an earlier item reaches that item (the gap fold tries only the item right before the clause)', () => {
  expect(chain('a pizza and a coke, i gave half the pizza to my friend', [s('a pizza'), s('a coke')])).toEqual(['1/2 pizza', 'a coke']);
  expect(chain('a burrito and a coke, only ate half the burrito', [s('a burrito'), s('a coke')])).toEqual(['1/2 burrito', 'a coke']);
  expect(chain('a sandwich and chips, i gave half the sandwich to my son', [s('a sandwich'), s('chips')])).toEqual(['1/2 sandwich', 'chips']);
});

test('F3 a quantity-only correction after an `and`-joined item corrects it (self-correction qty kind: `alone in its comma piece`)', () => {
  expect(chain('a coffee and a donut, actually make that two', [s('a coffee'), s('a donut'), s('two', '')])).toEqual(['a coffee', '2 donut']);
  expect(chain('a coffee and 1 donut, make that 3', [s('a coffee'), s('1 donut'), s('3', '')])).toEqual(['a coffee', '3 donut']);
  expect(chain('toast and 2 eggs, no wait, 3', [s('toast'), s('2 eggs'), s('3', '')])).toEqual(['toast', '3 eggs']);
});

test('F4 a part right after `without` / `minus` in the host\'s comma piece is a removal, not a `no`-correction (negatedInLine)', () => {
  expect(chain('a salad without dressing and a coke', [s('a salad'), s('dressing'), s('a coke')])).toEqual(['a salad', 'a coke']);
  expect(chain('a burrito without beans, and chips', [s('a burrito'), s('beans'), s('chips')])).toEqual(['a burrito', 'chips']);
  expect(chain('tacos minus sour cream, and a margarita', [s('tacos'), s('sour cream'), s('a margarita')])).toEqual(['tacos', 'a margarita']);
});

test('F5 a food-less count segment the fold declines never reaches the mapper as a food name', () => {
  const left = (line: string, split: ReturnType<typeof s>[]) => chain(line, split).filter(r => /^\d+ (slices|strips|of them)$/.test(r));
  expect(left('pizza and a coke, 3 slices', [s('pizza'), s('a coke'), s('3 slices', '')])).toEqual([]);
  expect(left('two eggs and bacon, 3 strips', [s('two eggs', 'eggs'), s('bacon'), s('3 strips', '')])).toEqual([]);
  expect(left('pizza and a coke, 2 of them', [s('pizza'), s('a coke'), s('2 of them', '')])).toEqual([]);
});

test('F6 heuristic split: a leading hesitation word is not part of the food name (forceSegmentText)', () => {
  expect(chain('um eggs and uh toast', heur('um eggs and uh toast'))).toEqual(['eggs', 'toast']);
});

test('F7 a time / provenance tail inside the item\'s own comma piece does not hide the clause in the next piece (gap fold `first`)', () => {
  expect(chain('chili from last night, about 2 cups', [s('chili')])).toEqual(['2 cups of chili']);
  expect(chain('pizza yesterday, 2 slices', [s('pizza')])).toEqual(['2 slices of pizza']);
  expect(chain('oatmeal this morning, about a cup', [s('oatmeal')])).toEqual(['1 cup of oatmeal']);
  expect(chain('pasta tonight, 2 bowls, and a salad', [s('pasta'), s('a salad')])).toEqual(['2 bowls of pasta', 'a salad']);
});
```

Route tests `src/lib/__cloud44__/route-repro.test.ts` (cloud-38's header and mocks, plus `llmDown()` for the heuristic path and a `console.error` spy):

```ts
// cloud-44 route reproductions: header and mocks are cloud-38's route-repro.test.ts (route.stock-consumed.test.ts's). Each asserts the CORRECT outcome.
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/nlp/parse/route';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => ({ auth: { getUser: jest.fn() } })) }));
jest.mock('@/lib/db', () => ({
  prisma: {
    nlpRequestLog: { count: jest.fn(), create: jest.fn(), deleteMany: jest.fn(async () => ({ count: 0 })) },
    mappingEventLog: { createMany: jest.fn() },
    segmentationCache: { findUnique: jest.fn(), update: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
  },
}));
jest.mock('@/lib/ai/structured-client', () => ({ callStructuredLlm: jest.fn() }));
jest.mock('@/lib/mapping/map-ingredient-with-fallback', () => ({ mapIngredientWithFallback: jest.fn(async () => ({ status: 'no_match' })) }));
jest.mock('@/lib/nlp/resolve-payload', () => ({ resolveFoodDetails: jest.fn() }));

type Seg = { rawText: string; mealType: string; brand: string; normalizedForm: string };
const seg = (rawText: string, normalizedForm = rawText.replace(/^(a|an|the|some)\s+/i, '')): Seg => ({ rawText, mealType: 'lunch', brand: '', normalizedForm });
const req = (text: string) => new NextRequest('http://localhost:3000/api/nlp/parse', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' }, body: JSON.stringify({ text }) });

describe('cloud-44 route reproductions', () => {
  const { prisma } = require('@/lib/db');
  const { callStructuredLlm } = require('@/lib/ai/structured-client');
  const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
  const { logger } = require('@/lib/logger');
  const mapped = (): string[] => mapIngredientWithFallback.mock.calls.map((c: unknown[]) => c[0] as string);
  const llm = (items: Seg[]) => callStructuredLlm.mockResolvedValue({ status: 'success', content: { items }, provider: 'openrouter', model: 'openai/gpt-4o-mini' });
  const llmDown = () => callStructuredLlm.mockResolvedValue({ status: 'error', error: 'timeout', provider: 'openrouter', model: 'openai/gpt-4o-mini' });
  let spies: jest.SpyInstance[] = [];
  beforeAll(() => { process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass'; delete process.env.MAPPING_EVENT_LOG_ENABLED; });
  beforeEach(() => {
    jest.clearAllMocks();
    spies = [jest.spyOn(logger, 'info').mockImplementation(() => undefined), jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined), jest.spyOn(console, 'error').mockImplementation(() => undefined)];
    prisma.segmentationCache.findUnique.mockResolvedValue(null);
    prisma.segmentationCache.upsert.mockResolvedValue({});
    prisma.mappingEventLog.createMany.mockResolvedValue({ count: 0 });
  });
  afterEach(() => { for (const x of spies) x.mockRestore(); });

  test('RF1 LLM down -> heuristic: `half & half in coffee and a bagel` keeps the creamer (COMPUTED split)', async () => {
    llmDown();
    await POST(req('half & half in coffee and a bagel'));
    expect(mapped()).toEqual(['half & half in coffee', 'a bagel']);
  });

  test('RF1b LLM down -> heuristic: `mac & cheese and a coke` keeps the dish (COMPUTED split)', async () => {
    llmDown();
    await POST(req('mac & cheese and a coke'));
    expect(mapped()).toEqual(['mac & cheese', 'a coke']);
  });

  test('RF2 named clause after a later item: `i gave half the pizza` halves the pizza (ASSUMED split, partial-eat.json shape)', async () => {
    llm([seg('a pizza'), seg('a coke')]);
    await POST(req('a pizza and a coke, i gave half the pizza to my friend'));
    expect(mapped()).toEqual(['1/2 pizza', 'a coke']);
  });

  test('RF3 qty correction after an `and`-joined item: `make that two` bills two donuts (ASSUMED split)', async () => {
    llm([seg('a coffee'), seg('a donut'), seg('two', '')]);
    await POST(req('a coffee and a donut, actually make that two'));
    expect(mapped()).toEqual(['a coffee', '2 donut']);
  });

  test('RF4 `without` after the host: the dressing is not billed (ASSUMED split, negated-part-removals.json bare-part shape)', async () => {
    llm([seg('a salad'), seg('dressing'), seg('a coke')]);
    await POST(req('a salad without dressing and a coke'));
    expect(mapped()).toEqual(['a salad', 'a coke']);
  });

  test('RF5 a declined food-less count segment never reaches the mapper (ASSUMED split, shape A)', async () => {
    llm([seg('pizza'), seg('a coke'), seg('3 slices', '')]);
    await POST(req('pizza and a coke, 3 slices'));
    expect(mapped()).not.toContain('3 slices');
  });
  test('RF7 provenance tail before a dropped clause: `chili from last night, about 2 cups` folds (ASSUMED one-item split, stock-consumed.json CHIPS shape)', async () => {
    llm([seg('leftover chili', 'chili')]);
    await POST(req('leftover chili from last night, about 2 cups'));
    expect(mapped()).toEqual(['2 cups of leftover chili']);
  });
});
```

## Commands run (exits)
Jest env everywhere: `env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="postgresql://x:y@localhost:5432/z" npx jest <path> > <log> 2>&1; echo "exit=$?"`.

| # | command | exit / result |
|---|---|---|
| 1 | `[ "$(git rev-parse --is-shallow-repository)" = true ] && git fetch --unshallow origin \|\| true` | 0 |
| 2 | `git fetch origin +refs/heads/master:refs/remotes/origin/master` | 0 |
| 3 | `git merge-base --is-ancestor 5062cff7 origin/master` | 0 |
| 4 | `git checkout -b sweep-nlp 5062cff7` | 0 |
| 5 | `npm ci` | 0 |
| 6 | `npx jest --ci --testPathIgnorePatterns /node_modules/ src/ops/curated/__tests__/seed-curated.test.ts > full.log` | exit=0: 382/382 suites, 9,878 passed + 1 skipped |
| 7 | `git fetch origin <b>:refs/remotes/origin/<b>` for the 4 predecessor branches; `git show …:reports/…` | 0 |
| 8 | probes `probe1` … `probe9` (print-only) under `src/lib/__cloud44__/` | exit 0 each |
| 9 | `npx jest src/lib/__cloud44__/repro.test.ts` | exit=1: 7 failed (F1–F7) |
| 10 | `npx jest src/lib/__cloud44__/route-repro.test.ts` | exit=1: 7 failed (RF1, RF1b, RF2, RF3, RF4, RF5, RF7) |
| 11 | `rm -rf src/lib/__cloud44__`; `git checkout -b cloud/sweep-nlp-route-5062cff7 origin/master`; `git add reports/2026-10-20_cloud-sweep-nlp-route-5062cff7.md` (by path); `git commit -F <file outside the checkout>` | 0 |
