# Lane A S49 ROW 3 — the composite-path gate arm punch #167 has never had

Read-only design work. Nothing ships. All work done 2026-09-12 in
`/Users/diego/dev/Recipe-App` at the checked-out working tree unless stated.

Every claim below is labelled **[measured]** (a command was run, output read) or
**[reasoning]** (read from code, not executed).

---

## 1. THE FOUR FACTS, RE-VERIFIED

### (i) `preserveDroppedBrand()` has ONE non-test call site, inside the composite-path guard — CONFIRMED, and narrower than stated

**[measured]** `grep -rn preserveDroppedBrand src --include='*.ts' | grep -v __tests__`
returns 6 lines: 4 in `src/lib/mapping/quantity-word-brand.ts` (3 comments + the
`export function` itself) and 2 in `src/lib/mapping/map-ingredient-with-fallback.ts`
(the import, and one call).

**[measured]** The single call in `mapIngredientWithFallback()` in
`src/lib/mapping/map-ingredient-with-fallback.ts` sits inside
`if (options.normalizedForm?.trim()) {` — read directly from the file. The block
immediately above it is the `IDENTITY_QUALIFIERS` restore, whose guard is the exact
complement, `if (!options.normalizedForm?.trim() && parsed?.qualifiers?.length)`.
The two blocks are mutually exclusive by construction: the qualifier restore is
SOLO-path-only and the brand-preservation guard is COMPOSITE-path-only.

So fact (i) holds: **`preserveDroppedBrand()` is unreachable without
`options.normalizedForm`.**

### (ii) `normalizedForm` in `winner-diff.ts` is never a replay input — CONFIRMED, and the stronger fact is that `options.brand` is absent too

**[measured]** `grep -n normalizedForm scripts/eval/winner-diff.ts` → exactly 5 hits,
all inside one `FoodMapping` population-sampling block (a `$queryRawUnsafe`
`SELECT "normalizedForm", "usedCount" FROM "FoodMapping"`, its Prisma `select`
equivalent, the `r.normalizedForm` seed decoration, and a `say()` caveat line
warning that `FoodMapping.normalizedForm` is token-SORTED). None is a mapper argument.

**[measured]** `winner-diff.ts` calls `mapperMod.mapIngredientWithFallback()` at
exactly two sites (`grep -n mapIngredientWithFallback scripts/eval/winner-diff.ts`
→ 2 call lines). Reading both option objects verbatim:

- snapshot-cut site: `{ skipCache: true, debug, allowLiveFallback: true, skipOnLock: true, aiNutritionBudget, aiHydrationBudget }`
- `--with-serving` real-arm site: `{ skipCache: true, debug, allowLiveFallback: true, skipOnLock: true, telemetry, aiNutritionBudget, aiHydrationBudget }`

