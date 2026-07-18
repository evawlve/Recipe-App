# Claude Code Project Guidelines — Recipe-App (Backend)

This is the **backend** repo: the Next.js API, Prisma schema/migrations, the ingredient-mapping pipeline (`src/lib/mapping/`), search (Typesense + pgvector), and the ingestion/eval scripts. It is a **separate git repository** from the mobile client (`KindaHealthyMobile`), not a subfolder of it.

## 📚 Read First (conventions live elsewhere)

Code, DB, and pipeline conventions are already documented — follow them, don't restate them here:
- **[AGENTS.md](AGENTS.md)** — Prisma/DB conventions, table naming, TypeScript style, agent workflows. **The critical one:** FDC foods key on integer `fdcId`, OFF keys on string `barcode` — never mix them.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — system overview.
- **`.agent/docs/`** — known-issues, debugging quickstart, ingredient-mapping-pipeline deep dive.

## 🛠️ Commands

- **Dev**: `npm run dev` · **Build**: `npm run build` · **Start (prod)**: `npm run start`
- **Lint (CI parity)**: `npm run lint:ci` · **Typecheck**: `npm run typecheck` · **Test**: `npm run test`
- **Migration smoke test**: `npm run migrate:smoke`
- **Run one-off TS scripts** (ingestion, eval): via **`ts-node`**, NOT `tsx` — e.g. `ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/<name>.ts`. The eval harness lives in `scripts/eval/` (golden set + stress-latency).

## 💻 Machine & Sync Topology

Three machines linked by **Syncthing**: Mac laptop (mobile dev), Windows PC (secondary dev), and a headless Linux server (the **Mini-PC**, migrating to a Dell OptiPlex 5060) that actually runs this backend in Docker.

- **Runtime services** (on the server): Next.js API on `:3000`, **Typesense** on `:8108` (current search provider — replaced Meilisearch), **PostgreSQL + pgvector** on `:5432` (source of truth + semantic-search embeddings). Supabase (cloud) handles auth. The API runs as a `recipe-api` systemd **user** service (`npm run start`, Node **v24.18.0 via nvm** — no system node), linger enabled.
- **Production**: Vercel can't reach the server's raw LAN IP (`192.168.1.21`) — public access must go through a Cloudflare Tunnel / reverse proxy, never the bare IP.
- Because Syncthing mirrors working trees but **git histories diverge per machine**, the same files often get committed independently on the Mac and Windows PC. See the workflow rules below.

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
