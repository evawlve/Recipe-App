# Claude Code Project Guidelines — Recipe-App (Backend)

This is the **backend** repo: the Next.js API, Prisma schema/migrations, the ingredient-mapping pipeline (`src/lib/mapping/`), search (Typesense + pgvector), and the ingestion/eval scripts. It is a **separate git repository** from the mobile client (`KindaHealthyMobile`), not a subfolder of it.

## 📚 Read First (conventions live elsewhere)

Code, DB, and pipeline conventions are already documented — follow them, don't restate them here:
- **[AGENTS.md](AGENTS.md)** — Prisma/DB conventions, table naming, TypeScript style, agent workflows. **The critical one:** FDC foods key on integer `fdcId`, OFF keys on string `barcode` — never mix them.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — system overview.
- **`.agent/docs/`** — known-issues, debugging quickstart, ingredient-mapping-pipeline deep dive.
- **Mobile repo `sync-docs/mapping_investigation_playbook.md`** — how to diagnose a mapping defect without being wrong three times first, and what the eval gate *cannot* see. Read it before touching `src/lib/mapping/` or the cache.

## 🛠️ Commands

- **Dev**: `npm run dev` · **Build**: `npm run build` · **Start (prod)**: `npm run start`
- **Lint (CI parity)**: `npm run lint:ci` · **Typecheck**: `npm run typecheck` · **Test**: `npm run test`
- **Migration smoke test**: `npm run migrate:smoke`
- **Run one-off TS scripts** (ingestion, eval): via **`ts-node`**, NOT `tsx` — e.g. `ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/<name>.ts`. The eval harness lives in `scripts/eval/` (golden set + stress-latency).

## 💻 Machine & Sync Topology

Three machines linked by **Syncthing**: Mac laptop (mobile dev), Windows PC (secondary dev), and a headless Linux server — a Dell OptiPlex 5060, **`ssh owner@192.168.1.133`** (hostname `DHL32-Opt-5060`) — that actually runs this backend in Docker. The OptiPlex **replaced the old Mini-PC (user `diego`, `192.168.1.21`) on 2026-07-20**; the `.21` takeover plan was retired and `.133` is permanent. Any doc mentioning the Mini-PC means this box's predecessor.

