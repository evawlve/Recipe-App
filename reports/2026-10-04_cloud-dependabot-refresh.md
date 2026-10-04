# cloud-21: the Dependabot bumps, refreshed off `master` and CI-gated (2026-10-04)

Written by cloud session cloud-21. Four open August Dependabot PRs (#277, #279, #280, #281) were behind `master`; this session re-cut three of them as fresh branches off `origin/master` `a2c7b764` (the #463 merge), ran the gates before and after, opened three PRs and left them OPEN. #278 (`next` 15 → 16) is HELD and untouched, §5 says why. The three PRs are **superseding** PRs: nothing was pushed to any `dependabot/*` branch, and #277/#279/#280/#281 should be closed by hand when their replacement merges.

- **Tree.** `evawlve/Recipe-App` `origin/master` at `a2c7b764`. Container node v22.22.0, npm 10.9.4. CI's `build` job runs node 20 (`.github/workflows/ci.yml`); the box runs node v24.
- **Labels.** "Measured" means a command run in this checkout on 2026-10-04. "CI" means the GitHub check on the PR head. "Not run" means the step needs the box, the preview URL or a phone, and this session had none of them.
- **Not this session's:** merging, the Vercel preview sign-in, the box `npm ci` + deploy, the mobile bearer call. §4 names who.

## 0. The PRs

| PR | branch | package | from → to | CI (`build` + `Vercel`) | breaking notes | importers | Diego checks by hand | recommendation |
|---|---|---|---|---|---|---|---|---|
| [#466](https://github.com/evawlve/Recipe-App/pull/466) (supersedes #279, #281) | `cloud/deps-small` | `@radix-ui/react-checkbox` | 1.3.3 → 1.3.11 | **green** (`build` ✓ 15:17Z, `Vercel` ✓, `danger` ✓, `size` ✓) | none; `index.d.ts` byte-identical; runtime: bubble-input `change` now bubbles only on user interaction | 1: `src/components/ui/checkbox.tsx` (← `SelectableRecipeCard.tsx`) | nothing beyond a glance at the recipe multi-select on the preview | **merge** |
| #466 | `cloud/deps-small` | `@testing-library/react` | 16.3.0 → 16.3.2 | (same PR) | none; 16.3.1 trusted publishing, 16.3.2 `onCaughtError` type for React 19 | 0 in `src/`, `scripts/` | nothing | **merge** |
| [#468](https://github.com/evawlve/Recipe-App/pull/468) (supersedes #280) | `cloud/deps-hookform-resolvers` | `@hookform/resolvers` | 3.10.0 → **5.9.1** (MAJOR ×2) | **green** (`build` ✓ 15:21Z, `Vercel` ✓, `danger` ✓, `size` ✓) | 4.0.0: AJV `errorMessage` unwrapping (AJV unused); 5.0.0: "Requires react-hook-form@7.55.0 or higher" (installed 7.64.0) + schema-inferred `useForm<Input, Context, Output>`; 5.1.0 zod v4 support, zod v3 kept (installed 3.25.76) | 1: `src/components/auth/AuthCard.tsx` (`zodResolver`) | one sign-in and one sign-up on the preview URL (field-error mapping is the 5.x code path; no component test covers `AuthCard`) | **merge after the preview check** |
| [#469](https://github.com/evawlve/Recipe-App/pull/469) (supersedes #277) | `cloud/deps-supabase-ssr` | `@supabase/ssr` **+ `@supabase/supabase-js`** (forced peer) | 0.7.0 → 0.12.4; 2.58.0 → **2.117.2** | **green** (`build` ✓ 15:27Z on node 20, `Vercel` ✓, `danger` ✓, `size` ✓; the `EBADENGINE` line is expected in that job's `npm ci` output and did not fail it) | no BREAKING line in either changelog; deprecated `get/set/remove` cookie shape still typed; new cookie chunk encoding (legacy still decoded); supabase-js ≥ 2.110 `engines.node >=22` → `EBADENGINE` *warning* on CI's node 20 | `@supabase/ssr`: 6 files (§2.3); supabase-js: `src/lib/supabase/admin.ts` (the alpha's bearer path), 3 auth routes, `account/delete`, `useNotificationsRT.ts` | (1) one sign-in on the Vercel preview URL; (2) **after the box deploy**, one bearer-authenticated mobile call (`authenticateRequest()` runs on the new supabase-js; the preview never exercises it) | **merge after the preview check**, then the box step below before the next build, then the bearer call |
| #278 | `dependabot/npm_and_yarn/next-16.3.0` | `next` | 15.5.12 → 16.3.1 | `build` ✗, `Vercel` ✗ (August) | §5 | — | — | **hold** (untouched) |

Every `merge` row above carries this, verbatim:

> After the merge the box does NOT receive this change by Syncthing — the backend `.stignore` ignores `package-lock.json` (line 11) and `node_modules` (line 1), and the mobile CLAUDE.md §Deploying recipe has no install step. Before the next box build: `scp package-lock.json owner@192.168.1.133:/home/owner/Recipe-App/package-lock.json`, verify with `git hash-object` on both ends, `npm ci` in `/home/owner/Recipe-App` (the box runs node v24, so no EBADENGINE there), THEN the deploy recipe with its content proof. A Lane A or Diego step, never this session's.

**Merge order (Mac session).** The three branches each rewrite `package-lock.json` from the same `a2c7b764` base. Merge one, then on each remaining PR `git merge origin/master`; on a lockfile conflict `git checkout origin/master -- package-lock.json && npm install <pkg>@<ver> && npm ci`, then re-run the gates (`npm run lint:ci`, `npm run typecheck`, the clean-env `test:ci` below, `npm run build`). Suggested order: #466 (smallest), #468, #469 (so the supabase lockfile, the largest rewrite, is re-resolved last). cloud-22's `cloud/lint-ratchet` and cloud-23's `cloud/account-delete-page` (#465) also touch `package.json`/`jest.config.js`; whichever merges second takes `git merge origin/master`, no textual conflict expected (`lint:ci` line 12 vs dependency lines 101–151).

## 1. Gates, before and after (measured)

Clean-environment test command, exactly as run: `env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="postgresql://x:y@localhost:5432/z" npm run test:ci`. `npm run build` was run with the same dummy `DATABASE_URL`: with the variable **unset** the baseline build fails in "Collecting page data" with `PrismaClientConstructorValidationError: Invalid value undefined for datasource "db"` (`src/lib/db.ts:21` passes `process.env.DIRECT_URL || process.env.DATABASE_URL`); CI's blank secret arrives as `""`, not `undefined`, which Prisma accepts at construction. That is an environment fact, not a regression — it reproduces on `master`.

| gate | `master` `a2c7b764` | `cloud/deps-small` | `cloud/deps-hookform-resolvers` | `cloud/deps-supabase-ssr` |
|---|---|---|---|---|
| `npm ci` | exit 0 | exit 0 | exit 0 | exit 0, no `EBADENGINE` (node 22) |
| `npm run lint:ci` | exit 0, 0 errors / 461 warnings | same | same | same |
| `npm run typecheck` | exit 0 | exit 0 | exit 0 | exit 0 |
| clean-env `test:ci` | exit 0, 271/271 suites, 5482 passed, 1 skipped | identical | identical | identical |
| `npm run build` | exit 0 ("Compiled successfully") | exit 0 | exit 0 | exit 0 |
| lockfile entries changed | — | 12 | 9 | 12 |
| `package.json` lines changed | — | 2 | 1 | 2 |

`git diff --stat` on each branch shows only `package.json` and `package-lock.json` (both LF; the 106 CRLF + 2 mixed tracked files were not touched — `git ls-files --eol | awk '{print $1}' | sort | uniq -c` → `15 i/-text, 106 i/crlf, 1198 i/lf, 2 i/mixed, 8 i/none`, re-measured here). No new `process.env.X` read anywhere, so the `check` job has nothing to object to.

## 2. What each bump moves and what it changes

### 2.1 `cloud/deps-small` (#466)

Lockfile: `@radix-ui/react-checkbox` 1.3.3 → 1.3.11 plus nested `@radix-ui/*` helpers that 1.3.11 pins above what the siblings hoist (`primitive` 1.1.7, `react-compose-refs` 1.1.5, `react-context` 1.2.2, `react-presence` 1.1.5 → 1.1.10, `react-primitive` 2.1.3 → 2.1.10, `react-slot` 1.3.3, `react-use-controllable-state` 1.2.6, `react-use-effect-event` 0.0.5, `react-use-layout-effect` 1.1.4, `react-use-size` 1.1.4); `@testing-library/react` 16.3.0 → 16.3.2.

Changelog read. Radix publishes no per-package release notes (the GitHub repo has no releases; radix-ui.com is egress-blocked from this container), so the read is a **tarball diff** of 1.3.3 vs 1.3.11 from the registry: `dist/index.d.ts` is byte-identical (no API change); `index.mjs` adds a `userInteractionCount` reducer so the hidden bubble `<input>` only lets its synthetic `change`/`click` propagate on a real user interaction and stops click propagation on programmatic `checked` changes; `displayName` assignments become esbuild `__name`; `@radix-ui/react-use-previous` is dropped. The one importer `src/components/ui/checkbox.tsx` (used by `src/components/recipe/SelectableRecipeCard.tsx`) is an uncontrolled checkbox with no form-event listener. `@testing-library/react` [16.3.1](https://github.com/testing-library/react-testing-library/releases) (2025-12-15): "Switch to trusted publishing (#1437)"; 16.3.2 (2026-01-19): "Update 'onCaughtError' type inference in 'RenderOptions' to work with React v19". Zero importers in `src/` and `scripts/`.

### 2.2 `cloud/deps-hookform-resolvers` (#468)

Lockfile: `@hookform/resolvers` 3.10.0 → 5.9.1, new dependency `@standard-schema/utils` 0.3.0, and — because npm 10 auto-installs the package's optional `ajv ^8.12.0` peer — the hoisted `ajv` 6.12.6 → 8.20.0 (`json-schema-traverse` 0.4.1 → 1.0.0, new `fast-uri` 3.1.8), with `eslint` and `@eslint/eslintrc` keeping nested `ajv` 6.15.0. Nothing in `src/` or `scripts/` imports `ajv`.

Changelog read ([releases](https://github.com/react-hook-form/resolvers/releases)), every BREAKING line quoted:

- v4.0.0 (2025-02-10) — "The AJV Resolver now unwraps the `errorMessage` object to return the original error types. This update may introduce breaking changes to your projects." Not used here.
- v5.0.0 (2025-04-01) — "Requires react-hook-form@7.55.0 or higher"; generics move from `useForm<FormValues>()` to `useForm<Input, Context, Output>()`, with the advice to let "types be inferred from your schema, rather than manually defining them".
- v5.1.0 (2025-06-07) — "support Zod 4, Zod v4 mini, and retains compatibility with Zod v3."
- 5.2 → 5.9.1 — validator-peer additions and fixes (vine v4, Vest 6 via `fix(vest)!`, joi v18; 5.9.1 "isNameInFieldArray fails to recognise bracket-notation array paths"). No other BREAKING line.

`zodResolver` signature against this tree: peers on 5.9.1 are `react-hook-form ^7.55.0` (installed **7.64.0**) and `zod ^3.25.0 || ^4.0.0` (installed **3.25.76**), both satisfied, no peer warning on install. 3.10.0 exported an untyped `Resolver` const; 5.9.1 exports `zodResolver<Input, Context, Output>(schema: Zod3Type<Output, Input>, schemaOptions?: Zod3ParseParams, resolverOptions?: { mode?: 'async' | 'sync'; raw?: boolean }): Resolver<Input, Context, Output>` plus Zod-4 overloads. The single importer `src/components/auth/AuthCard.tsx:67` calls `zodResolver(mode === "signin" ? signinSchema : signupSchema)` inside `useForm<CredentialsInput>`; both schemas are `z.object` with `.email()/.min()/.refine()` and no `transform`, so Input ≡ Output and the one-generic form typechecks (exit 0, and CI `build` green).

### 2.3 `cloud/deps-supabase-ssr` (#469)

`@supabase/ssr@0.12.4` peers on `@supabase/supabase-js ^2.111.0` (`npm view`); `package.json` had `^2.58.0` (locked 2.58.0). The first `npm install @supabase/ssr@0.12.4` resolved supabase-js to **2.117.2** (today's latest 2.x; dependabot's August lockfile had 2.112.3), read from `node_modules/@supabase/supabase-js/package.json`; the second install, `npm install @supabase/ssr@0.12.4 @supabase/supabase-js@2.117.2`, makes `package.json` name `^2.117.2` so the range matches what the lockfile pins. Range style `^x.y.z` matches the neighbouring entries.

Every `@supabase/*` version that moved:

| package | from | to |
|---|---|---|
| `@supabase/ssr` | 0.7.0 | 0.12.4 |
| `@supabase/supabase-js` | 2.58.0 | 2.117.2 |
| `@supabase/auth-js` | 2.72.0 | 2.117.2 |
| `@supabase/functions-js` | 2.5.0 | 2.117.2 |
| `@supabase/postgrest-js` | 1.21.4 | 2.117.2 (monorepo version alignment) |
| `@supabase/realtime-js` | 2.15.5 | 2.117.2 |
| `@supabase/storage-js` | 2.12.2 | 2.117.2 |
| `@supabase/node-fetch` | 2.6.15 | removed (platform `fetch`; postgrest-js 2.79.0 "remove node-fetch dependency, require Node.js 20+") |
| `@supabase/phoenix` | — | 0.4.5 (new) |
| `@types/phoenix`, `@types/ws` | 1.6.6, 8.18.1 | removed |
| `iceberg-js` | — | 0.8.1 (new) |

Engines: `@supabase/supabase-js` 2.80.0 … 2.109.0 declare `node >=20.0.0`; **2.110.0 (2026-06-30, "repo: drop Node.js 20 support (#2482)") and later declare `node >=22.0.0`** (measured with `npm view` across 2.58 … 2.110; the brief's "≥ 2.111" is inside that range). On CI's node 20 `npm ci` prints `npm warn EBADENGINE` — a warning, not a red: #277's August `build` passed with it, and §0 records this branch's own CI. This container (node 22) and the box (node 24) print nothing.

Importers. `@supabase/ssr`, six files, none changed since 2026-08-21: `src/middleware.ts:73`, `src/app/auth/callback/route.ts:30`, `src/app/api/_debug/health/route.ts:21`, `src/app/api/_debug/whoami/route.ts:29`, `src/lib/supabase/server.ts:53,70` — all `createServerClient(url, key, { cookies: { get, set, remove } })`; `src/lib/supabase/client.ts:28` — `createBrowserClient(url, key, { auth: { autoRefreshToken, persistSession, detectSessionInUrl, flowType: 'pkce' } })`. `@supabase/supabase-js` directly: **`src/lib/supabase/admin.ts`** (the alpha's bearer path: `src/lib/auth/request-auth.ts:106` → `client.auth.getUser(token)`), `src/app/api/auth/{signin,signup,reset-password}/route.ts`, `src/app/api/account/delete/route.ts` (`auth.admin.deleteUser`), `src/hooks/useNotificationsRT.ts` (`.channel()` / `.removeChannel()` on the browser client). Surface used: `auth.getUser` ×13, `signOut`, `signUp`, `signInWithPassword`, `onAuthStateChange`, `signInWithOAuth`, `resetPasswordForEmail`, `exchangeCodeForSession`, `admin.deleteUser`, one realtime channel; **no `.from()`, storage or functions**, so the postgrest-js renumbering touches nothing.

Changelog read, `@supabase/ssr` 0.7.0 → 0.12.4 ([CHANGELOG](https://github.com/supabase/ssr/blob/main/CHANGELOG.md), [releases](https://github.com/supabase/ssr/releases)). **No BREAKING line in the range.** 0.8.0: "adds `cookies.encode` option allowing minimal cookie sizes (#126)", "publish SSR under deprecated auth-helpers package names (#127)", "update supabase-js to latest (#133, #145)", fix "cookies console warnings (#136)". 0.9.0: "release workflow RC versioning and publish reliability (#164)". 0.10.0: "pass cache headers to setAll to prevent CDN caching of auth responses (#176)". 0.10.1: "respect user-provided auth options in createBrowserClient (#167)". 0.10.2: "remove packageManager field (#197)". 0.10.3: "allow cookies encode without getAll/setAll on browser client (#213)", "enable tree-shaking for browser bundles (#216)", "set explicit rootDir to silence TS6059 in consumer IDEs (#211)", "validate base64-prefixed chunked cookies decode to valid JSON (#210)". 0.11.0: "add clearAuthCookiesAtScopes migration helper (#240)". 0.12.0: "full rewrite using `getAll` and `setAll` cookie methods (#1)", "improve cookie chunk handling via base64url+length encoding (#90)", "bump `cookie` to 1.0.2 (#113)". 0.12.1: "cookies: deduplicate server cookie writes (#246)". 0.12.2: "align parseCookieHeader return type with getAll cookie method (#239)". 0.12.3: "cookies: keep domain-scoped deletion in name-keyed cookie stores (#258)". 0.12.4: "flush PKCE verifier slot removals on the server (#275)" and "update `@supabase/supabase-js` to v2.111.0" (the source of the peer).

API by API, from the 0.12.4 tarball's `.d.ts`:

| API the importers use | 0.7.0 | 0.12.4 | changed? |
|---|---|---|---|
| `createServerClient(url, key, { cookies: { get, set, remove } })` | overload typed `CookieMethodsServerDeprecated` | same overload, same type (`get: GetCookie; set?: SetCookie; remove?: RemoveCookie`) | **no**; still deprecated, still typechecks. Moving the five callers to `getAll`/`setAll` is a `src/` change, outside this brief |
| `createBrowserClient(url, key, { auth })` | `options?: SupabaseClientOptions & { cookies?, cookieOptions?, cookieEncoding?, isSingleton? }` | identical | **no**; 0.10.1 fixed the auth-options passthrough this call relies on |
| cookie wire format | `base64url` chunks with `base64-` prefix | base64url+length chunks; `utils/chunker.js` keeps `BASE64_PREFIX = "base64-"` and decodes legacy chunks | new cookies differ; sessions issued by 0.7.0 still parse |
| `auth.getUser(jwt)` (supabase-js) | `getUser(jwt?: string): Promise<UserResponse>` | identical (`auth-js` 2.117.2 `GoTrueClient.d.ts:1596`) | **no** |
| new exports | — | `clearAuthCookiesAtScopes`, `warnIfUsingDeprecatedAuthHelpersPackage`, `cookies.encode` | additive, unused |

supabase-js 2.58 → 2.117 ([CHANGELOG](https://github.com/supabase/supabase-js/blob/master/CHANGELOG.md)): no BREAKING line; auth-relevant entries are 2.107.0 "remove navigator.locks-based mutex; introduce commit guard + dispose()", "return AuthInvalidJwtError from getClaims for expired JWT", 2.112.0 "move OpenTelemetry tracing to opt-in /tracing subpath", 2.117.0 "enable passkey API by default". None touches `getUser(jwt)`.

## 3. `npm audit`, before and after (ROW 2, counts only)

| tree | `npm audit --omit=dev` (low/mod/high/crit = total) | `npm audit` (all) |
|---|---|---|
| `master` `a2c7b764` | 1 / 19 / 16 / 2 = **38** | 4 / 23 / 58 / 3 = **88** |
| `cloud/deps-small` | 1 / 19 / 16 / 2 = 38 (=) | 4 / 23 / 58 / 3 = 88 (=) |
| `cloud/deps-hookform-resolvers` | 1 / 19 / 16 / 2 = 38 (=) | 4 / **22** / 58 / 3 = **87** (−1 moderate: `ajv` "ReDoS when using `$data` option", `<6.14.0`, leaves with the hoisted ajv 6 → 8) |
| `cloud/deps-supabase-ssr` | 1 / 19 / **15** / 2 = **37** (−1 high: `ws` 8.0.0–8.20.1 "Uninitialized memory disclosure" / "Memory exhaustion DoS", leaves with `realtime-js` 2.15.5) | 4 / 23 / 58 / 3 = 88 (=) |

No bump adds an advisory. The remaining 37–38 production advisories are pre-existing and outside this brief.

## 4. What is NOT this session's

- **Merging** any of #466, #468, #469 (auto-merge off; a Mac session or Diego).
- **The Vercel preview sign-in** (#468 and #469) and the recipe multi-select glance (#466).
- **The box step** quoted in §0 (lockfile `scp`, `git hash-object` both ends, `npm ci`, then the deploy recipe with its content proof). Syncthing will not carry the lockfile or `node_modules`.
- **The bearer-authenticated mobile call after the box deploy** (#469): `authenticateRequest()` → `getSupabaseAuthClient()` → `auth.getUser(jwt)` on supabase-js 2.117.2. The preview never runs this path.
- **Closing #277, #279, #280, #281** once their superseding PR merges.
- **Migrating the five `createServerClient` callers off the deprecated `get/set/remove` cookie adapter** (`src/`, Diego's; the deprecation predates 0.7.0 and 0.12.4 still types it).

## 5. Why #278 (`next` 15.5.12 → 16.3.1) stays held

Untouched by this session. Its `build` ([run 32521234638](https://github.com/evawlve/Recipe-App/actions/runs/32521234638)) passed `npm ci`, `prisma:generate`, `lint:ci`, `typecheck` and `test:ci` (216/216 suites then) and died in the `npm run build` step within one second, log re-read here:

```
⨯ ERROR: This build is using Turbopack, with a `webpack` config and no `turbopack` config.
   This may be a mistake.
   As of Next.js 16 Turbopack is enabled by default and
   custom webpack configurations may need to be migrated to Turbopack.
> Build error occurred
Error: Call retries were exceeded
    at ignore-listed frames { type: 'WorkerError' }
```

`next.config.ts` has a `webpack:` key. The same log carries two deprecations on the way: `images.domains` → `remotePatterns`, and the `middleware` file convention → `proxy` (i.e. `src/middleware.ts`, the "middleware-to-proxy" message). The `Vercel` status is FAILURE ("Deployment has failed", `dpl_EEGudb5suAw568kJHYCs2a8Jpgiv`). `next@16.3.1` peers on `react ^18.2.0 || ^19.0.0` (`npm view next@16.3.1 peerDependencies`), so React 18.3.1 is **not** a reason; `eslint-config-next` 15.0.0 would have to move to 16 in the same PR. All of that is a `next.config.ts` / `src/` change, outside this brief's MUST NOT and Diego's call.

## 6. Method notes (so the next refresh is not wrong first)

- `npm install <pkg>@<ver>` writes `^<ver>` (no `.npmrc`, default save-prefix), which is the repo's style; `npm ci` from the rewritten lockfile is the real gate, run on every branch before the others.
- A peer that npm auto-installs can move a hoisted package you did not name (`ajv` 6 → 8 on #468). Diff lockfile `packages` versions, not `git diff --stat`, to see what moved; the script used is a 6-line node compare of `packages[k].version` old vs new.
- Latest at the time of writing, for the next pass: `@supabase/ssr` 0.12.7, `@supabase/supabase-js` 2.117.2, `@hookform/resolvers` 5.9.1, `@radix-ui/react-checkbox` 1.3.11, `@testing-library/react` 16.3.3. This session took the brief's versions, not latest, except where the peer forced the resolution (supabase-js).