**Neither passes `normalizedForm`. Neither passes `brand`.** That is stronger than
the brief's framing: the guard is not merely fed a frozen `normalizedForm`, it is
fed *no* `normalizedForm at all*, so `options.normalizedForm?.trim()` is
`undefined` and the whole block is skipped on every one of winner-diff's queries,
in BOTH arms.

### (iii) `quantity-word-brand.ts` is the 15th FROZEN_INPUT alternative and the guard `exit 3`s with no `--force` — CONFIRMED

**[measured]** `grep -n FROZEN_INPUT_PATHS scripts/eval/winner-gate.sh` → the
definition plus its `if changed_paths | grep -qE "$FROZEN_INPUT_PATHS"` test.
Enumerating the `|`-separated alternatives in python3 prints 15 entries, with
`src/lib/mapping/quantity-word-brand\.ts` at position **15**.

**[measured]** The guard body ends in `exit 3`. `grep -n -i force scripts/eval/winner-gate.sh`
finds two prose lines saying *"There is no --force, deliberately"* and one
`git worktree remove --force` (unrelated, cleanup). There is no force flag.

### (iv) A green `winner-gate` on a #167-shaped change is a receipt for a program the instrument never ran — CONFIRMED, by two independent mechanisms

This is memory `winner-diff-cannot-see-the-composite-path` in its purest form, and
the verification above shows it is **doubly** true — the two mechanisms are
independent and either alone would be fatal:

1. **The gate refuses to run.** Any edit to `src/lib/mapping/quantity-word-brand.ts`
   trips the FROZEN_INPUT abort and `winner-gate.sh` exits 3 before any node
   process starts. So the ordinary arm produces no receipt at all.
2. **If it did run, it would fire zero times.** Even on the `--cross-snapshot` arm
   the abort message offers as the escape hatch, both `mapIngredientWithFallback()`
   call sites omit `normalizedForm`, so `preserveDroppedBrand()` — and therefore
   every line of `quantity-word-brand.ts` that #167 would edit — is never
   executed. A `--cross-snapshot` run over the current seeds would report
   100% SAME and brand itself RETRIEVAL-NOISE-CONTAMINATED, which reads as
   "noisy but no change" rather than "the code under test never ran."

   **[reasoning]** Mechanism 2 is read from the two option objects, not executed —
   but see §6, where the dry run measures it.

**Consequence for S50**: #167's documented gate fires ZERO times, so it is vacuous
in the precise sense memory `a-100-percent-same-cold-arm-is-a-wrong-population`
names. The pinned arm in §3 is the replacement.

---

## 2. THE TWO CACHE ASYMMETRIES — BOTH VERIFIED, and asymmetry 2 is sharper than briefed

### Asymmetry 1 — `nocache=1` NULLS the segmentation cache. VERIFIED.

**[measured]** `grep -n lookupSegmentationCache src/app/api/nlp/parse/route.ts` returns the
import plus the read, whose body is verbatim:

```
const cachedSegments = noCache ? null : await lookupSegmentationCache(lineKey);
```

and the write below it is guarded `if (!noCache)`. So an HTTP arm run with
`?nocache=1` re-draws the LLM segmenter on **every** probe. The segmenter draw is
the exact input `preserveDroppedBrand()` reads (`options.normalizedForm` /
`options.brand` are the segment's own fields), so an HTTP arm would measure the
segmenter's draw variance and the guard's behaviour convolved together, with no
way to separate them. That is why the arm must PIN the segments.

### Asymmetry 2 — `AiNormalizeCache` is not gated by `skipCache`. VERIFIED, and the key is `baseName` itself.

**[measured]** `aiNormalizeIngredient()` in `src/lib/mapping/ai-normalize.ts` has the
signature `(rawLine: string, cleanedInput?: string)` — **there is no `skipCache`
parameter at all**, so `skipCache: true` on the mapper cannot reach it. Its first
statement is `const cached = await getAiNormalizeCache(rawLine);`.

**[measured]** The mapper's only call is
`const aiHint = await aiNormalizeIngredient(baseName, normalizedName);` in
`mapIngredientWithFallback()` — and the shipped comment on that line says so
outright: *"FIX: Pass baseName instead of rawLine so the LLM output is cached by
the normalized quantity-free string"*.

**[measured]** `getAiNormalizeCache()` in `src/lib/mapping/validated-mapping-helpers.ts`
computes `computeNormalizedKey(rawLine, …)` — i.e. of `baseName`.

So the cache key is a pure function of `baseName`, **the single variable
`preserveDroppedBrand()` mutates**. The moment #167 changes the guard's output the
key moves, the BRANCH arm misses where the BASE arm hits, and the branch takes a
live LLM draw. This is memory `control-moved-in-arm-check-ainormalizecache`
reproduced exactly, and it is a second, independent reason an HTTP arm cannot gate
#167.

**[measured]** It also has a version dimension that bites the census:
`RULES_VERSION = 5` in that file, and `getAiNormalizeCache()` returns null when
`(cached.rulesVersion ?? 0) < RULES_VERSION`. Against the census's col0 domain
`{'2': 974, '3': 278, '5': 254, '4': 47}`, **1,299 of 1,553 rows (974+278+47) are
already treated as MISSES today** — confirming the brief's figure exactly.

**Consequence for the arm**: the pinned arm must NOT rely on `AiNormalizeCache`
being warm or cold. The write guard (§3) suppresses its write, so run 2 re-draws
whatever run 1 drew — which is honest, and is what the noise floor in §6 measures.

---

## 4. THE RECOVERED PREDICATE — delivered as CODE

Script: `s49row3_predicate.ts` (scratchpad). PURE — no DB, no LLM, no network.
Run:
```
cd /Users/diego/dev/Recipe-App && DATABASE_URL="postgresql://u:p@127.0.0.1:1/none" \
  npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
  <scratchpad>/s49row3_predicate.ts [--set]
