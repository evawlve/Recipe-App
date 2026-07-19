# Eval Hardening Plan — Match-Quality Frontier (2026-07-19)

## Where we are

The serving/count pipeline is at a natural stopping point: full golden eval = **0 real
failures** (search 101/104, nlp 150/156; every miss is a documented `knownIssue`). The
high-value serving defects (100×count over-billing, package-median resolution, portion
units) are all shipped and prod-verified (PRs #97–102).

## The real frontier: match quality, not serving math

A characterization pass (throwing 21 realistic parser-fed magic-log lines at the live
pipeline, `scripts/eval/` characterization) showed the current golden set **over-indexes
on serving math and under-tests whether we matched the right food record.** Of 3 new
defects found, **2 are "matched the wrong / a garbage record,"** not "computed the wrong
grams." That is the next place to push.

New cases added this round (`golden-set.json`, ids `n-mq-*`):
- 9 lock-in passes (branded-SKU precision, condiment density, portion units) with bands
  from observed live values.
- 2 graceful-degrade guards (unknown/fake brand → sane generic).
- 3 tracked defects (`knownIssue`) — see below.

## The 3 defects (tracked as knownIssue, ranked by leverage)

1. **`n-mq-20` macro-plausibility** — `1 mission carb balance tortilla` matches an OFF row
   whose per-serving numbers are mislabeled as per-100g (`70 kcal @ 19g carb` — impossible),
   under-counting calories ~2×. **Fix = a macro-plausibility gate** that rejects
   self-inconsistent records (`kcal` vs `4·carb + 4·protein + 9·fat`, and any macro > 100g)
   *regardless of name match*. Highest leverage: one gate would catch a whole class of
   garbage-record matches, not just this line.
2. **`n-mq-21` count over-bill residual** — `3 real good chicken tenders` → 336g while
   `4oz` of the same SKU → 113g. Multi-piece serving billed per-piece × count. Same family
   as the shipped Cluster A fix; likely a small cap on the count path.
3. **`n-mq-22` generic staple match quality** — `grilled chicken breast` matches a deli/roll
   product (low protein, high fat); `white rice` resolves to 45g dry vs ~150g cooked.
   Needs generic-staple ranking to prefer canonical cooked forms + a cooked-vs-dry serving
   axis.

## Next rounds (characterize first, then assert)

Grow the golden set along match-quality axes the current set barely covers. **Always
characterize new lines against the live API first (record what they actually match), then
set bands from observed-correct values — never guess bands.**

1. **Macro-plausibility gate** (implement) — closes `n-mq-20` and an unknown number of
   silent wrong-record matches. Add plausibility-probe cases across branded packaged foods.
2. **Cooked-vs-dry staples** (new axis) — rice, pasta, oats, beans, lentils: does a bare
   staple name in a meal resolve to the cooked serving/nutrition or the dry one?
3. **Branded-SKU-vs-generic** — for each of N popular brands (Real Good, Mission Carb
   Balance, Quest, RXBAR, Built, Premier, Chomps, …): does the branded line beat the plain
   generic AND carry the brand's own macros?
4. **Count over-bill sweep** — multi-piece-serving SKUs (tenders, nuggets, wings, ravioli)
   at count vs explicit weight, to bound `n-mq-21`'s class.

## Config / infra follow-ups (separate from cases)

- **Parse-model config is a three-way mismatch — needs a decision.** Intent stated: "magic
  log should default to OpenRouter Gemini-2.0-flash first." Reality on this Mac's `.env`:
  provider chain for `purpose:'parse'` is **Ollama `qwen2.5:14b` FIRST** (`OLLAMA_ENABLED=true`),
  then OpenRouter **`openai/gpt-4o-mini`** (`CHEAP_AI_MODEL_PRIMARY`), then `mistral-nemo`,
  then OpenAI. Gemini-2.0-flash appears ONLY in `.env.example` and a **stale code comment**
  (`src/app/api/nlp/parse/route.ts:191`). The runtime `.env` on the Mini-PC/OptiPlex is not
  visible from here and may differ again. **Action:** verify the deployed `.env`, then decide
  the intended chain and align `.env` + `.env.example` + the stale comment.
- **No cache on the segmentation result** — identical free-text lines re-hit the LLM every
  time (only the mapped food is cached, keyed on normalized name). A `text`→segmentation
  cache would flatten a chunk of the latency tail cheaply.
- **Latency tail lives in stage-2, not segmentation** — segmentation is hard-capped at an 8s
  overall deadline then degrades to the heuristic splitter; the observed 73s max came from
  stage-2 per-item mapping AI calls, which don't share that cap. If the tail matters, bound
  stage-2 next.

## Progress — round 2 (2026-07-19 pt5)

**SHIPPED (deployed to Mini-PC, live-verified, 0 real failures):**
- **Dry-solid volume density** (`n-serv-14` class). Both `volumeToGrams` tables (OFF `buildOffResult` + generic/FDC) used a flat 0.5 g/ml for solids, under-weighting dense dry solids ~40% (sugar 2.5g/tsp → 4.25g). Fixed via `density.ts` category density, gated on a new `DRY_GRANULE_DENSITY_CATEGORIES` allowlist (sugar/flour/starch/oats/powder/whey/nut/seed) so cooked/dry-ambiguous grains and high-water foods stay on 0.5 and don't trip serving bands. +7 golden lock-ins (`n-dens-01..07`), `n-serv-14` promoted.

**CHARACTERIZED → new tracked defects (knownIssue), fixes deferred (risky):**
- **Cooked-vs-dry staples** — GRAINS only (rice/pasta/quinoa/oats default DRY; legumes already cooked). Root: `detectGrainCookingContext` (filter-candidates.ts:345) ignores the unit; `basic_produce_bypass` (gather-candidates.ts:516) locks the dry top1; `cook-state-detector.ts` is DEAD CODE. Quinoa/oats also corpus-blocked. Lock-ins `n-cook-01/02/03`; defects `n-cook-04/05/06`. Fix HIGH-risk (recipe cups logged dry).
- **Brand-hijack** — brand is a tiebreaker behind `simple-rerank.ts:1452` + weak +0.25 bonus. Ranking-fixable: `n-seg-21`, `n-brand-02`. Ingest/detection-blocked: `s-supp-11`, `n-brand-05` (c4), `n-brand-06` (bang; both absent from brand-lexicon.json), `s-supp-17`. Positive controls `n-brand-03/04` added hard. Fix risks generic-word over-fire → needs 2-gram brand guard.

## Progress — round 3 (2026-07-19 pt6): both deferred fixes SHIPPED

**Full eval after deploy: 0 real failures; n-seg-21, n-brand-02, n-cook-04 all promoted to hard.**

**1. Brand-hijack — fixed as retrieval + rescue + ranking (root cause was retrieval, not just ranking):**
- **Decisive brand gate** (`simple-rerank.ts`): 2-gram brand evidence (multi-word brand hit, or unigram brand adjacent to a product-form token — "ghost protein" yes, "ghost pepper" no) + same-brand candidate covering ≥1 non-brand query token → `DECISIVE_BRAND_BOOST` 0.35 + a partition tiebreak above cross-brand candidates. Brand match is whole-token against brand field OR name (OFF often embeds brand in name with empty brand field).
- **Brand-targeted retrieval** (`gather-candidates.ts`): live characterization showed the pool for "ghost protein cinnamon roll" contained ZERO Ghost candidates — no ranking fix can lift what isn't retrieved. Added a "<brand> <first non-brand token>" OFF search when a brand is detected.
- **Core-token brand rescue extended to name-embedded brands** (`map-ingredient-with-fallback.ts`) — "Ghost Whey Protein (Cinnabon)" (brand field empty) was being dropped for missing the "cinnamon" core token.
- **Save-path rescue** (`validated-mapping-helpers.ts`): same rescue at `saveValidatedMapping`, so the corrected mapping caches instead of re-resolving every request.
- Result: "2 scoops ghost protein cinnamon roll" → **Ghost Whey Protein (Cinnabon)** (the exact record from the characterization); "one bar birthday cake" → ONE Brands bar. Positive controls n-brand-03/04 green.
- **Deliberately skipped**: adding bare `c4`/`bang` to the brand lexicon (n-brand-05/06 stay knownIssue) — those unigrams would flip `isBranded` on lines like "bang bang shrimp" for zero eval gain since the SKUs are ingest-blocked anyway.

**2. Cooked-vs-dry grains — fixed as a SOFT preference (grains only, volume units only):**
- `detectGrainCookingContext` gains a `softCooked` branch: HEAD-NOUN true grain (rice/pasta/quinoa/oats/… — "rice vinegar" excluded) + eaten-portion volume unit (cup/bowl/serving) + no dry signal (dry/uncooked/raw/flour/…/any weight unit) → prefer cooked, softly.
- Soft mode NEVER hard-rejects dry candidates (`isWrongCookingStateForGrain` returns false) — quinoa/oats have no cooked record and would empty the pool (n-cook-05/06 stay knownIssue, corpus-blocked).
- **Cooked retrieval**: gather adds a `cooked <raw-line food name>` FDC search (raw line, because BOTH the parser and normalizer strip variety adjectives: "1 cup white rice" parses to "rice" — searching "cooked rice" top-ranks WILD rice).
- **Rerank cooked partition** with (a) nutrition-window cooked detection (kcal 60–250 AND carbs ≥ 12 — keeps rice milk out; many cooked records are neutrally named), (b) variety guard vs the raw line (white ≠ wild/brown), (c) within-partition raw-token-coverage tiebreak, (d) a 0.75 confidence floor for cooked winners (their verbose FDC names score below the 0.70 rerank minimum and the winner was being discarded for the dry top1).
- **confidenceGate returns early under softCooked** — BOTH the basic-produce bypass AND the exact-match margin skip ("rice"=="Rice" at confidence 1.0) otherwise lock the dry top1 before rerank runs.
- **Cache escapes** at both FoodMapping checkpoints when the cached food doesn't demonstrably look cooked.
- Result: "1 cup white rice" → white medium-grain cooked unenriched rice, **158g/cup, carbs100 28.6** (band [26,36]). Weight lines ("200g rice") still resolve dry; explicit-cooked lock-ins n-cook-01/02/03 green; legumes untouched.
- `cook-state-detector.ts` (dead code, zero importers) deleted.

**3. FoodMapping upsert now stores the re-resolved food on update** (`validated-mapping-helpers.ts`): the update clause only incremented `usedCount`, so every cache escape (count-label, brand-guard, cooked-grain) re-resolved on EVERY request forever instead of once — stale rows could never be replaced. All rows are `validatedBy='ai'`, so overwrite is safe.

**Known trade-off (documented, accepted):** recipe-style "2 cups rice" (measured dry) now resolves cooked — the meal-logging reading wins for volume units. Weight units keep the dry/recipe basis. The FoodMapping key doesn't encode cooking context, so alternating cup/weight lines for the same grain flip the cached row and re-resolve each flip (correctness preserved by the read-time state checks; latency cost only).

**Promotions this round:** n-seg-21, n-brand-02, n-cook-04 (fixed), plus s-supp-17, n-supp-15, n-serv-06 (3 consecutive passing runs). n-seg-07/16/18/29 left as knownIssue — n-seg-18 flapped back to failing this round, confirming segmentation cases are AI-flaky.

## How to run

```
# full eval
npx ts-node --transpile-only --compilerOptions '{"module":"commonjs","moduleResolution":"node"}' \
  scripts/eval/run-eval.ts --base http://192.168.1.21:3000

# just the new match-quality cases
... run-eval.ts --base http://192.168.1.21:3000 --only nlp --grep n-mq
```