- **Runtime services** (on the server): Next.js API on `:3000`, **Typesense** on `:8108` (current search provider — replaced Meilisearch), **PostgreSQL + pgvector** on `:5432` (source of truth + semantic-search embeddings). Supabase (cloud) handles auth. The API runs as a `recipe-api` systemd **user** service (`npm run start`, Node **v24.18.0 via nvm** — no system node), linger enabled.
- **The Postgres database is named `mealspire`** (not `recipe_app`), in container `mealspire-db`. Reach it with `docker exec mealspire-db psql -U postgres -d mealspire`. On `FoodMapping` the confidence column is **`aiConfidence`**, not `confidence`.
- **Production**: Vercel can't reach the server's raw LAN IP — public access must go through a Cloudflare Tunnel / reverse proxy, never the bare IP.
- Because Syncthing mirrors working trees but **git histories diverge per machine**, the same files often get committed independently on the Mac and Windows PC. See the workflow rules below.
- **`.env*` files are Syncthing-ignored** and machine-specific (server uses `localhost`, dev machines use the server's LAN IP). Never expect Syncthing to carry env values.

## ⚠️ Server Ops — rules that have actually bitten

Every rule here cost real downtime or real data at least once. See the mobile repo's `sync-docs/mapping_investigation_playbook.md` for the diagnostic method these sit alongside.

- **A source pull + service restart DEPLOYS NOTHING.** `recipe-api` runs `next start` against the prebuilt `.next`. You must `npm run build` on the box before `systemctl --user restart recipe-api`, or you will "verify a fix" against the old bundle.
- **NEVER `pkill -f "next start"`.** It matches the live `recipe-api`, any isolated gate server, **and its own command line** — it has taken production down. Kill by port:
  ```bash
  PID=$(ss -lptn "sport = :3100" | grep -o "pid=[0-9]*" | head -1 | cut -d= -f2); kill $PID
  ```
- **The box is DEPLOY-ONLY. Never run git mutations there** beyond `git fetch` and `git merge --ff-only`. **Never `git reset --hard`** — it destroys untracked keepers (the `.stignore` `/data` anchor, the box's local topology notes).
- **`git merge --ff-only` will ABORT** when a PR commits files that previously existed only as *untracked* Syncthing'd copies ("untracked working tree files would be overwritten"). Back them up, delete them, then merge — the committed versions supersede them. This happened on PR #154's five probe scripts and will recur on the Windows PC.
- **Eval and warm scripts write to the SHARED PRODUCTION DB.** There is no staging copy. Always `pg_dump -t '"FoodMapping"'` first, and **diff with a Python dict compare, never `join`** — `join(1)` silently drops rows to collation differences, which reads as "nothing changed".
- **Isolated gate recipe** (test a branch without touching the live service): rsync the tree to a scratch dir → hardlink `node_modules` → `prisma generate` → `npm run build` → `setsid nohup env PORT=3100 npm run start` → run the eval with `--base http://localhost:3100` → kill **by port**.

## 🧭 Mapping-pipeline change rules

Condensed from the 2026-07 campaign; full reasoning in the playbook doc named above.

- **Never fix a mapping defect with an absolute gate.** A hard reject sets `winner = null` and falls through to AI backfill at `grams = servingResult?.grams ?? 100` — a different wrong number, not a right one. Preference order: **admit-only relaxation → relative demotion / sort reorder → confidence suppression → absolute gate.** Never subtract from `score` to demote (it drops confidence below `MIN_RERANK_CONFIDENCE` 0.70 and re-enters the null path). **That order ranks blast-radius shape, not safety — neither of the top two is safe by inspection.** Admit-only converts pre-existing wrong picks into *cached* ones, and a new tie-break tier is a global reordering of every tie in the population (8 wrong-direction flips, measured: `apricot`→`apricots`, `tomato`→`tomatoes`, `cheese`→`Cheese`). Both need a pipeline-level before/after winner diff, and these rules bind the eval tooling's ranking code (`cache-parity-sweep.ts` `rankKey`) too — playbook §3 and §5a carry the receipts.
- **`deriveMappingCacheKey` ≠ `canonicalizeCacheKey`** — the save path also appends identity discriminators (`white`/`yolk`, `cooked`/`whole`) and a brand prefix. You **cannot** join `MappingEventLog.normalizedForm` to `FoodMapping.normalizedForm`; the event log stores the pre-canonicalization name.
- **Anything the read-only eval tooling imports must come from `cache-key-core.ts`**, not `cache-key.ts` — the latter transitively loads `config.ts`, which warms ONNX. An import-graph test pins this.
- **Rank defects by distinct keys, not event count.** `save_rejected:cross_source_margin` is 71% of `save_rejected` events and is *incumbent protection* — it cannot fire on a cold key. Only `fixKind: 'pipeline'` classes in `scripts/eval/failure-classes.ts` may be handed to a fix-agent.
- **To diagnose:** retrieval questions → run `gatherCandidates` + `filterCandidatesByTokens` and print the pool. Ranking questions → delete the `FoodMapping` row and re-run the eval cold. A probe that reimplements the caller's argument list is a different function and its predicted *winner* is not evidence.
- **A rule may only EVICT if what it detects is a property of the MAPPING — of which record we chose — not of a stage downstream of it.** `FoodMapping` is identity-only: no grams column, servings resolve fresh per request via `hydrateAndSelectServing`. So a serving-weight rule (`D5`/`D6`) can never justify a delete — it discards a correct identity and re-resolves the same weight. Retired as evictors in PR #178, and `scripts/eval/__tests__/correctness-screen.test.ts` now asserts the rule over `POLICIES`, so adding a serving-stage rule to an evict set fails CI. `D7` still evicts under `strict`, because an inconsistent panel *is* a property of the chosen record.
- **A fixture number is a claim about the fixture, never about the population.** `D1` (bare-brand key) scores **100% precision on the 81-row batch-01 fixture** — 1/23 BAD, 0/48 GOOD — and **false-evicts at 73.8% on the real 3,248-row cache**, because batch 01 is a store-brand batch while the cache is full of `sprite`, `fritos`, `oikos`, `rice krispies`, where the brand IS the food. Before wiring any rule to a destructive action, run it on the population and **decompose the flagged set by evidence source** (that read was D1 73.8% / D4 55% / D3 45.5% / D9 8.3% / D8 0.0% — raw fire count told you nothing). `D1_FALSE_EVICT_RATE_REAL_CACHE` is exported and asserted so this cannot be re-litigated from the fixture.

## 🔬 Screening the cache: Claude Code agents, not OpenRouter

**As of 2026-07-27 the whole-cache screen runs as Claude Code subagents on Diego's plan.** `correctness-screen.ts` keeps its OpenRouter Tier-L path for one-off runs — do not delete it — but do not use it to screen the population.

- **The reason is coverage, not cost.** The old design triaged every row with `gpt-4o-mini` and adjudicated only the flagged subset with a stronger model, so **the cheap model's misses were reviewed by nothing.** Running Sonnet over all 3,248 rows found **146 rows the old pipeline had never flagged**, 32 of which `gpt-4o-mini` had explicitly kept. Reading those 32 surfaced an entire silent 5–10× under-billing class. A triage tier is a coverage decision wearing an efficiency costume.
- **Batching does NOT contaminate verdicts.** Measured, because it was the stated objection: 81 rows in one agent context scored *identically* to 9 rows per context (both 21/23 BAD, **0/48 GOOD destroyed**). Agents cost ~1 extra missed BAD versus API-Sonnet and destroy zero GOOD in every arm.
- **Prompts must be byte-identical to the shipped rubric** — `_dump_cache_prompts.ts` emits the real `LLM_SYSTEM` + `llmUserPrompt`. A paraphrased rubric measures the paraphrase.
- **Attribution is PINS ONLY.** `attribute()`'s Jaccard fallback guesses a nearest seed and manufactures identity mismatches — 44.8% false-evict versus 26.8% for pinned rows. An unpinned row gets an EMPTY phrase.
- **Tell the judge two things the rubric does not**, both measured causes of false rejections: an unpinned key is **token-SORTED** so word order is meaningless (`butter honey jif peanut` is the key for `jif honey peanut butter`), and a record that is **less specific** than the query is not a different food.
- **Reconcile before believing totals:** 0 missing, 0 duplicate, 0 failed batches. Silent truncation reads as full coverage.

Full method, the bake-off table, and the four recurring instrument-failure classes are in the mobile repo's `sync-docs/mapping_investigation_playbook.md` §10 and §11.

## 🧪 Corpus corruption detectors

- **Find the SHAPE, then restrict STRUCTURALLY. Never threshold the value.** Worked example, `scripts/eval/detect-panel-scale-divided.ts` (PR #179): the OFF chain import divides the whole per-100 g panel — macros included — by `servingGrams/100`, so a Jersey Mike's Giant and Regular **bill an identical 173 kcal** against true ~1,831 and ~937. 3,173 rows across 55 chains.
- **Three detectors for it are refuted by measurement — do not retry them.** *Atwater cross-check*: the rows are Atwater-**perfect**, because the macros were divided too. *kJ/kcal unit slip*: same refutation, a unit slip leaves macros alone. *Any absolute kcal or energy-density floor*: the corrupt 785 g sub is 0.21 kcal/g and White Claw is 0.028 kcal/g — **a floor low enough to catch the sub hits the legitimate seltzer first.**
- **What works:** a per-family log-log slope (`regr_slope(ln kcal100, ln servingGrams)` in `[-1.15,-0.85]`, `r² ≥ 0.95`) — a per-100 g density is *intensive*, so it cannot depend on serving mass — plus a **structural** `length(barcode) > 13` restriction to the synthetic-barcode chain import. Unrestricted the FP rate is 10%, and the FP mode is portion-standardized retail families producing the identical −1 slope. White Claw and Truly survive *structurally* (single can size ⇒ they never form a multi-size family), which is a far stronger property than a threshold that happens to sit below them.
- **Guarding the OUTPUT with an absolute number is legitimate; guarding the DETECTION with one is not.** Refuse any repair whose result would be physically impossible (kcal/100g > 900, macro sum > `MAX_MACRO_SUM_100G`) and **count the refusals, never drop them** — the guard caught a real false positive on run one.
- **An empty grouping key merges unrelated foods.** Non-Latin names strip to `''`, fusing brand `Нз`'s *Паста* (459 kcal/100g, S=50) with *Пържола* (107, S=186) at slope −1.11, r² 1.00. `familyKey()` returns null and the 1,731 excluded rows are printed. Whenever you build a key by stripping tokens, handle the case where the strip removes everything.
- **The existing detectors are blind to this class:** `detect-corrupt-panel.ts` rescales by `×100/S`, the *opposite* direction, and needs ≥4 name-siblings; `detect-corrupt-nutrition.ts` is entirely upper bounds.

## 🔁 Git & CI Workflow

- **`master` is branch-protected — you CANNOT push to it directly.** Push work to a branch (`git push origin master:<branch>`), open a PR (`gh pr create`), get CI green, then merge (`gh pr merge <#> --merge`). When GitHub `master` is a stale snapshot the local tree deliberately supersedes, tie the histories with `git merge -s ours origin/master` before pushing.
- **Syncthing divergence**: a push rejected as non-fast-forward is almost always because another machine committed the same Syncthing-mirrored source — not a real conflict. `git fetch`, confirm the only real diffs are `package-lock.json` / `sync-docs/**`, then `git merge` (**never force-push**).
- **Required status checks (both must be green to merge): `build` and `Vercel`.** The PR stays `mergeStateStatus: BLOCKED` until they pass — check with `gh pr checks <#>` and `gh pr view <#> --json mergeable,mergeStateStatus`.

### CI checks & known gotchas (`.github/workflows/`)
- **`build`** (`ci.yml`) — `lint:ci` + `typecheck` + `next build`. Run `npm run build` locally before pushing build/config changes.
- **`Vercel`** — enforces Vercel's **250MB uncompressed serverless-function limit**. Keep the ONNX/transformers stack (`@huggingface/transformers` + `onnxruntime-node`/`-web`, ~390MB of native binaries) OUT of function bundles via `outputFileTracingExcludes` in `next.config.ts`. Semantic search is opt-in (`SEMANTIC_SEARCH_ENABLED`, default off) and only runs on the self-hosted deployment, so excluding it from the trace is safe. Don't reach for the `VERCEL_SUPPORT_LARGE_FUNCTIONS` beta flag — shrink the bundle instead.
- **`migrate-smoke`** (`migrate-smoke.yml`, runs on `prisma/**` changes) — Prisma shadow-DB migration test. Its Postgres **service image must be `pgvector/pgvector:pg16`** (matches prod); plain `postgres:15` lacks the `vector` extension control file and fails with `P3006` on the embedding migration.
- **`check`** (`env-example-check.yml`) — `scripts/check-env-example.js` fails if any `process.env.X` referenced in `src/**` is missing from `.env.example`. Add new env vars there (with a comment) in the **same PR** that introduces them.
- Other checks (`bench`, `danger`, `size`) are non-blocking.