```

### First: the column reading is now MEASURED, not inferred

The brief records the column reading as a previous reader's reasoning from value
domains. It is now **[measured]**, from two independent places:

- **[measured]** `grep -n -A22 'model AiNormalizeCache' prisma/schema.prisma` shows the
  columns `normalizedKey` (@id), **`rawLine String?`** ("Original raw line (for
  reference/debugging only)"), `normalizedName`, …, `rulesVersion`, `useCount`.
- **[measured]** `saveAiNormalizeCache(rawLine, …)` is called from `ai-normalize.ts` as
  `saveAiNormalizeCache(rawLine, {…})` inside `aiNormalizeIngredient(rawLine, …)`,
  which the mapper invokes as `aiNormalizeIngredient(baseName, …)`.

So col0=`rulesVersion`, col1=`useCount`, col2=**`rawLine`, which IS the post-repair
`baseName`**, col3=`normalizedName` (the model's output). This is why the doubling
is directly legible in col2 and why col2 keeps its original casing — it is not the
lowercased `normalizedKey`.

### Which population it selects

Two predicates, because they select different populations:

- **P-SELF** (lexicon-free): a leading token run that (i) leads the FOLDED string,
  (ii) RECURS downstream, and (iii) is not contiguously present in the tail under
  the shipped plain `.includes()`. Needs no brand list.
- **P-LEX**: P-SELF plus "the run is a brand `detectBrandInQuery()` can name."

**[measured]** over the committed 1,553 rows:

| mode | P-SELF | P-LEX |
|---|---|---|
| contiguous recurrence | 8 rows / 62 serves | 3 rows / 33 serves |
| `--set` (order-free) recurrence | **11 rows / 83 serves** | 5 rows / 35 serves |

`--set` is the right mode: contiguous recurrence cannot see the NON-ADJACENT shape
(`Optimum Nutrition` + `optimum weigh nutrition protein`) or the REORDERED one
(`Ben & Jerry's` + `and ben jerry`). **It selects the DOUBLING population, not the
DAMAGED subset** — damage is a property of col3 (what the model then did), and of
the 11 rows the model deduped cleanly on most.

**It returns 11, more than 5, and that is correct** — the brief anticipated this.
It recovers all five named census rows, both Ben & Jerry rows, and four the S47
table never listed: `Angie's Boomchickapop` (7 serves), `carls`+`jr big carl`,
`chips`+`ahoy chewy chocolate chip cookies`, and `McDonald's`+`a serving of
McDonald’s sized french fries` — the last being a **CURLY-APOSTROPHE** spelling
class (U+2019) that none of the five named rows exhibits.

### A limit of P-LEX that is itself a finding

**[measured]** `detectBrandInQuery('Noodles & Company')` → `{isBranded:false,
matchedBrand:null}` on this tree. The brand is UNREACHABLE to the detector, so
P-LEX cannot see that row at all (it is P-SELF-only). That is the #407
unreachable-lexicon-entry defect showing up inside the measuring instrument, and
it is a second reason the doubling is composite-path-only: on that line the brand
can ONLY have come from `options.brand`, because the detector never finds one.

**[measured]** `detectBrandInQuery("Ben & Jerry's ben and jerrys cherry garcia")` →
`matchedBrand: "ben and jerrys"` — the LEXICON spelling, not the prepended one.
A predicate that tests containment with the lexicon spelling reads "no doubling" on
a visibly doubled row, because the tail *does* contain `ben and jerrys`
contiguously. The predicate therefore recovers the brand **in the spelling that was
prepended**, and that subtlety is called out in the script's header.

---

## 3. THE ARM — design, and a HOLE found in `winner-diff`'s read-only guard on the way

Script: **`s49row3_pinned_composite_arm.ts`** (scratchpad).

### 3.1 The write-safety question, answered — and a finding S50 must carry

The brief required establishing, by reading code, exactly what suppresses the
`FoodMapping` write before running anything that calls the mapper. Three layers
exist and only the combination is sufficient.

**Layer 1 — `skipSave`. Necessary, NOT sufficient.**
**[measured]** `if (!skipSave) await saveValidatedMapping(rawLine, result, {…})` is the
**only** `saveValidatedMapping()` call in `mapIngredientWithFallback()`. Its own
docstring states the scope: *"this option gates ONE write — FoodMapping … a caller
that sets `skipSave` WITHOUT opening a policy (every script, every other route)
still gets the narrow meaning … and still persists FdcServing/OffServing/
AiGenerated* rows. Still unsuppressed under either: MappingEventLog …, the
FoodMapping usedCount/lastUsedAt bumps on a warm READ, and the upstream mirrors
FatSecretFood/OffFood/AiGeneratedFood/LearnedSynonym."*

