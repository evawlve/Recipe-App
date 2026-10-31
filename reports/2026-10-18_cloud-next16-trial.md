# cloud-34 — `next` 15 → 16 trial (backend)

- **Run:** 2026-10-18 UTC, cloud session working from the GitHub checkout only. No box, DB, Typesense or secrets were used, and no live API was called.
- **Branch:** `cloud/next16-trial`, off `origin/master` @ `06964c7c` (Merge PR #507). **PR #512, `DO NOT MERGE —`, left open.**
- **Dependabot #278:** `git ls-remote origin refs/pull/278/head` → `956f1e50ca45a825951b5084f1dd5e5bed0625d6`, the same head the brief recorded. Neither #278 nor its branch was touched.
- **Preflight:** the repo was not shallow (no unshallow needed); `git fetch origin master` exited 0; `git show origin/master:package.json | grep -c '"next": "\^15'` → `1`.
- **Node:** every gate ran on **node v20.20.0 / npm 10.8.2** (`/opt/node20`) to match `ci.yml` (`node-version: '20'`). The container default is v22.22.0. MGR's refuter read used node 22.
- **Version taken:** `npm view next versions` → newest 16.x stable is **16.4.2** (dist-tag `latest`; 16.4.0, 16.4.1 and 16.4.2 follow 16.3.8). **#278 pinned 16.3.1.**
- **The question, answered:** `master` builds, tests and passes CI on next 16.4.2 with **4 files changed and zero `src/**` edits**, provided the production build stays on **webpack**. Verdict in §5: **adopt after** two named prerequisites. It is not worth doing as an urgent change, because 15.5.x still receives backports.

## 1. Gates

`npm ci`; `npm run prisma:generate`; `npm run lint:ci`; `npm run typecheck`; `DATABASE_URL="postgresql://x:y@localhost:5432/z" npm run build > <file> 2>&1; echo "exit=$?"`; `env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="postgresql://x:y@localhost:5432/z" npm run test:ci > <file> 2>&1; echo "exit=$?"`. No gate was piped through `tail`.

| gate | BEFORE (`origin/master` 06964c7c, next 15.5.12) | AFTER (`cloud/next16-trial` a56d23cf, next 16.4.2) |
|---|---|---|
| `npm ci` | exit 0 | exit 0 (fresh `rm -rf node_modules` first) |
| `prisma:generate` | exit 0 | exit 0 |
| `lint:ci` | exit 0 — 423 problems (0 errors, 423 warnings) | exit 0 — 423 problems (0 errors, 423 warnings) |
| `typecheck` | exit 0 | exit 0 |
| `build` | exit 0 (`next build`, webpack) | exit 0 (`next build --webpack`) |
| `test:ci` (env -i) | exit 0 — 297/297 suites, 6548 passed, 1 skipped | exit 0 — 297/297 suites, 6548 passed, 1 skipped |

Supporting reads:
- **#278's failure, reproduced:** plain `npx next build` on the bump commit (`571e2e43`) exits **1** with `⨯ ERROR: This build is using Turbopack, with a \`webpack\` config and no \`turbopack\` config.`
- **`tsc` without `.next`:** CI runs `typecheck` before `build`, so the regenerated `next-env.d.ts` imports `.next/types/*.d.ts` files that a clean checkout does not yet have. I checked `npx tsc --noEmit` with `.next` absent and `tsconfig.tsbuildinfo` removed. It exits 0 with both the new and the old `next-env.d.ts`.
- **Idempotence:** a second `npm run build` on `a56d23cf` printed no "reconfigured your tsconfig.json" note and left `git status` clean.
- **New build warnings under 16** (they do not fail the build):
  - `⚠ \`images.domains\` is deprecated in favor of \`images.remotePatterns\``
  - `⚠ React 18 support is deprecated in Next.js 16 and will be removed in Next.js 17. Please upgrade to React 19.`
  - `⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.`
  - The webpack build gives 4 "Node.js API ... not supported in the Edge Runtime" warnings, against 2 on master. The two new ones come from next's own `next/dist/esm/server/app-render/dynamic-rendering.js` (`process.cwd`), reached through `next/server` in the Edge middleware bundle. The two Supabase ones were already there.

## 2. Commits (each with the upstream note it answers)

Upstream source: the Next 16 upgrade guide at the shipped tag, [`docs/01-app/02-guides/upgrading/version-16.mdx` @ v16.4.2](https://github.com/vercel/next.js/blob/v16.4.2/docs/01-app/02-guides/upgrading/version-16.mdx). I read it via raw.githubusercontent.com because `nextjs.org` is not reachable from this container (proxy `CONNECT 403`). **The 16.0 → 16.4 release notes on github.com/vercel/next.js/releases were also unreachable** (HTTP 403 on both the API and the HTML pages), so nothing below relies on them.

| commit | files | what | upstream note |
|---|---|---|---|
| `571e2e43` | `package.json`, `package-lock.json` | `next` `^15.5.12` → `^16.4.2` (`^` style kept). React stays 18.3.1. | next@16.4.2 `peerDependencies.react` = `"^18.2.0 \|\| 19.0.0-rc-de68d2f4-20241204 \|\| ^19.0.0"`; `engines.node` = `">=20.9.0"`. Guide: "Node.js 20.9+ — Minimum version now `20.9.0` (LTS)". |
| `4204c0b3` | `package.json` | `"build": "next build --webpack"` (`build:no-telemetry` left as found) | Guide, *Turbopack by default*: "If your project has a custom `webpack` configuration and you run `next build` (which now uses Turbopack by default), the build will **fail** to prevent misconfiguration issues." … "**Keep using Webpack:** Use the `--webpack` flag to opt out of Turbopack and build with Webpack." |
| `a56d23cf` | `tsconfig.json` (CRLF kept), `next-env.d.ts` (LF) | `jsx: preserve → react-jsx`; include `.next/dev/types/**/*.ts`; `next-env.d.ts` reference-path → `import "./.next/types/routes.d.ts"` + `import "./.next/types/root-params.d.ts"` | Build output: "mandatory changes … jsx was set to react-jsx (next.js uses the React automatic runtime)"; "suggested … include was updated to add '.next/dev/types/**/*.ts'". Guide, *Concurrent `dev` and `build`*: "`next dev` and `next build` now use separate output directories … The `next dev` command outputs to `.next/dev`." |

- Total change set: **4 files**. There are **no** `src/**`, `prisma/**`, `.github/**`, `.env*` or `scripts/**` edits. No codemod was run and `middleware` was not renamed.
- `tsconfig.json` came back from `next build` as LF, which made the whole file show as changed. I restored CRLF (`git show origin/master:tsconfig.json` was the reference), so the committed diff is 3 lines.
- **Transitive lockfile moves** (47 entries, all from `next`; no other package was bumped):
  - `@next/env` and the 9 `@next/swc-*` binaries: 15.5.12 → 16.4.2
  - `@swc/helpers` 0.5.15 → 0.5.23
  - `postcss` 8.5.6 → 8.5.23 (`next/node_modules/postcss` 8.4.31 removed)
  - `postcss/node_modules/nanoid` 3.3.11 → 3.3.20 (`next/node_modules/nanoid` removed)
  - `semver` 7.7.3 → 7.8.5
  - `baseline-browser-mapping` 2.8.21 → 2.11.29
  - `@emnapi/runtime` 1.11.2 → 1.11.3
  - `@img/colour` 1.0.0 → 1.1.0
  - **a new nested `next/node_modules/sharp` 0.35.5**, with its 22 `@img/sharp-*` platform packages
  - `@img/sharp-freebsd-wasm32` and `@img/sharp-webcontainers-wasm32`, both 0.35.5
- `eslint-config-next` is still 15.0.0 and was not bumped. `lint:ci` is unaffected because it calls `eslint .` directly, not `next lint`, which the guide says "has been removed".

**STOPPED edits:** none needed. The change stayed within the 5-file cap and touched no fenced path.

## 3. Size and behaviour — three builds, `rm -rf .next` before each

- **BEFORE:** `npm run build` on master (next 15.5.12, webpack).
- **AFTER-webpack:** `npm run build` on `a56d23cf`.
- **AFTER-turbopack:** `npx next build --turbopack` on `a56d23cf` (measured only, not committed; exit 0, "✓ Compiled successfully in 7.3s", against 12.7s for webpack).

Traced bytes are the on-disk sizes of every file listed in each API route's `route.js.nft.json`, plus the `route.js` itself, summed by a node script kept outside the checkout. Only `*.js` and `.nft.json` were read. Every traced path resolved, with 0 missing in all three builds.

| | BEFORE | AFTER-webpack | AFTER-turbopack |
|---|---:|---:|---:|
| API routes traced | 61 | 61 | 61 |
| largest route (all three: `api/recipes/[id]`) | 38.0 MB | 38.8 MB | 46.3 MB |
| median route | 36.0 MB | 36.8 MB | 44.2 MB |
| routes over 200 MB | **none** | **none** | **none** |
| `.next/server` `*.js` files / total | 229 / 3.76 MB | 228 / 3.73 MB | 548 / 3.78 MB |
| largest server `.js` | `app/api/auth/signup/route.js` 810 KB | same, 811 KB | `chunks/_1wrmb8z2eh2-s._.js` 808 KB |
| ONNX/transformers files traced | 0 | 0 | 5 refs, all to one **229-byte** externals stub (see below) |

**Where Turbopack's extra ~7.5 MB per route comes from** (`api/recipes/[id]` broken down by package):
- `@prisma/client` traces **7.46 MB** under Turbopack against **0.19 MB** under webpack. Turbopack traces every Prisma runtime variant (`query_engine_bg.mysql.wasm`, and so on).
- `.prisma` (the engine) is ~34.3 MB under both bundlers, so it is not the cause.
- This is still far under 250 MB, but it is about +20% per function.

**`outputFileTracingExcludes` still keeps the ONNX/transformers stack out under both bundlers.** Under Turbopack, five routes trace one file, `chunks/[externals]_@huggingface_transformers_05bd-zziu8167._.js` (229 bytes). It contains `a.y("@huggingface/transformers-31f28a0eb9b916d1")`, which resolves through a build-time symlink `.next/node_modules/@huggingface/transformers-31f28a0eb9b916d1 -> ../../../node_modules/@huggingface/transformers`. The five routes are `nlp/parse`, `foods/search`, `recipes`, `recipes/[id]` and `recipes/[id]/auto-map`. None of `@huggingface/**` or `onnxruntime-*` is traced.
- **Behaviour difference (Turbopack only):** server externals resolve through hashed symlinks in `.next/node_modules/`, which also covers `@prisma/client` and `@aws-sdk/*`. Webpack resolves them through a plain `require` from `node_modules`. On the box, which runs `next start` from the checkout, the symlinks resolve.
- Webpack's `ignore-loader` / `externals` rules for `data/usda/*.json` are **ignored** by Turbopack. This is harmless today: the only reader, `src/lib/usda/reader.server.ts:5`, opens `data/usda/fdc.json` with `fs` at runtime and does not `import` it. It is still a second reason the committed bundler is webpack.

**`removeConsole` probe:** `grep -rl --include='*.js' '<string>' .next/server | wc -l`

| string | origin | BEFORE | AFTER-webpack | AFTER-turbopack | expected |
|---|---|---:|---:|---:|---|
| `Created mapping:` | `console.log`, `src/app/api/foods/map/route.ts:119` | 0 | 0 | 0 | 0 |
| `Admin food stats error:` | `console.error`, `src/app/api/admin/food-stats/route.ts:159` | 1 | 1 | 1 | ≥ 1 |
| `User lookup error:` | `console.error`, `src/app/api/users/[username]/route.ts:69` | 1 | 1 | 1 | ≥ 1 |

`compiler.removeConsole` still strips `console.log` and keeps `console.error` under both bundlers. The controls show the routes were compiled, so the 0 is not an empty grep.

**Vercel on PR #512:** success on `a56d23cf`, see §4.

<details><summary>Per-route traced MB, all 61 API routes</summary>

| route | BEFORE MB | AFTER-webpack MB | AFTER-turbopack MB |
|---|---:|---:|---:|
| `api/recipes/[id]` | 38.0 | 38.8 | 46.3 |
| `api/recipes/bulk-delete` | 37.4 | 38.2 | 45.7 |
| `api/photos/[id]` | 37.4 | 38.2 | 45.7 |
| `api/nlp/parse` | 37.0 | 37.8 | 44.9 |
| `api/recipes` | 36.6 | 37.4 | 44.9 |
| `api/recipes/[id]/auto-map` | 36.5 | 37.3 | 44.8 |
| `api/foods/search` | 36.5 | 37.3 | 44.5 |
| `api/foods/barcode` | 36.1 | 36.9 | 44.4 |
| `api/nutrition` | 36.1 | 36.9 | 44.4 |
| `api/recipes/[id]/ingredients` | 36.1 | 36.9 | 44.4 |
| `api/recipes/[id]/compute-nutrition` | 36.1 | 36.9 | 44.4 |
| `api/recipes/[id]/comments` | 36.0 | 36.8 | 44.3 |
| `api/foods/quick-create` | 36.0 | 36.8 | 44.3 |
| `api/foods/[id]/aliases` | 36.0 | 36.8 | 44.3 |
| `api/foods/[id]/units` | 36.0 | 36.8 | 44.3 |
| `api/comments/[id]` | 36.0 | 36.8 | 44.3 |
| `api/account/username` | 36.0 | 36.8 | 44.3 |
| `api/foods/[id]` | 36.0 | 36.8 | 44.3 |
| `api/foods/map` | 36.0 | 36.8 | 44.3 |
| `api/fatsecret/barcode` | 36.0 | 36.8 | 44.3 |
| `api/recipes/[id]/suggestions` | 36.0 | 36.8 | 44.2 |
| `api/account/delete` | 36.0 | 36.8 | 44.2 |
| `api/follow/[userId]` | 36.0 | 36.8 | 44.2 |
| `api/recipes/[id]/like` | 36.0 | 36.8 | 44.2 |
| `api/admin/food-stats` | 36.0 | 36.8 | 44.2 |
| `api/ok` | 36.0 | 36.8 | 44.2 |
| `api/feed/foryou` | 36.0 | 36.8 | 44.2 |
| `api/account` | 36.0 | 36.8 | 44.2 |
| `api/recipes/[id]/similar` | 36.0 | 36.8 | 44.2 |
| `api/discover/suggest-creators` | 36.0 | 36.8 | 44.2 |
| `api/feed/following` | 36.0 | 36.8 | 44.2 |
| `api/recipes/[id]/tags/accept` | 36.0 | 36.8 | 44.2 |
| `api/tags` | 36.0 | 36.8 | 44.2 |
| `api/recipes/[id]/view` | 36.0 | 36.8 | 44.2 |
| `api/recipes/[id]/save` | 36.0 | 36.8 | 44.2 |
| `api/users/[username]` | 36.0 | 36.8 | 44.2 |
| `api/users/search` | 36.0 | 36.8 | 44.2 |
| `api/notifications/read` | 36.0 | 36.8 | 44.2 |
| `api/follow/state` | 36.0 | 36.8 | 44.2 |
| `api/notifications` | 36.0 | 36.8 | 44.2 |
| `api/discover/popular` | 36.0 | 36.8 | 44.2 |
| `api/notifications/unread-count` | 36.0 | 36.8 | 44.2 |
| `api/me/saved/bulk-delete` | 36.0 | 36.8 | 44.2 |
| `api/me/saved` | 36.0 | 36.8 | 44.2 |
| `api/me/followers` | 36.0 | 36.8 | 44.2 |
| `api/me/uploaded` | 36.0 | 36.8 | 44.2 |
| `api/whoami` | 36.0 | 36.8 | 44.2 |
| `api/me/following` | 36.0 | 36.8 | 44.2 |
| `api/foods/[id]/serving` | 35.7 | 36.5 | 43.9 |
| `api/admin/cron/similar` | 35.5 | 36.3 | 43.8 |
| `api/admin/cron/rollup` | 35.5 | 36.3 | 43.8 |
| `api/search/suggest` | 35.5 | 36.3 | 43.8 |
| `api/health` | 35.5 | 36.3 | 43.7 |
| `api/upload` | 2.5 | 3.3 | 3.3 |
| `api/image/[...key]` | 2.5 | 3.3 | 3.3 |
| `api/auth/signup` | 2.3 | 3.1 | 3.1 |
| `api/auth/signin` | 1.6 | 2.4 | 2.3 |
| `api/auth/reset-password` | 1.6 | 2.4 | 2.3 |
| `api/debug/foods` | 1.1 | 1.9 | 1.9 |
| `api/sentry-example-api` | 1.1 | 1.9 | 1.9 |
| `api/oops` | 1.0 | 1.8 | 1.8 |

</details>

## 4. CI on PR #512

Read with the GitHub MCP tool (`pull_request_read`) on head `a56d23cf` (the last code commit; this report commit changes only `reports/`):

| check | conclusion |
|---|---|
| **Vercel** (required) | **success** — "Deployment has completed" (16:29:42Z). Vercel ran the package `build` script, i.e. `next build --webpack`; the 250 MB function limit held. |
| **build** (required) | **success** — job 117727454761 (run 39145178237), node 20: `prisma:generate` + `lint:ci` + `typecheck` + `test:ci` + `next build --webpack`. No `next/font` flake re-run was needed. |
| Danger | success — "All green. Yay." |
| size | success |
| Vercel Preview Comments | success |

## 5. Verdict — **adopt after: (a) Diego decides the `images` block below, and (b) the React 19 upgrade is scheduled as its own trial before Next 17**

Evidence:
- **It works on webpack with no source change.** All six gates exit 0 on node 20, the test count matches master, and the lint warning count is unchanged at 423.
- **Deployment is safe on size and logging.** Every function is under 39 MB traced on webpack, ONNX stays excluded, and `removeConsole` behaves as before.
- **Turbopack is viable, but it is not the bundler to commit.** It is about 1.7× faster to compile (7.3 s vs 12.7 s), but it ignores the `webpack` hook and adds about 20% per function from Prisma runtime variants. Moving to it would mean migrating the `data/usda` rules (into a `turbopack` key, or deleting them because they are dead) as its own change.
- **No urgency.** 15.5 is still being backported: dist-tag `backport` = **15.5.28**, while the lockfile pins 15.5.12. Next 16 also deprecates React 18 ("will be removed in Next.js 17"), so a 16 adoption is the first of two steps, not the last.
- **If Diego prefers to defer**, the low-risk alternative is a refresh within `^15`: `npm install next@15.5.28` (lockfile only, since the range already allows it), which picks up the backported fixes without the 16 behaviour changes below. I did not measure it here.

**For Diego — decide, do not let an agent edit** (`next.config.ts` `images` block: `remotePatterns` CloudFront + `hostname: '**'`, `domains: ['localhost']`, `unoptimized: false`; 10 files under `src` import `next/image`):
- **`qualities` default → `[75]` (breaking).** Guide: "The default value for `images.qualities` has changed from allowing all qualities to only `[75]`." … "a `quality` prop of 80, is coerced to 75" … "unsupported `q` values return `400`."
  - `src/components/recipe/RecipeCardImage.tsx:45` uses `quality={80}`, which will silently become 75.
  - `PhotoGallery.tsx:210` uses `quality={75}`, which is unaffected.
- **`minimumCacheTTL` 60 s → 4 h (breaking).** Guide: "The default value for `images.minimumCacheTTL` has changed from `60 seconds` to `4 hours` (14400 seconds)."
- **`imageSizes` drops `16` (breaking).** Guide: "The value `16` has been removed from the default `images.imageSizes` array."
- **Local IP restriction (breaking).** Guide: "A new security restriction blocks local IP optimization by default. Set `images.dangerouslyAllowLocalIP` to `true` only for private networks." This touches `domains: ['localhost']` and any optimization of LAN-hosted images.
- **`maximumRedirects` unlimited → 3 (breaking).** Guide: "The default for `images.maximumRedirects` has changed from unlimited to 3 redirects maximum."
- **`images.domains` deprecated.** Guide: "The `images.domains` config is deprecated." The build prints the warning above. `localhost` would move into `remotePatterns`.

**For Diego — `middleware` → `proxy` deprecation: the rename is NOT a fix here.**
- `src/middleware.ts` runs on the Edge runtime: there is no `runtime` export, and the build compiles it as an Edge bundle (the Edge-runtime warnings above).
- Guide: "The `edge` runtime is **NOT** supported in `proxy`. The `proxy` runtime is `nodejs`, and it cannot be configured. If you want to continue using the `edge` runtime, keep using `middleware`."
- The guide's own checklist: "Edge middleware is not blindly renamed to proxy." The warning is expected and should stay until there is a deliberate Edge→Node decision.

After any merge the box does NOT receive this change by Syncthing — the backend `.stignore` ignores `package-lock.json` and `node_modules` (`grep -nxE 'node_modules|package-lock.json' .stignore`). Before the next box build: `scp package-lock.json` to `/home/owner/Recipe-App/`, verify with `git hash-object` on both ends, `npm ci` there, then the deploy recipe with its content proof. A Lane A or Diego step, never this session's.

(`.stignore` here: line 1 `node_modules`, line 11 `package-lock.json`. Also, on the box `npm run build` now means `next build --webpack`. That is the committed script, so the deploy recipe itself does not change.)

PR #278 is superseded by this trial branch only if Diego says so; it stays open.
