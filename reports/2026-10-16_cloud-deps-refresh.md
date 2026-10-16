# cloud-30: the three cloud-21 dependency PRs, brought current and smoke-read (2026-10-16)

Written by cloud session cloud-30 (brief fired by consolidation S176). PRs #466, #468 and #469 were each 1 ahead / 37 behind `master` (the brief said 35; two commits landed since it was cut, §0). This session merged `origin/master` into each branch, ran the gates, pushed the merge commits, read the code paths each bump touches, and left all three PRs **OPEN**. Nothing was merged; no `dependabot/*` branch or PR and no #278 was touched; no `src/**`, `.github/**`, `prisma/**`, `.env*` or `scripts/doc-check/claims.json` edit.

- **Tree.** `evawlve/Recipe-App` `origin/master` at `be9b27ab` (the #481 merge). Container node v22.22.0, npm 10.9.4 (CI's `build` job runs node 20, the box node v24).
- **Labels.** "Measured" = run in this checkout on 2026-10-16 UTC. "CI" = the GitHub check on the pushed head, read with the GitHub tool. "Not run" = needs the Vercel preview, the box or a phone.

## 0. Preflight (each passed)

| check | result |
|---|---|
| shallow → unshallow; fetch master + the three branches | exit 0 |
| `git rev-list --count origin/master..origin/cloud/<b>` | `1`, `1`, `1` |
| `git ls-remote origin refs/pull/{466,468,469}/head` | `bf7181af…`, `4cb65883…`, `ed329587…` (unchanged, nobody pushed) |
| `git log --oneline 5560b864..origin/master -- package.json package-lock.json` | empty |

**FACTS re-derived.** `origin/master` moved `5560b864` → `be9b27ab` (`6e28d457` "fix(mapping): the AI-nutrition cache key folds case (C69 F8)" + merge `be9b27ab`, #481), so each branch was **37** behind, not 35; neither commit touches `package.json`/`package-lock.json`. Since the merge-base `a2c7b764`, master touched `package.json` once (`2f806ef4`, the `lint:ci` ratchet) and `package-lock.json` never. `git merge-tree --write-tree` of each branch with master: exit 0 (clean); in sequence (466 ⊕ 468, then ⊕ 469): exit 0 both steps. EOL census at `be9b27ab`: `15 i/-text, 106 i/crlf, 1223 i/lf, 2 i/mixed, 8 i/none`; `package.json`, `package-lock.json` `i/lf w/lf` — untouched by this session apart from the merges.

## 1. The table

| PR | package | from → to (pinned on branch head) | merge SHA | push | CI on the merge head | transitive moves (lockfile `packages[*].version` vs `origin/master`) | breaking notes | importers | verdict | hand check |
|---|---|---|---|---|---|---|---|---|---|---|
| [#466](https://github.com/evawlve/Recipe-App/pull/466) `cloud/deps-small` | `@radix-ui/react-checkbox` | 1.3.3 → 1.3.11 | `040128bd` | `bf7181af..040128bd`, fast-forward, accepted | `build` ✓ (05:10:46Z), `Vercel` ✓ (status "Deployment has completed"), `danger` ✓, `size` ✓, `Vercel Preview Comments` ✓ | 10 nested under `@radix-ui/react-checkbox/node_modules/`: `primitive` —→1.1.7, `react-compose-refs` —→1.1.5, `react-context` —→1.2.2, `react-presence` 1.1.5→1.1.10, `react-primitive` 2.1.3→2.1.10, `react-slot` —→1.3.3, `react-use-controllable-state` —→1.2.6, `react-use-effect-event` —→0.0.5, `react-use-layout-effect` —→1.1.4, `react-use-size` —→1.1.4. Nothing hoisted moved | none (no release notes upstream; tarball `index.d.ts` byte-identical per cloud-21 §2.1) | 1: `src/components/ui/checkbox.tsx:4` | **merge** | none needed |
| #466 | `@testing-library/react` | 16.3.0 → 16.3.2 | (same) | (same) | (same) | none | none (16.3.1 trusted publishing; 16.3.2 `onCaughtError` type for React 19) | 0 in `src/`, 0 in `scripts/` | **merge** | — |
| [#468](https://github.com/evawlve/Recipe-App/pull/468) `cloud/deps-hookform-resolvers` | `@hookform/resolvers` | 3.10.0 → 5.9.1 (MAJOR ×2) | `906bd2a8` | `4cb65883..906bd2a8`, accepted | `build` ✓ (05:12:50Z), `Vercel` ✓ (status "Deployment has completed"), `danger` ✓, `size` ✓, `Vercel Preview Comments` ✓ | `@standard-schema/utils` —→0.3.0; **`ajv` 6.12.6→8.20.0** (hoisted); `json-schema-traverse` 0.4.1→1.0.0; `fast-uri` —→3.1.8; nested `eslint/node_modules/ajv` —→6.15.0, `eslint/node_modules/json-schema-traverse` —→0.4.1, `@eslint/eslintrc/node_modules/ajv` —→6.15.0, `@eslint/eslintrc/node_modules/json-schema-traverse` —→0.4.1 | 4.0.0 AJV `errorMessage` unwrapping (AJV resolver unused); 5.0.0 "Requires react-hook-form@7.55.0 or higher" + `useForm<Input, Context, Output>`; 5.1.0 Zod 4 support, Zod 3 retained | 1: `src/components/auth/AuthCard.tsx:7,67` | **merge after a hand check** | §3.2 |
| [#469](https://github.com/evawlve/Recipe-App/pull/469) `cloud/deps-supabase-ssr` | `@supabase/ssr` + `@supabase/supabase-js` | 0.7.0 → 0.12.4; 2.58.0 → 2.117.2 (`^2.117.2`) | `fc868dd1` | `ed329587..fc868dd1`, accepted | `Vercel` ✓ (status "Deployment has completed"), `danger` ✓, `size` ✓, `Vercel Preview Comments` ✓; `build` ✓ (05:16:03Z) | `@supabase/auth-js` 2.72.0→2.117.2, `functions-js` 2.5.0→2.117.2, `postgrest-js` 1.21.4→2.117.2, `realtime-js` 2.15.5→2.117.2, `storage-js` 2.12.2→2.117.2, `@supabase/node-fetch` 2.6.15→removed, `@supabase/phoenix` —→0.4.5, `@types/phoenix` 1.6.6→removed, `@types/ws` 8.18.1→removed, `iceberg-js` —→0.8.1 | none marked BREAKING in either changelog; deprecated `get/set/remove` cookie overload still typed and still implemented; supabase-js ≥ 2.110 `engines.node >=22` (EBADENGINE warning on CI node 20) | `@supabase/ssr`: 6 files; supabase-js: `admin.ts` + 3 auth routes + `useNotificationsRT.ts` (type) — §2.3 | **merge after a hand check** | §3.3 |

## 2. Gates (measured)

Commands exactly as the brief: `npm ci`; `npm run lint:ci`; `npm run typecheck`; `DATABASE_URL="postgresql://x:y@localhost:5432/z" npm run build > <file> 2>&1; echo "exit=$?"`; `env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="postgresql://x:y@localhost:5432/z" npm run test:ci > <file> 2>&1; echo "exit=$?"`. Logs went to the session scratchpad, outside the checkout. Prisma types were present after `npm ci` (its `postinstall`), so no separate `prisma:generate` was needed.

| gate | BEFORE `origin/master` `be9b27ab` | AFTER `040128bd` (#466) | AFTER `906bd2a8` (#468) | AFTER `fc868dd1` (#469) |
|---|---|---|---|---|
| `git merge --no-edit origin/master` | — | exit 0, clean | exit 0, clean | exit 0, clean |
| `npm install --package-lock-only --ignore-scripts && git diff --exit-code package-lock.json` | — | exit 0 / exit 0 | exit 0 / exit 0 | exit 0 / exit 0 |
| `git diff --name-only origin/master HEAD` | — | `package-lock.json`, `package.json` | same | same |
| `npm ci` | exit 0 | exit 0 | exit 0 | exit 0, 0 `EBADENGINE` lines (node 22) |
| `npm run lint:ci` | exit 0, 0 errors / 423 warnings | same | same | same |
| `npm run typecheck` | exit 0 | exit 0 | exit 0 | exit 0 |
| `npm run build` (dummy URL) | exit 0 ("Compiled with warnings" — `no-console` lint warnings) | exit 0 ("Compiled successfully") | exit 0 | exit 0 |
| clean-env `test:ci` | exit 0, 275/275 suites, 5540 passed, 1 skipped | identical | identical | identical |

No lockfile conflict occurred, so the `git checkout origin/master -- package-lock.json && npm install …` fallback was not used; the pinned versions read before merging (1.3.11, 16.3.2, 5.9.1, 0.12.4, 2.117.2) are exactly what each merged lockfile still pins.

## 3. Smoke read, by code (no live call)

### 3.1 #466

`@testing-library/react`: `git grep -nE "@testing-library/react['\"]" -- src scripts` → 0 hits (devDependency kept for jest only). Radix checkbox: one importer, `src/components/ui/checkbox.tsx:4` (`import * as CheckboxPrimitive from "@radix-ui/react-checkbox"`); its runtime delta (bubble-input `change` only on a user interaction) was characterised by cloud-21 §2.1 and is unchanged by the master merge. Verdict **merge**, no hand check.

### 3.2 #468 — `zodResolver`

- Call sites: `git grep -n zodResolver -- src` → `src/components/auth/AuthCard.tsx:7` (import from `@hookform/resolvers/zod`) and `:67` `resolver: zodResolver(mode === "signin" ? signinSchema : signupSchema)` inside `useForm<CredentialsInput>`. One call site.
- Installed (lockfile on master and on the merged branch): `zod` **3.25.76**, `react-hook-form` **7.64.0**. 5.9.1's peers: `react-hook-form ^7.55.0`, `zod ^3.25.0 || ^4.0.0` (both optional-meta, read from the 5.9.1 tarball `package.json`) — satisfied.
- BREAKING notes, upstream [releases](https://github.com/react-hook-form/resolvers/releases) (quoted from cloud-21 §2.2; the GitHub releases API returned 403 to this container, so the tarball code below is this session's own read):
  - [v4.0.0](https://github.com/react-hook-form/resolvers/releases/tag/v4.0.0): "The AJV Resolver now unwraps the `errorMessage` object to return the original error types. This update may introduce breaking changes to your projects." — AJV resolver not used here.
  - [v5.0.0](https://github.com/react-hook-form/resolvers/releases/tag/v5.0.0): "Requires react-hook-form@7.55.0 or higher"; generics move to `useForm<Input, Context, Output>()`.
  - [v5.1.0](https://github.com/react-hook-form/resolvers/releases/tag/v5.1.0): "support Zod 4, Zod v4 mini, and retains compatibility with Zod v3."
- **Typechecks:** yes — `npm run typecheck` exit 0 on `906bd2a8`, and CI `build` ✓. Both schemas are `z.object` without `transform`, so Input ≡ Output and the single-generic `useForm<CredentialsInput>` stays assignable.
- **Runtime behaviour:** read from source, 3.10.0 `zod/src/zod.ts` (installed) vs 5.9.1 `zod/src/zod.ts` (tarball). `zod` 3.25.76's default export is the v3 classic API (`_def`, no `_zod`), so 5.9.1 takes its `isZod3Schema` branch and `parseZod3Issues`, which is the 3.10.0 `parseErrorSchema` with two changes: a null-prototype `errors` object (only matters for a field named like `toString`/`__proto__`; ours are `email`, `password`) and union errors surface the closest member instead of the first (no union in either schema). Path join, first-message-per-field and `criteriaMode` handling are unchanged. So `"Enter a valid email"`, `"Password is required"`, `"Password must be at least 8 characters"` and the `.refine` message map to `errors.email` / `errors.password` exactly as before. No component test covers `AuthCard`, hence the hand check.
- Verdict: **merge after a hand check** (§5.2).

### 3.3 #469 — Supabase

Importers (`git grep -nE "@supabase/(ssr|supabase-js)" -- src`, tests excluded):

| file | package | API used |
|---|---|---|
| `src/lib/supabase/admin.ts:1` (direct importer) | supabase-js | `createClient(url, key)`; returned client's `auth.getUser(jwt)` and `auth.admin.deleteUser(id)` via consumers |
| ↳ `src/lib/auth/request-auth.ts:103-106` | (via `getSupabaseAuthClient()`) | `client.auth.getUser(token)` — the mobile bearer path |
| ↳ `src/app/api/account/delete/route.ts:76,83` | (via `getSupabaseAuthClient()`) | `client.auth.admin.deleteUser(userId)` — the path proven live 2026-10-16 UTC |
| `src/app/api/auth/{signin,signup,reset-password}/route.ts:3` | supabase-js | `createClient` + `auth.signInWithPassword` / `signUp` / `resetPasswordForEmail` |
| `src/hooks/useNotificationsRT.ts:5` | supabase-js | `import type { RealtimeChannel }` only |
| `src/middleware.ts:3,73`, `src/lib/supabase/server.ts:1,53,70` | ssr | `createServerClient(url, key, { cookies: { get, set, remove } })` (deprecated shape) |
| `src/app/auth/callback/route.ts:11,30`, `src/app/api/_debug/health/route.ts:20`, `src/app/api/_debug/whoami/route.ts:27` | ssr (dynamic `await import`) | same deprecated `createServerClient` shape |
| `src/lib/supabase/client.ts:1,28` | ssr | `createBrowserClient(url, key, { auth: {...} })` |

`auth.admin.createUser`: **0** call sites (`git grep -n "auth.admin\." -- src` → only `account/delete/route.ts:83` and a comment in its test).

Read from the registry tarballs (`npm pack`, extracted outside the checkout):

- `auth.getUser(jwt)`: `GoTrueClient.d.ts` signature `getUser(jwt?: string): Promise<UserResponse>` in both 2.72.0 and 2.117.2. `_getUser(jwt)` with a jwt is the same `GET /user` request with the same `xform` in both; the only delta is the error branch, which now returns through `_returnResult()` (throws only if the client was built with `throwOnError: true`; default `false`, and `admin.ts` passes no options) and no longer removes a `-code-verifier` storage key (irrelevant to a stateless server client). `request-auth.ts`'s `{ data, error }` destructuring is unaffected.
- `auth.admin.deleteUser(id, shouldSoftDelete = false)`: byte-for-byte the same implementation in 2.72.0 and 2.117.2 (`validateUUID`, `DELETE /admin/users/{id}`, `{ should_soft_delete }` body, auth errors returned not thrown).
- `@supabase/ssr` [CHANGELOG](https://github.com/supabase/ssr/blob/main/CHANGELOG.md), re-fetched here: no BREAKING section or `!` entry between 0.7.0 and 0.12.4 (the 0.12.0 section is a release-please re-listing that includes historic items such as "full rewrite using `getAll` and `setAll` cookie methods (#1)"). The deprecated cookie shape: 0.12.4 `createServerClient.d.ts` still exports the `@deprecated` overload `cookies: CookieMethodsServerDeprecated`, and `dist/main/cookies.js` still calls `cookies.get(chunkName)` / `cookies.set(name, value, options)` / `cookies.remove(name, options)` (lines 110–128), with the same "Consider switching to the getAll and setAll cookie methods" warning as 0.7.0. New in 0.12.x: chunk validation that treats an undecodable or non-JSON chunked cookie as absent (logs a `console.warn`) — a legacy session that decodes cleanly is unaffected.
- supabase-js 2.58 → 2.117 notes touching auth (from cloud-21 §2.3, [CHANGELOG](https://github.com/supabase/supabase-js/blob/master/CHANGELOG.md)): 2.107.0 "remove navigator.locks-based mutex; introduce commit guard + dispose()", "return AuthInvalidJwtError from getClaims for expired JWT" (we do not call `getClaims`), 2.110.0 "drop Node.js 20 support", 2.112.0 tracing to opt-in subpath, 2.117.0 "enable passkey API by default". None changes `getUser(jwt)` or `admin.deleteUser`, which the tarball read confirms.
- **Test coverage caveat (for the verdict):** 21 test files `jest.mock('@supabase/supabase-js')` (`git grep -lE "jest.mock\(['\"]@supabase/supabase-js" -- src` → 21), including `request-auth.test.ts` and both `account/delete` tests. **A green `test:ci` therefore says nothing about supabase-js's runtime** — only that our code's call shapes still compile and our mocks still match them.
- Verdict: **merge after a hand check** (§5.3).

## 4. CI and merge order

CI read with the GitHub tool on each pushed merge head (see §1 column). All required results (`build` + `Vercel` on all three heads) were read green; nothing was left unread, so no `CI: not read` line applies.

**Merge order.** Any master merge (one of these three, cloud-33's `cloud/lint-script` PR, a C69 PR) makes the others BEHIND again; the next one takes `git merge origin/master` and ROW 1's rules (lockfile-only conflict fallback, `npm install --package-lock-only --ignore-scripts && git diff --exit-code package-lock.json`, the name-only MUST-NOT test, gates). Measured here: 466 ⊕ 468 ⊕ 469 merge without a textual conflict in sequence. cloud-33's `lint` script line is ~90 lines from the dependency lines, so no textual conflict is expected there either.

## 5. PR comment texts (verbatim; posted by this session where the GitHub tool allowed — §6)

### 5.1 #466

> **cloud-30 refresh (2026-10-16).** Merged `origin/master` `be9b27ab` into this branch → `040128bd` (clean merge; `git diff --name-only origin/master HEAD` = `package-lock.json`, `package.json`; lockfile stable under `npm install --package-lock-only`). Gates on `040128bd`: `npm ci` 0, `lint:ci` 0 (0 errors / 423 warnings, = master), `typecheck` 0, `build` 0, clean-env `test:ci` 0 (275/275 suites, 5540 passed, 1 skipped, = master). Pinned: `@radix-ui/react-checkbox` 1.3.11, `@testing-library/react` 16.3.2; transitive moves only the 10 nested radix helpers under `@radix-ui/react-checkbox/node_modules/`. Importers: radix checkbox 1 (`src/components/ui/checkbox.tsx`), testing-library 0 in `src/`.
>
> **Verdict: merge.** No hand check.
>
> After the merge the box does NOT receive this change by Syncthing — the backend `.stignore` ignores `package-lock.json` and `node_modules` (`grep -nxE 'node_modules|package-lock.json' .stignore`). Before the next box build: `scp package-lock.json` to `/home/owner/Recipe-App/`, verify with `git hash-object` on both ends, `npm ci` there, then the deploy recipe with its content proof. A Lane A or Diego step, never this session's.
>
> Merge order: merging this makes #468/#469 BEHIND; each takes `git merge origin/master` before its own merge. Report: `reports/2026-10-16_cloud-deps-refresh.md`.

### 5.2 #468

> **cloud-30 refresh (2026-10-16).** Merged `origin/master` `be9b27ab` into this branch → `906bd2a8` (clean merge; name-only diff vs master = `package-lock.json`, `package.json`; lockfile stable under `npm install --package-lock-only`). Gates on `906bd2a8`: `npm ci` 0, `lint:ci` 0 (423 warnings, = master), `typecheck` 0, `build` 0, clean-env `test:ci` 0 (275/275, 5540 passed, 1 skipped). Pinned `@hookform/resolvers` 5.9.1; transitive: `@standard-schema/utils` 0.3.0 new, hoisted `ajv` 6.12.6 → 8.20.0, `json-schema-traverse` 0.4.1 → 1.0.0, `fast-uri` 3.1.8 new, `eslint` and `@eslint/eslintrc` keep nested `ajv` 6.15.0.
>
> Smoke read: one call site, `src/components/auth/AuthCard.tsx:67` `zodResolver(mode === "signin" ? signinSchema : signupSchema)`; installed `zod` 3.25.76, `react-hook-form` 7.64.0 (5.x needs ≥ 7.55.0). Typechecks. Runtime: zod 3 schemas take 5.9.1's `parseZod3Issues`, which keeps 3.10.0's path-join / first-message-per-field mapping (only deltas: null-prototype error map, closest-union-member messages — neither reachable from these schemas). No component test covers `AuthCard`.
>
> **Verdict: merge after a hand check.** Diego, on this PR's Vercel preview: (1) one sign-in with a malformed email (e.g. `notanemail`) — expect "Enter a valid email" under the email field and no network call; (2) one sign-in with a real account's email and a wrong password — expect the server error banner, the form still usable. **No sign-up** (it creates a real user).
>
> After the merge the box does NOT receive this change by Syncthing — the backend `.stignore` ignores `package-lock.json` and `node_modules` (`grep -nxE 'node_modules|package-lock.json' .stignore`). Before the next box build: `scp package-lock.json` to `/home/owner/Recipe-App/`, verify with `git hash-object` on both ends, `npm ci` there, then the deploy recipe with its content proof. A Lane A or Diego step, never this session's.
>
> Merge order: any master merge makes this BEHIND again; take `git merge origin/master` before merging. Report: `reports/2026-10-16_cloud-deps-refresh.md`.

### 5.3 #469

> **cloud-30 refresh (2026-10-16).** Merged `origin/master` `be9b27ab` into this branch → `fc868dd1` (clean merge; name-only diff vs master = `package-lock.json`, `package.json`; lockfile stable under `npm install --package-lock-only`). Gates on `fc868dd1`: `npm ci` 0 (no `EBADENGINE` on node 22; CI's node 20 prints it as a warning — supabase-js ≥ 2.110 declares `node >=22`), `lint:ci` 0, `typecheck` 0, `build` 0, clean-env `test:ci` 0 (275/275, 5540 passed, 1 skipped). Pinned `@supabase/ssr` 0.12.4, `@supabase/supabase-js` 2.117.2; transitive: `auth-js`/`functions-js`/`postgrest-js`/`realtime-js`/`storage-js` → 2.117.2, `@supabase/node-fetch`, `@types/phoenix`, `@types/ws` removed, `@supabase/phoenix` 0.4.5 and `iceberg-js` 0.8.1 new.
>
> Smoke read (registry tarballs, no live call): `src/lib/supabase/admin.ts` → `getSupabaseAuthClient()` → `request-auth.ts` `auth.getUser(token)` and `account/delete/route.ts` `auth.admin.deleteUser(userId)`: both signatures identical 2.72.0 ↔ 2.117.2; `deleteUser`'s implementation is unchanged, `getUser(jwt)` issues the same `GET /user` (error branch now via `_returnResult`, a no-op without `throwOnError`). `auth.admin.createUser`: 0 call sites. `@supabase/ssr`: the 5 `createServerClient` callers still use the deprecated `get/set/remove` cookie shape, which 0.12.4 still types and still implements; no BREAKING entry in the 0.7.0 → 0.12.4 changelog. **21 test files `jest.mock('@supabase/supabase-js')`, so the green `test:ci` says nothing about supabase-js's runtime.**
>
> **Verdict: merge after a hand check.** Diego: (1) one web sign-in on this PR's Vercel preview (cookie path: `createBrowserClient` → callback → `createServerClient` on the new chunk encoding); (2) after the box deploy below, one bearer-authenticated mobile call (`authenticateRequest()` → `auth.getUser(jwt)` on supabase-js 2.117.2 — the preview never exercises it).
>
> After the merge the box does NOT receive this change by Syncthing — the backend `.stignore` ignores `package-lock.json` and `node_modules` (`grep -nxE 'node_modules|package-lock.json' .stignore`). Before the next box build: `scp package-lock.json` to `/home/owner/Recipe-App/`, verify with `git hash-object` on both ends, `npm ci` there, then the deploy recipe with its content proof. A Lane A or Diego step, never this session's.
>
> Merge order: any master merge makes this BEHIND again; take `git merge origin/master` before merging (suggested last of the three). Report: `reports/2026-10-16_cloud-deps-refresh.md`.

## 6. What this session did and did not do

- Did: three merge commits (`040128bd`, `906bd2a8`, `fc868dd1`), pushed without force; one comment per PR (§5 text, posted 2026-10-16 as issue comments 6208629682, 6208631094, 6208632615); this report on `cloud/deps-refresh-report`, one PR, left open.
- Did not: merge any PR; touch `dependabot/*`, #277–#281 or #278; open any other PR; run anything against the box, Supabase, Vercel or any live API; write a write-off.
- Not this session's: the preview sign-ins, the box `scp` + `npm ci` + deploy, the mobile bearer call, the merges themselves.