**Layer 2 — the Prisma `$use` write guard (`installWriteGuard()` in `winner-diff.ts`).**
**[measured]** It intercepts `params.action ∈ MUTATING` and returns `null` without
calling `next()`. The precondition that it covers everything holds for the mapper:
- **[measured]** exactly one `new PrismaClient` in `src/` (`grep -rn "new PrismaClient" src --include='*.ts'` → `src/lib/db.ts` only; the `hand-panel-repair.ts` hit is inside a comment block), and `validated-mapping-helpers.ts` does `import { prisma } from '@/lib/db'` — one singleton, so the middleware covers the save path.
- **[measured]** `grep -rn '\$executeRaw\|\$queryRawUnsafe\|\$executeRawUnsafe' src/lib/mapping src/lib/nlp` returns only a test mock.
- **[measured]** every mutating call in `validated-mapping-helpers.ts` is `update`/`upsert` (`foodMapping.update` ×2, `foodMapping.upsert`, `aiNormalizeCache.update`, `aiNormalizeCache.upsert`) — all in `MUTATING`.
- **Precedent [measured]**: `winner-diff.ts`'s `--with-serving` arm installs
  `installGatherInterceptor('continue', …)`, i.e. it runs the mapper **to completion**
  through the save path, protected only by this guard. That arm is a shipped,
  repeatedly-run instrument against this same production DB.

### 3.2 THE HOLE — `winner-diff`'s READ-ONLY promise leaks a write

**[measured]** `MUTATING` in `winner-diff.ts` is:
`create, createMany, createManyAndReturn, update, updateMany, upsert, delete,
deleteMany, executeRaw, executeRawUnsafe`. **`queryRaw` and `queryRawUnsafe` are
absent.**

**[measured]** `touchAndFetchCacheRow()` in `src/lib/mapping/validated-mapping-helpers.ts`
— the function `getAiNormalizeCache()` calls on **every** lookup — issues, as its
PRIMARY path:

```
await prisma.$queryRaw`UPDATE "AiNormalizeCache"
    SET "useCount" = "useCount" + 1, "lastUsedAt" = now()
    WHERE "normalizedKey" = ${normalizedKey} RETURNING *`
```

That is a WRITE with `params.action === 'queryRaw'`, which the guard does not
intercept. The Prisma-model `update` form still exists, but only as the FALLBACK
taken after `rawTouchSupported` flips false on an exception.

**[measured]** `installAiInterceptors()` wraps `getAiNormalizeCache` but calls the
real one (`const r = await realGetCache(...args);`), so the wrap does not stop it
either.

**[measured]** `winner-diff.ts`'s own header asserts *"STRICTLY READ-ONLY (this is a
promise, and it is enforced in code) … This script NEVER writes to FoodMapping or
any other table"*, and its explanatory note says `getAiNormalizeCache` *"bumps
`useCount` with an `update`"* — describing the fallback, not the shipped primary
path. **So the header is stale in a way that inverts its own promise**: every
`winner-diff` run that reaches the normalize gate bumps `useCount`/`lastUsedAt` on
the `AiNormalizeCache` rows it touches.

This is **[reasoning]**, not measured live, on one point only: that Prisma 5.18
reports `$queryRaw` as `action: 'queryRaw'` (hence outside the set). The code
shapes on both sides are measured. **It is a finding for Lane A independent of
#167** — `AiNormalizeCache.useCount` is one of the inputs the S47 census is cut
from, so the instrument has been perturbing the corpus it measures.

### 3.3 The arm's guard is STRENGTHENED, and that is why it can run where winner-diff should not

`s49row3_pinned_composite_arm.ts` installs the same `$use` middleware **plus**:
- `queryRaw` / `queryRawUnsafe` inspected: a statement matching
  `/^\s*(UPDATE|INSERT|DELETE|TRUNCATE|ALTER|DROP)/i` is no-oped, a raw SELECT passes.
- Returning `null` (not `[]`) for the suppressed raw touch is deliberate:
  `touchAndFetchCacheRow()` does `rows[0] ?? null`, so `null` raises a TypeError
  **inside its own try/catch**, which sets `rawTouchSupported = false` and falls
  through to `findUnique` (a read, allowed) + `update` (suppressed) — so the cache
  HIT is still returned and only the bump is lost. Returning `[]` would instead
  read as a cache MISS and send the line to the LLM, changing behaviour.
- `skipSave: true` on every mapper call, as belt-and-braces.

