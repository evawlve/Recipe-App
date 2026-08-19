# Partitive-`of` forked `FoodMapping` keys — eviction plan

**Status: PLAN ONLY. Nothing here has been executed. No row was written, repointed or
evicted while producing it.** Every figure below came from read-only `SELECT`s
(reproduced verbatim under [Method](#method)). Executing the plan needs its own
authorization and its own PR.

Companion to `fix/partitive-of-and-leading-article`
(`src/lib/parse/ingredient-line.ts`, `src/lib/parse/__tests__/partitive-of-in-name.test.ts`).

> **Re-cut 2026-08-19.** Every number below was re-derived against the live box; the
> 2026-08-18 figures did not survive. Four corrections, each with the measurement behind it:
>
> 1. **35 → 31 rows** matching the shape, and all four class subtotals re-derived — not just
>    the top line. Thirty of the doc's original 35 rows survive; the 31st is a same-key
>    re-creation. See [Totals](#totals).
> 2. **`garlic of` and `firm of tofu` are NOT dead keys** and are pulled out of the batch.
>    They are live output of the free-text path, which never calls the parser, so #350 could
>    not have closed them and eviction will not stop them regenerating. New
>    [section S](#s-not-orphaned--live-output-of-the-free-text-path-do-not-evict-2-rows).
> 3. **`oat of rolled`'s section-A entry was wrong** — but not because its target is dead.
>    The target `oat rolled` is the most-used oat key in the cache. See
>    [line note under section A](#a-orphaned--evict-16-rows).
> 4. **Section C's "all nine were verified" is false.** Six of nine were verified; three were
>    asserted, and the doc's stated method *cannot* verify them. None of the nine is orphaned
>    by #350 — measured on both trees. See [section C](#c-retained--the-of-is-part-of-the-foods-name-do-not-evict-9-rows).
>
> The plan is now **evict-only**: plain `_evict_rows.ts`, no `usedCount` fold, no
> `apply-repoints.ts`. See [Suggested execution order](#suggested-execution-order-when-authorized).

## Why these keys exist

`parseIngredientLine()` consumed the unit token at several independent sites and only
two of them skipped the partitive `of` that follows it, so `3 slices of bacon` came back
as `name: 'of bacon'`. That name is the mapper's search term *and* its cache key:

- `preflightIngredientLine()` (`src/lib/mapping/map-ingredient-with-fallback.ts:627`)
  sets `baseName = options.normalizedForm?.trim() || parsed?.name?.trim() || preProcessLine`;
- `canonicalizeCacheKey()` (`src/lib/mapping/normalization-rules.ts:842`) lowercases,
  singularises, **sorts** and joins with **no stopword list**, so `of bacon` becomes the
  key `bacon of` — a different `FoodMapping` row from `bacon`.

The fork is not just a duplicate row, it is a *worse* row: the leaked token changes what
the retrieval saw, so the two keys can hold different foods. `bacon of` holds
"Premium cuts of bacon jerky" where `bacon` holds "Bacon"; `of pizza` holds
"Taste Of Tuscany Pizza **Sauce**" where `pizza` holds "Pizza".

~~Snapshot taken 2026-08-18. `FoodMapping` held 4,762 rows; 35 matched the bare-`of` shape.~~

**Re-derived 2026-08-19 17:35Z with the §Method query.** `FoodMapping` holds **4,758 rows**;
**31** match the bare-`of` shape, Σ `usedCount` **308** (305 at the 09:40 PDT screen snapshot;
the delta is live traffic, not a re-cut). The population is not stable — do not reuse these.

## Why the count moved 35 → 31, and where the 5-row delta went

Five of the doc's original 35 rows no longer exist. One key was then *re-created* under the
same name, which is why the query returns 31 and not 30:

| gone row | doc class | note |
|---|---|---|
| `2 approximately cup of spinach` | A | deleted between 08-18 and 08-19 |
| `2 cup milk nearly of` | A | deleted between 08-18 and 08-19 |
| `milk of` | A | deleted between 08-18 and 08-19 |
| `a cup half maybe of rice` | D | deleted between 08-18 and 08-19 |
| `a cup of rice` (the 08-18 row) | D | deleted, then **re-created 2026-08-19 11:32:55Z** |

`a cup of rice` is a *different row* from the one this doc judged: `FoodMapping.createdAt` is
`@default(now())` and Prisma's upsert-update branch never touches it, so a `createdAt` of
2026-08-19 is proof of an `INSERT` today. Only two rows in the whole table carry that date
(`cereal some` and `a cup of rice`), both stamped 11:32:5xZ — the 08-19 nightly `flywheel-sweep`,
whose eval gate runs **warm** (`flywheel-sweep.ts:405-411`) and therefore writes `FoodMapping`.

So: **class A absorbed 3 of the 5, class D absorbed 2.** Classes B and C are untouched, still
3 and 9 rows. The whole-table arithmetic reconciles: 4,762 + 2 created − 6 deleted = 4,758.

## What the fix does and does not orphan

The fix removes an `of` **only when it directly follows a unit token the parser just
consumed** (or a leading article + unit). An `of` that is part of the food's own name is
never preceded by a consumed unit, so it is untouched. Verified by running each producing
line through the pre-fix and post-fix parser and canonicalising both:

| producing line | pre-fix key | post-fix key | |
|---|---|---|---|
| `3 cups of spinach` | `of spinach` | `spinach` | changed |
| `1 slice of pizza` | `of pizza` | `pizza` | changed |
| `2 cloves of garlic` | `garlic of` | `garlic` | changed |
| `a cup of brown rice` | `a brown cup of rice` | `brown rice` | changed |
| `amy's organic cream of tomato soup` | `amy cream of organic soup tomato` | `amy cream of organic soup tomato` | **same** |
| `campbells cream of mushroom soup` | `campbell cream mushroom of soup` | `campbell cream mushroom of soup` | **same** |
| `post honey bunches of oats rolled` | `bunch honey oat of post rolled` | `bunch honey oat of post rolled` | **same** |
| `wheat thins hint of salt` | `hint of salt thin wheat` | `hint of salt thin wheat` | **same** |
| `tostitos hint of lime` | `hint lime of tostito` | `hint lime of tostito` | **same** |
| `wendys son of baconator` | `baconator of son wendy` | `baconator of son wendy` | **same** |
| `half a cup of rice` | `a cup of rice` | `a cup of rice` | **same** (out of scope) |

**This table's method has a hole, and it is load-bearing (added 2026-08-19).** It measures
`canonicalizeCacheKey(parseIngredientLine(line).name)`. That is not the key the pipeline
writes, and on the free-text path it is not even an input:

- `preflightIngredientLine()` sets
  `baseName = options.normalizedForm?.trim() || parsed?.name?.trim() || preProcessLine`
  (`map-ingredient-with-fallback.ts:641`) — `normalizedForm` **wins**;
- `/api/nlp/parse` passes the LLM segmenter's `normalizedForm` straight through
  (`route.ts:341` reads `item.normalizedForm`, `route.ts:358` hands it to
  `mapIngredientWithFallback`), and `ai-segmenter.ts` has no partitive-`of` rule at all;
- the real key function is `deriveMappingCacheKey()` (`cache-key.ts:115`), which adds a
  brand-prefix step and an adjacent-duplicate-token collapse on top of `canonicalizeCacheKey`.

So a line whose key is authored by the model is untouched by a parser fix. Everything below
was re-measured on 2026-08-19 with the pre-fix and post-fix trees differing **only** in
`src/lib/parse/ingredient-line.ts` (`git checkout 7c74b53^ -- src/lib/parse/ingredient-line.ts`
over `master 9c78c79`), and keys derived with `deriveCacheKeyName` + the dup-collapse, not with
bare `canonicalizeCacheKey`.

## The keys

`used` is `FoodMapping.usedCount` at the 2026-08-19 16:40Z screen snapshot. The `target`
column is retained for context only — **the plan no longer repoints or folds**, it evicts,
so a target's existence is now just evidence that eviction is cheap (the next read is a
warm hit on the target instead of a cold resolve).

### A. Orphaned — evict (16 rows)

| forked key | holds | used | target (context only) | target used |
|---|---|---|---|---|
| `bacon of` | Premium cuts of bacon jerky (OFF) | 242 | `bacon` | 810 |
| `of rice white` | white medium-grain cooked unenriched rice (fdc) | 4 | `rice white` | 1639 |
| `a brown cup of rice` | brown rice (OFF) | 3 | `brown rice` | 851 |
| `cheese of swiss` | swiss cheese (fdc) | 3 | `cheese swiss` | 2 |
| `of rosemary` | Rosemary — Compliments (OFF) | 3 | `rosemary` | 2 |
| `of spinach` | Spinach (fatsecret, `fs_36577`) | 3 | `spinach` | see note |
| `a cup of rice white` | White Rice (fatsecret) | 2 | `rice white` | 1639 |
| `milk of whole` | Milk (fatsecret) | 2 | `milk whole` | 81 |
| `of pizza` | **Taste Of Tuscany Pizza Sauce** (OFF) | 2 | `pizza` | 10 |
| `of rice` | cooked wild rice (fdc) | 2 | `rice` | 6 |
| `of salmon` | Salmon (fatsecret) | 2 | `salmon` | 688 |
| `cheerio of` | Cheerios — General Mills (fatsecret) | 1 | `cheerio` | 80 |
| `cinnamon of` | Cinnamon (fatsecret) | 1 | `cinnamon` | 79 |
| `cooked of rice white` | cream of rice cooked with water with salt cereals (fdc) | 1 | `cooked rice white` | 316 |
| `gum of` | Gum — Simply Gum (fatsecret) | 1 | `gum` | 3 |
| `oat of rolled` | Rolled Oats — Red Mill (fatsecret) | 1 | `oat rolled` | 1708 |

Removed from this section since 2026-08-18: `2 approximately cup of spinach`,
`2 cup milk nearly of` and `milk of` **no longer exist** (deleted between the two snapshots);
`garlic of` and `firm of tofu` moved to [section S](#s-not-orphaned--live-output-of-the-free-text-path-do-not-evict-2-rows).

Two of these are **misroutes the fork caused**, not merely duplicates — the surviving row
holds a different (correct) food, so evicting also fixes the answer:

- `bacon of` → "Premium cuts of bacon jerky" vs `bacon` → "Bacon" (used 242 times);
- `of pizza` → "Taste Of Tuscany Pizza Sauce" vs `pizza` → "Pizza".

`cooked of rice white` is a third: it holds *cream of rice cereal* for what was white rice.

**`of spinach`'s target moved under us.** The `spinach` row this doc recorded at `usedCount`
343 was evicted and re-resolved on 2026-08-19 at 17:37Z (`createdAt` 2026-08-19 17:37:46Z,
now `fs_36577`, the same record `of spinach` holds). The two keys no longer disagree.

**`oat of rolled` — the 2026-08-18 entry was wrong, and not in the way it looks.** The target
`oat rolled` is emphatically *not* dead: it holds "Rolled Oats — Australian Creamy Style" (OFF)
at `usedCount` **1,708** (up from the 1,684 recorded here on 08-18) and `lastUsedAt`
**2026-08-19** — the most-used oat key in the cache. What is wrong is the *classification*:
`oat of rolled` is not orphaned by the parser fix. Measured, the free-text path still derives
it exactly:

```
rawLine "1 cup of rolled oats"  --ai-normalize-->  "of rolled rolled oats"
  deriveMappingCacheKey(...)   ->  "oat of rolled"      (MappingEventLog, 2026-08-18 16:21Z)
```

`ai-normalize` expands `oats` → `rolled oats` even when "rolled" is already present, and the
adjacent-dup collapse then folds `oat of rolled rolled` back to `oat of rolled`. On the
*parser* path the same line post-fix yields `oat rolled`, so the fix does help there — but
the free-text path is what actually produced this row. It is left in the evict list because
its one observed producing line is a probe, not organic traffic; it belongs to the same class
as section S and should be re-checked after Lane S lands.

### B. Orphaned — no target row exists yet (3 rows)

These become cold lookups on first post-deploy use. Nothing to merge into; evict only.

| forked key | holds | used | → target | note |
|---|---|---|---|---|
| `of sugar` | Sugar (fatsecret) | 2 | `sugar` | no row; will be resolved cold |
| `of pepperoni pizza two` | Pepperoni Pizza (OFF) | 5 | `pepperoni pizza two`? | **confirm before repointing** — see below |
| `can coke of` | Coke Regular 12 oz Can — Coca-Cola (fatsecret) | 2 | `can coke`? | **confirm before repointing** — see below |

`of pepperoni pizza two` and `can coke of` have no surviving `MappingEventLog.rawLine`, so
the producing line is unknown. Applying the token-removal rule mechanically gives
`pepperoni pizza two` and `can coke`, but neither exists, while `pepperoni pizza` (253)
and `coke` (563) both do — which is what those lines most likely canonicalise to once the
article/quantity also resolve. **Do not repoint these two blind.** Re-run the producing
shape through the post-fix parser first, or evict and let them resolve cold.

Also note `of water` does **not** appear: `1 cup of water` arrived at preflight as
`of water` and so missed the zero-calorie fast path — a whole-string
`ZERO_CALORIE_INGREDIENTS.includes(baseName)` test at
`map-ingredient-with-fallback.ts:837`. Post-fix it arrives as `water`, hits the fast path,
and never creates a `FoodMapping` row at all. There is nothing to repoint; the row simply
stops being created.

### S. NOT orphaned — live output of the free-text path. DO NOT EVICT (2 rows)

**Added 2026-08-19. These two were in section A and should never have been.** They are not
dead keys. Evicting them deletes a row that the pipeline will write again on the next hit,
so the eviction buys nothing and costs a cold resolve.

| forked key | holds | used | producing line | last organic hit |
|---|---|---|---|---|
| `garlic of` | raw garlic (`fdc_1104647`) | 8 | `100g garlic of` | 2026-08-12 20:13Z, `cacheHit:early` |
| `firm of tofu` | Firm Tofu (`off_9340111000027`) | 4 | `100g firm of tofu` | 2026-08-12 17:27Z, `cacheHit:early` |

**#350 could not have closed them — confirmed against the code, not assumed.**

1. **#350 edited exactly one source file.** `git show --stat 7c74b53` and
   `git diff --stat f3d2b3b^1 f3d2b3b` both list three paths and only one of them is source:
   `src/lib/parse/ingredient-line.ts`, plus its test and this document.
2. **The free-text path never uses that file's output for the name.**
   `preflightIngredientLine()` takes `options.normalizedForm` **first**:
   `let baseName = options.normalizedForm?.trim() || parsed?.name?.trim() || preProcessLine;`
   (`map-ingredient-with-fallback.ts:641`).
3. **`/api/nlp/parse` supplies that `normalizedForm` from the LLM segmenter, unaltered.**
   `route.ts:341` reads `const normalizedForm = item.normalizedForm;` off the segmented item
   and `route.ts:358` passes `normalizedForm: normalizedForm || undefined` into
   `mapIngredientWithFallback`. The route *does* also call `parseIngredientLine(rawText)`
   (`route.ts:343`) — but only for `qty`/`unit`, never for the name.
4. **`ai-segmenter.ts` has no partitive-`of` rule.** Its prompt legislates `and`-splitting and
   nothing else about `of`; there is no `of`-stripping code path in the file.
5. **Direct measurement closes it.** With the two trees differing only in
   `src/lib/parse/ingredient-line.ts`, both derive the identical key for these two lines:

   ```
   raw "100g garlic of"     normalizedForm "garlic of"     pre-fix "garlic of"     post-fix "garlic of"
   raw "100g firm of tofu"  normalizedForm "firm of tofu"  pre-fix "firm of tofu"  post-fix "firm of tofu"
   ```

   Note this holds even on the *parser* path: the `of` here is trailing, not sitting after a
   consumed unit token, so `consumePartitiveOf()` never fires on it either.

**What closes them is Lane S**, the prose-cache-key lane: normalize the segmenter's
`normalizedForm` through the same rules the parser uses *before* it becomes a cache key.
Until that ships, these two rows regenerate. Re-run this section after Lane S deploys; if
they stop reproducing, they can be evicted then, with a fresh screen.

### C. RETAINED — the `of` is part of the food's name. DO NOT EVICT (9 rows)

The fix does not change these keys; they are listed so a bulk `~ '(^|\s)of(\s|$)'` sweep
does not take them out.

~~All nine were verified byte-identical pre- and post-fix.~~ **That claim was false as
written (corrected 2026-08-19). Only six of the nine were ever run through both trees** —
the six with a row in the pre/post table above. Three were asserted:
`bunch honey oat of rolled`, `almond bunch honey oat of rolled` and `hanover of pretzel snyder`.

They have now been measured, and the finding is in two parts.

**(a) The verdict holds: none of the nine is orphaned by #350.** All nine keys are
byte-identical across the two trees, checked both with the doc's original
`canonicalizeCacheKey(parsed.name)` method and with the real `deriveCacheKeyName` +
dup-collapse derivation. Section C stays intact and stays *do not evict*.

**(b) The doc's stated method could never have verified those three, because their keys are
not authored by the parser.** Running the producing line through `parseIngredientLine()`
does not reach them:

| key | what actually produces it | what the parser produces |
|---|---|---|
| `bunch honey oat of rolled` | `honey bunches of oats` → ai-normalize → `honey bunches of rolled oats` | `bunch honey oat of` — **no `rolled`** |
| `almond bunch honey oat of rolled` | `honey bunches of oats almond` (seed, `data/seeds/fs-strong-batch1.json`) → ai-normalize | `almond bunch honey oat of` — **no `rolled`** |
| `hanover of pretzel snyder` | `snyders of hanover pretzels` → ai-normalize → `snyders of hanover hanover pretzels` | `hanover pretzel rod` — a **different key** |

The `rolled` token in the two Honey-Bunches keys is injected by `ai-normalize`, not by the
parser — confirmed verbatim in `MappingEventLog`
(`rawLine 'honey bunches of oats'` → `normalizedForm 'honey bunches of rolled oats'`, 6 events,
2026-07-21 through 2026-08-18) and in `AiNormalizeCache`. The doc's one HBO table row (line
"`post honey bunches of oats rolled`") tested a string no traffic ever produced; it happens to
land on the right key by accident of token-bag equality.

`hanover of pretzel snyder` is worse: fed the doc's implied line, `parseIngredientLine()`
consumes `snyder's` as a *measure word* (the pre-existing `cream of wheat` branch, pinned in
`partitive-of-in-name.test.ts`) and returns `hanover pretzel rod`. The real key needs the
brand prepended onto a base that already contains `hanover` — which only the model does.

All three were re-checked end-to-end through `deriveMappingCacheKey()` on `master 9c78c79`
with live brand detection, and all three reproduce their stored key exactly. They are alive,
not orphans.

| key | holds | used |
|---|---|---|
| `bunch honey oat of rolled` | Honey Bunches of Oats — Post (OFF) | 2 |
| `almond bunch honey oat of rolled` | Honey bunches of oats (almonds) — Post (OFF) | 1 |
| `bunch honey oat of post rolled` | Post, honey bunches of oats, granola, cinnamon (OFF) | 1 |
| `amy cream of organic soup tomato` | Cream Of Tomato Organic Soups — Amy's (OFF) | 1 |
| `campbell cream mushroom of soup` | Campbell's soup cream of mushroom (OFF) | 1 |
| `baconator of son wendy` | Son of Baconator — Wendy's (fatsecret) | 1 |
| `hanover of pretzel snyder` | Snyder's of hanover, pretzels rods (OFF) | 1 |
| `hint lime of tostito` | Hint of Lime Tortilla Chips — Tostitos (fatsecret) | 1 |
| `hint of salt thin wheat` | Wheat Thins hint of salt — Nabisco (OFF) | 1 |

### D. UNCHANGED by this fix — out of scope (1 row)

`half a cup of X` puts the article at token [1], and the article strip is positional
(token [0] only). `leading-hedge-strip.test.ts` already documents this as an unowned
limitation and this branch deliberately leaves it alone.

| key | holds | used | producing line |
|---|---|---|---|
| `a cup of rice` | cooked wild rice (fdc) | 1 | `half a cup of rice` ~ `maybe half a cup of rice` |

~~`a cup half maybe of rice`~~ **no longer exists** (deleted between the 08-18 and 08-19
snapshots). It was orphaned by the *already-shipped* leading-hedge strip, not by this change.

The surviving `a cup of rice` row is **not the row this doc judged** — `createdAt`
2026-08-19 11:32:55Z, re-created by the 08-19 nightly's warm eval gate. It still holds the
same food (cooked wild rice, fdc) and is still out of scope.

## Totals

Re-derived 2026-08-19 with the §Method query. `used` figures are the 16:40Z screen snapshot;
the live Σ has since drifted to 308 on traffic alone.

| class | rows | Σ usedCount |
|---|---|---|
| A. orphaned — **evict** | 16 | 273 |
| B. orphaned, no target / needs confirmation — **evict** | 3 | 9 |
| S. live free-text forks — **do not evict** | 2 | 12 |
| C. retained (lexical `of`) — **do not evict** | 9 | 10 |
| D. unchanged, out of scope — **do not evict** | 1 | 1 |
| **total matching `(^\|\s)of(\s\|$)`** | **31** | **305** |
| *of which, the evict list* | *19* | *282* |

Superseded 2026-08-18 figures, for the record: A 21 / 288, B 3 / 9, C 9 / 10, D 2 / 2,
total 35 / 309.

## Suggested execution order (when authorized)

**Evict-only.** No `usedCount` fold, no `apply-repoints.ts`. A fold was the 08-18 plan; it is
withdrawn because (a) three of the four largest section-A targets have moved or been
re-created since, so a fold would credit a row the screen never judged, and (b) the eviction's
whole value is that the next read resolves fresh — a folded counter on a stale target only
makes the wrong row look more trusted. The keys are section A + section B, **19 keys**, cut
into `scripts/eval/evict-partitive-2026-08-19.json`; sections S, C and D are excluded.

The five-step guarded procedure is unchanged (`_evict_rows.ts` header, `_snap_foodmapping.ts`,
`_restore_rows.ts`). The snapshot plays **two different roles** and feeding the wrong file to
the wrong flag silently voids the guard:

1. **Screen anchor (Role A).** `_snap_foodmapping.ts` → `S_screen`, taken when the screen /
   re-derivation above ran. This is the file the verdicts were issued *against*.
2. **Dry run.** `_evict_rows.ts <keys.json> --screen-snapshot S_screen` — **no `--execute`**.
   Read the refusals, not just the exit code.
3. **Fresh pre-execute snapshot (Role B).** `_snap_foodmapping.ts` → `S_fresh`, taken
   immediately before the execute. This is the restore anchor and must **never** be passed to
   `--screen-snapshot`.
4. **Execute.** `_evict_rows.ts <keys.json> --screen-snapshot S_screen --execute`.
5. **Rollback if needed.** `_restore_rows.ts S_fresh <keys.json> --execute`.

Then re-run the §Method query: only sections S, C and D should remain — **12 rows**.

**Step 2 was run on 2026-08-19 18:00Z and came back clean** (dry run only; `--execute` was
not passed and no row was touched):

```
snapshot   : 4758 rows, taken 2026-08-19T16:40:34.529Z
live       : 4758 rows
to evict   : 19 key(s), 19 currently present
identity   : all 19 key(s) verified unchanged since the snapshot
remaining  : 4739 rows after eviction
```

`FoodMapping-screen-2026-08-19.json` is the correct Role-A anchor: it was taken 1.3 h before
the run — comfortably past the script's `SUSPICIOUSLY_FRESH_MS` 15-minute tripwire, which
exists to catch an operator handing the Role-B file to `--screen-snapshot` — and it is the
snapshot this re-cut's class subtotals and evict list were derived from. Do **not** use
`FoodMapping-pre-execute-2026-08-19.json` here: that is the spinach lane's Role-B restore
anchor, taken at 17:36Z.

Two live hazards for step 2, both seen on 2026-08-19:

- The count guard is exact (`liveCount !== snap.count` refuses). Any concurrent lane that
  creates or deletes a row invalidates the anchor. On 08-19 the spinach lane deleted and
  re-created `spinach` inside the same hour; the count happened to return to 4,758, but that
  was luck, not a property.
- The identity guard refuses on *any* evict-list key whose `source`/`foodName`/`brandName`/
  `offBarcode`/`fdcId`/`fsId`/`validatedBy` moved since the anchor. It does **not** refuse on
  `usedCount`/`lastUsedAt` drift, which is why the Σ above moving 305 → 308 is harmless.

## Method

Read-only, run from this machine against the production replica:

```sh
ssh owner@192.168.1.133 'docker exec mealspire-db psql -U postgres -d mealspire -c "..."'
```

Forked-key list:

```sql
SELECT "normalizedForm", coalesce("brandName",'-'), "foodName", "source", "usedCount"
FROM "FoodMapping"
WHERE "normalizedForm" ~ '(^|\s)of(\s|$)'
ORDER BY "usedCount" DESC, "normalizedForm";
```

Producing lines (where the event log still has them):

```sql
SELECT m."normalizedForm", count(*), string_agg(DISTINCT e."rawLine", ' ~ ')
FROM "MappingEventLog" e
JOIN "FoodMapping" m ON m."normalizedForm" = e."normalizedForm"
WHERE m."normalizedForm" ~ '(^|\s)of(\s|$)'
GROUP BY 1 ORDER BY 2 DESC;
```

**This join misses most of them, and that is why section C went unverified for so long.**
`MappingEventLog.normalizedForm` is the *pre-canonical normalized name*, not the sorted cache
key — `honey bunches of rolled oats`, not `bunch honey oat of rolled`. Equality against
`FoodMapping.normalizedForm` therefore only matches keys that happen to be already-sorted
single-or-two-token strings. Search the raw text instead:

```sql
SELECT "createdAt", "rawLine", "normalizedForm", "cacheHit", "foodId", "noCache"
FROM "MappingEventLog"
WHERE "rawLine" ILIKE '%<token>%' OR "normalizedForm" ILIKE '%<token>%'
ORDER BY "createdAt";
```

Row age — the check that separates a surviving row from a same-key re-creation
(`createdAt` is `@default(now())`, so it only moves on `INSERT`):

```sql
SELECT "normalizedForm", "createdAt", "lastUsedAt", "usedCount"
FROM "FoodMapping" WHERE "normalizedForm" ~ '(^|\s)of(\s|$)'
ORDER BY "createdAt" DESC;
```

Pointer integrity (all 31 came back `ok` on 2026-08-19 — no dangling FKs):

```sql
SELECT m."normalizedForm",
       CASE WHEN m."offBarcode" IS NOT NULL AND o.barcode IS NULL THEN 'DANGLING-OFF'
            WHEN m."fdcId"      IS NOT NULL AND f."fdcId" IS NULL THEN 'DANGLING-FDC'
            WHEN m."fsId"       IS NOT NULL AND s."fsId"  IS NULL THEN 'DANGLING-FS'
            ELSE 'ok' END AS fk
FROM "FoodMapping" m
LEFT JOIN "OffFood" o       ON o.barcode = m."offBarcode"
LEFT JOIN "FdcFood" f       ON f."fdcId" = m."fdcId"
LEFT JOIN "FatSecretFood" s ON s."fsId"  = m."fsId"
WHERE m."normalizedForm" ~ '(^|\s)of(\s|$)' ORDER BY 1;
```

Target existence:

```sql
SELECT "normalizedForm", "usedCount" FROM "FoodMapping"
WHERE "normalizedForm" IN ('bacon','garlic','spinach','rice white','brown rice', ...);
```

The pre/post-fix key columns were produced locally by running each line through
`parseIngredientLine()` on both trees and passing `parsed.name` to
`canonicalizeCacheKey()`. No DB access, no writes.

**The 2026-08-19 re-measurement used a stricter setup.** Two worktrees off `master 9c78c79`,
differing in exactly one file, so any key difference is attributable to #350 alone:

```sh
git worktree add --detach <wt-postfix> master
git worktree add --detach <wt-prefix>  master
git -C <wt-prefix> checkout 7c74b53^ -- src/lib/parse/ingredient-line.ts   # only diff
```

Keys were derived two ways and compared:

- `canonicalizeCacheKey(parseIngredientLine(line).name)` — the doc's original method, kept so
  the 08-18 table stays reproducible;
- `collapseAdjacentDuplicateTokens(canonicalizeCacheKey(deriveCacheKeyName(normalizedName, parsed)))`
  — the pipeline's real derivation, imported from `cache-key-core.ts` on purpose: that module
  is import-leaf, so the probe does not pull in `simple-rerank → config.ts` and cannot turn a
  read-only run into one that spends FatSecret quota. The brand-prefix half was checked
  separately through the full `deriveMappingCacheKey()` with live `detectBrandInQuery()`.

Key reachability was also checked for all 31 rows — every one is canonical
(`canonicalizeCacheKey(k) === k`) and none is malformed (`isMalformedCacheKey`), so no row in
this set is a permanently-unreachable zombie. No DB access, no writes.
