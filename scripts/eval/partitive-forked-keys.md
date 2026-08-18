# Partitive-`of` forked `FoodMapping` keys — repoint / eviction plan

**Status: PLAN ONLY. Nothing here has been executed. No row was written, repointed or
evicted while producing it.** Every figure below came from read-only `SELECT`s
(reproduced verbatim under [Method](#method)). Executing the plan needs its own
authorization and its own PR.

Companion to `fix/partitive-of-and-leading-article`
(`src/lib/parse/ingredient-line.ts`, `src/lib/parse/__tests__/partitive-of-in-name.test.ts`).

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

Snapshot taken 2026-08-18. `FoodMapping` held 4,762 rows; 35 matched the bare-`of` shape.

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

## The keys

`used` is `FoodMapping.usedCount` at snapshot time. `target used` is the existing row the
key should merge into — where one already exists, this is a **merge**, not a rename.

### A. Orphaned — repoint to an existing target (21 rows)

| forked key | holds | used | → target | target used |
|---|---|---|---|---|
| `bacon of` | Premium cuts of bacon jerky (OFF) | 242 | `bacon` | 805 |
| `garlic of` | raw garlic (fdc) | 8 | `garlic` | 73 |
| `firm of tofu` | Firm Tofu (OFF) | 4 | `firm tofu` | 1 |
| `of rice white` | white medium-grain cooked unenriched rice (fdc) | 4 | `rice white` | 1626 |
| `a brown cup of rice` | brown rice (OFF) | 3 | `brown rice` | 846 |
| `cheese of swiss` | swiss cheese (fdc) | 3 | `cheese swiss` | 2 |
| `of rosemary` | Rosemary — Compliments (OFF) | 3 | `rosemary` | 2 |
| `of spinach` | Spinach (fatsecret) | 3 | `spinach` | 343 |
| `a cup of rice white` | White Rice (fatsecret) | 2 | `rice white` | 1626 |
| `milk of whole` | Milk (fatsecret) | 2 | `milk whole` | 79 |
| `of pizza` | **Taste Of Tuscany Pizza Sauce** (OFF) | 2 | `pizza` | 10 |
| `of rice` | cooked wild rice (fdc) | 2 | `rice` | 3 |
| `of salmon` | Salmon (fatsecret) | 2 | `salmon` | 684 |
| `2 approximately cup of spinach` | Spinach (OFF) | 1 | `spinach` | 343 |
| `2 cup milk nearly of` | Milk (fatsecret) | 1 | `milk` | 503 |
| `cheerio of` | Cheerios — General Mills (fatsecret) | 1 | `cheerio` | 78 |
| `cinnamon of` | Cinnamon (fatsecret) | 1 | `cinnamon` | 78 |
| `cooked of rice white` | cream of rice cooked with water with salt cereals (fdc) | 1 | `cooked rice white` | 313 |
| `gum of` | Gum — Simply Gum (fatsecret) | 1 | `gum` | 3 |
| `milk of` | Milk (fatsecret) | 1 | `milk` | 503 |
| `oat of rolled` | Rolled Oats — Red Mill (fatsecret) | 1 | `oat rolled` | 1684 |

Two of these are **misroutes the fork caused**, not merely duplicates — the target row
holds a different (correct) food, so the repoint also fixes the answer:

- `bacon of` → "Premium cuts of bacon jerky" vs `bacon` → "Bacon" (used 242 times);
- `of pizza` → "Taste Of Tuscany Pizza Sauce" vs `pizza` → "Pizza".

`cooked of rice white` is a third: it holds *cream of rice cereal* for what was white rice.

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

### C. RETAINED — the `of` is part of the food's name. DO NOT EVICT (9 rows)

The fix does not change these keys; they are listed so a bulk `~ '(^|\s)of(\s|$)'` sweep
does not take them out. All nine were verified byte-identical pre- and post-fix.

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

### D. UNCHANGED by this fix — out of scope (2 rows)

`half a cup of X` puts the article at token [1], and the article strip is positional
(token [0] only). `leading-hedge-strip.test.ts` already documents this as an unowned
limitation and this branch deliberately leaves it alone.

| key | holds | used | producing line |
|---|---|---|---|
| `a cup of rice` | cooked wild rice (fdc) | 1 | `maybe half a cup of rice` |
| `a cup half maybe of rice` | cooked wild rice (fdc) | 1 | `maybe half a cup of rice`, pre-hedge-strip |

(`a cup half maybe of rice` is orphaned by the *already-shipped* leading-hedge strip, not
by this change. Its post-hedge key is `a cup of rice`, the row above it.)

## Totals

| class | rows | Σ usedCount |
|---|---|---|
| A. orphaned, target exists | 21 | 288 |
| B. orphaned, no target / needs confirmation | 3 | 9 |
| C. retained (lexical `of`) — **do not evict** | 9 | 10 |
| D. unchanged, out of scope | 2 | 2 |
| **total matching `(^\|\s)of(\s\|$)`** | **35** | **309** |

## Suggested execution order (when authorized)

1. Deploy the parser fix. Forked keys stop being *written*; they are still *read* until
   evicted, so nothing breaks in the gap — reads just keep hitting the old row.
2. Re-derive this table (queries below) against the live DB at that moment. `bacon of`
   moved 31 → 242 between the report that opened this work and this snapshot; the counts
   are not stable and must not be reused from here.
3. Confirm the two flagged rows in section B against the post-fix parser.
4. For section A, fold `usedCount` into the target row and delete the fork. For B, delete
   only. **Leave section C and D untouched.**
5. Re-run the query in step 2: only sections C and D should remain.

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

Target existence:

```sql
SELECT "normalizedForm", "usedCount" FROM "FoodMapping"
WHERE "normalizedForm" IN ('bacon','garlic','spinach','rice white','brown rice', ...);
```

The pre/post-fix key columns were produced locally by running each line through
`parseIngredientLine()` on both trees and passing `parsed.name` to
`canonicalizeCacheKey()`. No DB access, no writes.