### 3.4 What the arm pins, diffs, and cannot see

**PINS** — `mode=pin` calls `segmentTextWithAi()` once per seed (the `_seg_ab_driver.ts`
entry point; **[measured]** `src/lib/nlp/ai-segmenter.ts` imports only
`callStructuredLlm` and no Prisma, so it is DB-free) and freezes per item:
`rawText`, `normalizedForm`, `brand`. `mode=replay` feeds those to
`mapIngredientWithFallback(rawText, { brand, normalizedForm, skipCache: true,
skipSave: true })` — the same option shape as `buildParsedItem()` in the parse route.

**DIFFS** — per ITEM, keyed `(lineIdx, itemIdx)`: `foodId`, `grams`, `kcal`,
**`guardApplied`** and **`guardBaseName`**. The last two are the shipped
`preserveDroppedBrand()`'s own return, captured by wrapping it — so the arm reports
what the code under test DID, not only whether a winner moved. On a seed set this
size a correct #167 can move no winner at all; a winner-only gate would read SAME
and teach nothing.

**CANNOT SEE** (stated in the script header): retrieval drift (no frozen pool —
both arms query Typesense/Postgres live); the segmenter itself (pinning is the
point); warm behaviour (`skipCache` forces cold, and #167 MOVES the cache key, so
SAME here does not mean the stored rows are unchanged); the save gates
(`skipSave` means they never run); any case the change should CREATE; and
`AiNormalizeCache` warmth (the guard suppresses the write, so run 2 re-draws).

---

## 5. THE SEED LIST

`s49row3_seeds.txt` — 16 lines → **18 pinned items**, 15 of which carry BOTH a
segmenter `brand` and a `normalizedForm`, i.e. reach the guard.

1. **The doubling class** (from the census, via the recovered predicate):
   `m and ms pretzel` · `a fun size bag of m and ms` · `noodles and company pad thai` ·
   `optimum weigh nutrition protein` · `and a half of optimum weight nutrition protein`
2. **The class WORKING** — a fix must not break these:
   `ben and jerrys cherry garcia` · `and ben jerry`
3. **New rows the predicate surfaced**: `angies boomchickapop sweet and salty` ·
   `a serving of mcdonalds sized french fries`
4. **S47 §2 adjacency arms C/D/E**: `optimum whey nutrition protein` (C, must double) ·
   `optimum nutrition weigh protein` (D, must not) · `optimum gold nutrition protein` (E, must double)
5. **S40 co-brand seeds**: `.75 scoop Ryse skippy peanut butter` ·
   `Two chocolate caramel rice cakes from Quaker`
6. **Genuinely multi-item lines**, so the per-ITEM key is exercised:
   `m and ms pretzel and a banana` · `ben and jerrys cherry garcia with a coffee`

**[measured]** The live arm reproduces the mechanism: `[3.0]` guard APPLIED
`"Optimum Nutrition optimum weigh nutrition protein"` — the doubling, live on this
tree — and arms C and E double while D does not, exactly as S47 §2 predicted.

**[measured] A pinning-justifies-itself observation**: on `noodles and company pad thai`
the segmenter drew the brand as `noodles and company` (the `and` spelling), so the
plain containment SUCCEEDED and nothing doubled — whereas the census row for that
line doubled because the brand had been drawn as `Noodles & Company`. **The defect
is contingent on the segmenter's brand SPELLING draw.** An HTTP `nocache=1` arm
would see that flap and read it as the change; the pinned arm holds it constant.

---

## 6. THE DRY RUN — it RAN, wrote nothing, and the noise floor is NOT 0

### Write receipt

**[measured]** `FoodMapping` count, read-only psql, bracketing the whole session:
**4853 before → 4853 after. Zero rows written.**

**[measured]** Suppression tallies printed by the two runs:
- arm A: `{raw.queryRaw:MUTATING: 1, AiNormalizeCache.update: 8, AiNormalizeCache.upsert: 12}`
- arm B: `{raw.queryRaw:MUTATING: 1, AiNormalizeCache.update: 8, AiNormalizeCache.upsert: 12, AiGeneratedFood.update: 1, AiGeneratedServing.upsert: 1}`

`FoodMapping.upsert` appears in NEITHER tally because `skipSave: true` stopped
`saveValidatedMapping()` being called at all — the guard was the second line of
defence and was not needed for that table. The `raw.queryRaw:MUTATING: 1` then 8
`update`s is the designed fallback: the first interception flips
`rawTouchSupported` false and every later touch uses the Prisma `update` form,
which the guard also suppresses.

