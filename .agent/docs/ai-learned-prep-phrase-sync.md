# AI-Learned Prep Phrase Sync

> **Status**: ❌ REMOVED 2026-08-01. Shipped Jan 6 2026, deleted because the mechanism was
> a feedback loop. The requirement it addressed is still real; the design it used is not
> the way back in. Read this before proposing "sync learned phrases" again.

---

## What it did

`getAiLearnedPrepPhrases()` in `src/lib/mapping/normalization-rules.ts` ran a `findMany`
over the whole of `AiNormalizeCache`, and `refreshNormalizationRules()` unioned the
resulting `prepPhrases` into the module-scope list that `normalizeIngredientName()`
consumes. The intent: when the LLM discovers "freshly grated" on one line, the static
parser should strip it on the next line without paying for another LLM call.

Armed by the in-process pipelines only — `autoMapIngredients()` in
`src/lib/nutrition/auto-map.ts`, `scripts/warm-names.ts`, `scripts/pilot-batch-import.ts`.
`scripts/eval/warm-cache.ts` warms over HTTP, so it never armed it.

## Why it was removed

`normalizeIngredientName()` computes the keys `AiNormalizeCache` is stored under. Feeding
the table's own contents back into it made key computation a function of the table, so the
same input hashed to different keys depending on whether the loop had been armed in that
process. Rows written armed became unreachable disarmed, and vice versa.

MEASURED 2026-08-01 (re-derive: `scripts/backfill-ai-normalize-keys.ts`, dry-run is the
default): arming the loop today would strand 89 of 2864 rows. The blast radius was never
confined to this table either — `normalizeIngredientName` also produces the
`normalizedName` fed to `deriveMappingCacheKey()`, i.e. the key space of `FoodMapping`.

The phrases were not harmless in themselves. MEASURED by running the real refresh against
the 22 phrases the live table held: `chicken sandwich` → `chicken`, `fried rice` → `rice`,
`breaded chicken` → `chicken`. A specific query loses its distinguishing word and lands on
a bare generic key another food already owns — the same class of repointing that broke five
golden cases in PR #143.

Re-derive the live phrase list:

```
ssh owner@192.168.1.133 'docker exec mealspire-db psql -U postgres -d mealspire -t -A -c \
  "SELECT DISTINCT lower(trim(p)) FROM \"AiNormalizeCache\", \
   jsonb_array_elements_text(\"prepPhrases\") AS p ORDER BY 1"'
```

## What replaces it

Nothing automatic, deliberately. A wanted phrase is hand-added to
`data/fatsecret/normalization-rules.json` one at a time, with
`npm run eval:golden -- --base http://192.168.1.133:3000` as the gate on both axes (real
failures AND drift). A phrase in that file is a key change for every store that keys off
`normalizeIngredientName`, so it must be a reviewed edit, not a side effect of traffic.

`refreshNormalizationRules()` and `getMergedPrepPhrases()` still exist and still have their
three call sites; the refresh now reads the static file and nothing else. The `prepPhrases`
column stays populated — it is an inert record of what the LLM observed, not an input to
key computation. `src/lib/mapping/__tests__/normalization-rules-static-only.test.ts` is the
guard: it fails if the database is ever read back into that list.

## If you want the feature back

The requirement is real: the parser re-pays for a phrase the LLM already identified. Any
replacement has to satisfy the constraint this one violated — **key computation must not
depend on the contents of a keyed store**. A curated allowlist file, regenerated offline
and committed, satisfies that. A runtime read of `AiNormalizeCache` does not, however it is
filtered.
