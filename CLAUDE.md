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

- **Never fix a mapping defect with an absolute gate.** A hard reject sets `winner = null` and falls through to AI backfill at `grams = servingResult?.grams ?? 100` — a different wrong number, not a right one. Preference order: **admit-only relaxation → relative demotion / sort reorder → confidence suppression → absolute gate.** Never subtract from `score` to demote (it drops confidence below `MIN_RERANK_CONFIDENCE` 0.70 and re-enters the null path).
- **`deriveMappingCacheKey` ≠ `canonicalizeCacheKey`** — the save path also appends identity discriminators (`white`/`yolk`, `cooked`/`whole`) and a brand prefix. You **cannot** join `MappingEventLog.normalizedForm` to `FoodMapping.normalizedForm`; the event log stores the pre-canonicalization name.
- **Anything the read-only eval tooling imports must come from `cache-key-core.ts`**, not `cache-key.ts` — the latter transitively loads `config.ts`, which warms ONNX. An import-graph test pins this.
- **Rank defects by distinct keys, not event count.** `save_rejected:cross_source_margin` is 71% of `save_rejected` events and is *incumbent protection* — it cannot fire on a cold key. Only `fixKind: 'pipeline'` classes in `scripts/eval/failure-classes.ts` may be handed to a fix-agent.
- **To diagnose:** retrieval questions → run `gatherCandidates` + `filterCandidatesByTokens` and print the pool. Ranking questions → delete the `FoodMapping` row and re-run the eval cold. A probe that reimplements the caller's argument list is a different function and its predicted *winner* is not evidence.

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