### Guard self-test (run FIRST, zero write risk by construction)

**[measured]** `s49row3_guard_selftest.ts` calls `getAiNormalizeCache()` on a random
key that cannot exist, so even total guard failure updates 0 rows. Output:
- a raw `SELECT 1` PASSED THROUGH (`[{"one":1}]`);
- the middleware saw `queryRaw :: UPDATE "AiNormalizeCache" SET "useCount" = "useCount" + 1, "lastUsedAt" = now() … RETURNING *` and INTERCEPTED it;
- `getAiNormalizeCache` logged `ai_normalize_cache.raw_touch_unsupported` and fell back exactly as designed.

**This measures §3.2**: the bump really is `action: 'queryRaw'`, which is absent
from `winner-diff.ts`'s `MUTATING` set. The hole is no longer reasoning.

### NOISE FLOOR: 3 of 18 items moved (16.7%). NOT 0.

Two runs of the identical tree against the identical pin file:

```
items compared : 18
SAME           : 15
MOVED          : 3
ITEM-COUNT MISMATCH: 0
```

Per channel **[measured]**:

| channel | identical across the two same-tree runs |
|---|---|
| `guardApplied` + `guardBaseName` (the code under test) | **17 / 18 (94.4%)** |
| `foodName` | 16 / 18 (88.9%) |
| `foodId` / `grams` / `kcal` | **15 / 18 (83.3%)** |

The three movers, characterised:

1. **`optimum whey nutrition protein`** — `off_0748927066227` → `off_0748927053012`.
   **Same `foodName` ("Whey protein"), same `servingTier`, different barcode.** A
   duplicate-SKU tie among Optimum Nutrition OFF rows. `guardBaseName` **identical**
   on both arms.
2. **`optimum nutrition weigh protein`** — `off_0748927067897` → `off_0748927069853`,
   `"Whey protein"` vs `"Whey Protein"`. Same class. `guardBaseName` **identical**.
3. **`and ben jerry`** — `off_0076840101771` → an `AiGeneratedFood` cuid, and
   `guardApplied true → null`. This one is upstream of the guard: in arm A the line
   had been canonicalized to `Ben & Jerry's Ice Cream` before the guard ran (the
   captured `guardBaseName` is `"Ben Jerry's Ben & Jerry's Ice Cream"` — itself a
   doubling), in arm B it had not, so `targetBrand` was empty and the block was
   skipped. Consistent with LLM/synonym nondeterminism or live-corpus drift between
   the runs; **not diagnosed further**, and I am labelling it unexplained rather
   than attributing it.

### What S50 must do with this

**The floor is a finding about the ARM, and it is directional, not fatal:**

- Movers 1 and 2 are the documented duplicate-OFF tie class (the ⭐ A7 row's
  territory), entirely downstream of `quantity-word-brand.ts`, and they leave the
  guard channel untouched. **Read the gate on `guardBaseName` first** — it is the
  direct output of the code under test and the most stable channel measured.
- A `foodId`-primary reading of this arm needs either a tie-tolerant comparison
  (compare `foodName`+`brandName` before `foodId`) or more runs per arm. As it
  stands an 83.3% floor cannot resolve a change that moves fewer than ~3 winners.
- Per the brief: a non-zero floor on the pinned arm is **not** a reason to abandon
  #167. It is the number S50 designs around.

---

## 7. THE TOKENIZER QUESTION S50 MUST DECIDE

**The question**: does the containment check in `preserveDroppedBrand()` become a
FOLD (contiguous, `&`→`and`, apostrophes, hyphens) or a TOKEN-SET test?

**[measured]** — `s49row3_tokenizer_probe.ts` replays the seven known rows through
the **shipped** `preserveDroppedBrand()` and scores three containment rules. Every
`shipped.baseName` reproduces the census col2 byte-for-byte, e.g.
`preserveDroppedBrand({rawLine:'m and ms pretzel', baseName:'m and ms pretzel',
targetBrand:"M&M's", rederived:'m and ms pretzel', parsed:null})` →
`{baseName:"M&M's m and ms pretzel", applied:true}`.

| rule | rows still doubled | serves still doubled |
|---|---|---|
| (a) today — plain `.toLowerCase().includes()` | 7 / 7 | 67 |
| (b) #407 fold — canonical, still CONTIGUOUS | 3 / 7 | 21 |
| (c) TOKEN-SET over folded tokens | 1 / 7 | 19 |

**So the brief's arithmetic is confirmed and my label is [measured], not reasoning**:
the three `&`-vs-`and`/apostrophe census rows (24 + 2 + 1 = **27 serves**) are fixed
by a FOLD; the two `Optimum Nutrition` rows (**2 serves**) are NOT — their tokens are
NON-ADJACENT, and only a TOKEN-SET test reaches them. That is the 27-vs-2 split of
the class's 29 serves.

**A third gap the brief did not name, and it is the largest single row**:
`Ben & Jerry's` + `and ben jerry` (**19 serves**) survives (a), (b) AND (c) — the
tail carries the SINGULAR `jerry` against the brand's `jerrys`. **[measured]** the
shipped `repairDroppedBrand()` — guard 2 — already handles exactly this, via
`foldedBrand.endsWith('s') && foldedName.includes(foldedBrand.slice(0,-1))`. Over the
census the predicate scores guard-2's rule as fixing **10 of the 11** doubling rows,
failing only `M&M's` (whose alnum fold `mms` is 3 characters, below that rule's
`length > 3` bar).

**So the real finding is that the two guards in this one file disagree about what
"the brand is already present" means** — the same shape the file's own
`brandReassertEvidence()` header documents for a different question. S50's cheapest
correct move is to make guard 1's containment ask guard 2's question.

### What `903dd09` (#407, closed, kept) already covers

**[measured]** `git show 903dd09:src/lib/mapping/quantity-word-brand.ts`:
- imports `canonicalizeBrandKey` from `brand-detector` and defines
  `foldBrandTokens(value) { return canonicalizeBrandKey(value).split(' ').filter(Boolean); }`
- `preserveDroppedBrand()` becomes `canonicalizeBrandKey(baseName).includes(canonBrand)`
  and `canonicalizeBrandKey(rederived).includes(canonBrand)`.
- **[measured]** `canonicalizeBrandKey()` on that branch is
  `.toLowerCase().replace(/['’`]/g,'').replace(/&/g,' and ').replace(/[-.\/]+/g,' ').replace(/\s+/g,' ').trim()`
  — behaviourally identical to this tree's private `foldBrandTokens`, as the
  branch's own header states.

**It DOES**: fold `&`/`and`, apostrophes (straight and curly), hyphens, dots,
slashes — so it fixes the 27-serve `&` class, and by its own header the
`chick-fil-a` / `coca-cola` / `in-n-out` class too.
**It DOES NOT**: reach non-adjacency (it is still `.includes()`), so the two
`Optimum Nutrition` rows survive it; and it does not carry a plural rule, so
`and ben jerry` survives it.
**The two halves are complementary**, exactly as the brief says. Nothing on that
branch is live.

---

## 8. THE TEST FILE S50's PR MUST CARRY — and the brief's hypothesis is REFUTED

File: `src/lib/mapping/__tests__/quantity-word-brand.test.ts`. **Not touched in S49.**

**[measured]** It carries two PORT NOTEs. The second says: *"The extraction must
change NOTHING except the refusal … these tests pin the plain
`.toLowerCase().includes()` form that this tree ships. If someone later folds the
containment check, the first test below goes red — which is the point."*

The brief asked me to verify a claim that would make that tripwire vacuous — that
the 18-row REPLAY fixture contains no row where a multi-token brand's tokens are
non-adjacent in `baseName`, so a token-set change would leave the test GREEN.

**REFUTED. [measured]** — `s49row3_fixture_tripwire.ts` replays all 18 REPLAY rows
(copied verbatim) through the shipped `preserveDroppedBrand()` and through
fold- and token-set variants of its body:

```
rows with a brand (the test's own population): 18 of 18
baseName disagreements vs shipped — fold: 3   token-set: 3
TRIPWIRE FIRES: the equivalence test goes RED on a containment change.
```

The three are `chick fil a spicy sandwich`, `coca cola` and `grilled cheese in n out`
— each shipping a self-doubled baseName (`"chick-fil-a chick fil a spicy sandwich"`)
that both variants collapse. There is also an explicit test,
`still uses a PLAIN lowercase includes(), not a canonical fold`, which hard-codes
those three doubled cache keys and would go red as well.

**So the PORT NOTE is accurate and the surviving comment does not assert anything
false.** Doc rules 1 and 2 are not violated today.

**But there IS a real gap, and it is a different one — the fixture cannot
DISTINGUISH the two candidate fixes.** Fold and token-set produce **identical**
results on all 18 rows (3 disagreements, the same 3 rows, the same outputs). The
fixture contains no non-adjacent case and no plural case, which are precisely the
two shapes that separate them (§7). **A green-or-red signal that is identical for
both candidates cannot gate the choice #167 has to make.**

**So S50's PR must still add the five census `rawLine`s to the REPLAY fixture** —
for this reason rather than the brief's — and re-write the PORT NOTE to say which
containment rule the tree now ships and what the fixture now separates.

**[measured]** House practice agrees: `gh pr view <n> --json files` counts
`__tests__` files — **#430: 4, #424: 2, #411: 1**. Every one carries its test file
in the same PR.

---

## 9. THE REFUTER QUESTION, answered in these words

> ***"Could this arm report SAME on a change that moves a composite winner?"***

**Yes. Five ways, and three of them are live for #167 specifically.**

1. **A winner that moves only on a line the pin does not contain.** The seed set is
   16 hand-cut lines, drawn from a census of what was ALREADY asked. #167 changes a
   containment rule that fires on every composite line carrying a brand — 15 of my
   18 items. The other ~8,000 distinct live lines are unsampled. This is the arm's
   biggest blind spot and it is not fixable by running it twice.

2. **A winner that moves only under a DIFFERENT SEGMENTATION.** Pinning is the
   arm's whole design, so by construction it cannot see an effect that needs another
   split. This is live and measured, not hypothetical: on `noodles and company pad
   thai` the segmenter drew `noodles and company` and nothing doubled, while the
   census row for that same line doubled under a `Noodles & Company` draw. **Pin a
   spelling on which the guard does not fire and the arm reports SAME on a row that
   is defective in production.** Mitigation: pin MULTIPLE draws per seed, or hand-write
   the pin file to include both brand spellings. I did neither; S50 should.

3. **A winner that moves only WARM.** `skipCache: true` forces cold resolution.
   #167 moves `baseName`, which is the `deriveMappingCacheKey()` input, so its most
   consequential effect is on the cache KEY and therefore on which stored row a warm
   line hits. This arm cannot see any of that, and a SAME here is not evidence the
   cached population is unchanged.

4. **A winner that moves only at the SAVE GATE.** `skipSave: true` plus the write
   guard mean `saveValidatedMapping()` never runs, so the brand-mismatch and
   plausibility gates never run. A changed baseName that production would reject at
   `save_rejected:brand_mismatch` reads here as a clean resolution.

5. **A real move hidden inside the noise floor.** Measured at 3 of 18 items on
   `foodId`. A two-tree diff that moves 1–3 winners is indistinguishable from the
   floor on this seed set. The guard channel (17/18) is tighter, which is why the
   gate should be read there first — but that channel cannot see a winner that moves
   for a reason other than a changed baseName.

**The honest summary**: this arm is a *sufficient* gate for the question "did the
guard's output change, and where", and an *insufficient* gate for "did any composite
winner move". It is strictly better than the documented gate, which fires zero times
— but the correct claim for S50's PR body is the narrow one, and it must be paired
with hand-written positive cases asserting the RIGHT answer (limitation (e)), not
merely a difference.

---

## Files left in the scratchpad

| file | what it is |
|---|---|
| `s49row3_pinned_composite_arm.ts` | **the arm** — `--mode pin\|replay\|diff`, `--dry` |
| `s49row3_seeds.txt` | the 16-line seed set |
| `s49row3_pin.json` | the pinned segmenter output (18 items) |
| `s49row3_armA.jsonl` / `s49row3_armB.jsonl` | the two same-tree noise-floor runs |
| `s49row3_predicate.ts` | the recovered predicate (`--set` is the right mode) |
| `s49row3_tokenizer_probe.ts` | the 3-rule tokenizer measurement |
| `s49row3_fixture_tripwire.ts` | the test-fixture tripwire measurement |
| `s49row3_guard_selftest.ts` | zero-risk write-guard proof |
| `s49row3_findings.md` | this file |

Deleted after use: `s49row3_import_probe.ts`, `s49row3_detector_debug.ts`.

## A brief inconsistency, flagged rather than silently resolved

The brief says *"This brief grants you NO `nosave=1` probe and NO ssh"*, and its
CRITICAL CONSTRAINT paragraph then explicitly permits one read-only ssh psql
command *"for bracketing purposes only — nothing else on the box"*. I took the
narrower, later, more specific grant: I ran exactly that one `SELECT count(*) FROM
"FoodMapping"` command, twice, and nothing else on the box.
