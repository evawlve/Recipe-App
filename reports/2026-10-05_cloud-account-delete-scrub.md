# `/api/account/delete` scrubs the caller's rate-limit rows and never says "try again" over a gone account (2026-10-05)

Written by cloud session cloud-29. Branch `cloud/account-delete-scrub` in `evawlve/Recipe-App`, one PR against `master`, left OPEN — a merge is followed by a deploy and both are Diego's call. This fixes the two leftovers cloud-26's reviewer found in the route PR #471 shipped (mobile punch #345, parts (b) and (4)), and nothing else.

**Verdict.** ROW 1 (the scrub) — DONE and pinned: after a successful auth deletion the route deletes every `NlpRequestLog` row for the caller, unconditionally, mobile users included, and reports the count as `requestLogRowsDeleted`. ROW 2 (the fix-forward) — DONE and pinned: a Prisma import, lookup or transaction failure after the auth deletion is a 200 with `appDataDeleted: false` and an `appDataError`, never the outer 500; `appDataFound` is `null` only when the lookup (or the import before it) failed. Both suites green, 21/21; the existing suite is unedited. Every pin was shown red by a mutation of the route line it guards. Nothing here is deployed.

- **Tree.** `origin/master` at `b5b2b944` (the #471 merge). Branch created from it; `git merge-base --is-ancestor b5b2b944 HEAD` exits 0.
- **Labels.** "Measured" means a command run in this checkout on 2026-10-05 (Node v22.22.0, npm 10.9.4, after `npm ci`). "Reasoned" means read from the source, not executed. No live API, box, database or Supabase was reached; the checkout carries `.env.example` only.
- **Files in this PR** (`git diff --stat origin/master` after the commit): `src/app/api/account/delete/route.ts` (edited), `src/app/api/account/delete/route.scrub.test.ts` (new), this report. `route.auth.test.ts` is read, not edited. Nothing under `prisma/**`, `src/lib/**`, `src/app/api/nlp/**`, `.env*`, `package*.json`, `jest.config.js`, `dist/**`.
- **Line endings** (measured, `git ls-files --eol src/app/api/account/delete/`): both tracked files read `i/lf w/lf` before and after; the new suite is LF (`file` → "UTF-8 text", no CRLF). Edits were exact-string substitutions, never a whole-file rewrite.
- **`git diff --stat`** of the route reads `131 insertions(+), 72 deletions(-)` because the transaction body moved one indent level under the new lookup guard; `git diff -w --stat` reads `66 insertions(+), 7 deletions(-)`, which is the real change. Every deleted line is either re-indented or one of the seven listed in §3.

## 0. First commands (measured, each exit 0 / expected value)

```
git fetch origin master                                   → a2c7b76..b5b2b94  master -> origin/master
git checkout -b cloud/account-delete-scrub origin/master  → Switched to a new branch
git merge-base --is-ancestor b5b2b944 HEAD                → exit 0
test -f src/app/api/account/delete/route.auth.test.ts     → exit 0
grep -c "authenticateRequest(req, { accept: \['bearer', 'cookie'\] })" src/app/api/account/delete/route.ts → 1
grep -c "nlpRequestLog" src/app/api/account/delete/route.ts → 0
grep -c "model NlpRequestLog" prisma/schema.prisma        → 1
```

## 1. Gates (measured)

BEFORE was run in a `git worktree` of `origin/master` (`b5b2b94`) with this checkout's `node_modules` symlinked in — a first BEFORE run in the main checkout was discarded because the route edit landed while it ran. AFTER in this checkout with both edits and the new suite. Test command in both arms: `env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="postgresql://x:y@localhost:5432/z" npm run test:ci`.

| gate | before (`b5b2b94`) | after (this branch) |
|---|---|---|
| `npm ci` | exit 0 (postinstall `prisma generate` ran) | — |
| `npm run lint:ci` (`--max-warnings 447`) | exit 0 · `✖ 423 problems (0 errors, 423 warnings)` | exit 0 · `✖ 423 problems (0 errors, 423 warnings)` — no warning added |
| `npm run typecheck` | exit 0 | exit 0 (no `nlpRequestLog does not exist` — the generated client was already current) |
| `npm run test:ci` (clean env) | exit 0 · 272/272 suites · 5491 passed, 1 skipped | exit 0 · 273/273 suites · 5503 passed, 1 skipped (+1 suite, +12 tests, all this PR's) |
| CI `check` (env-example) | — | nothing new to find: the route's `process.env.*` reads are the untouched guard block; the suite sets only `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, as the existing suite does |
| CI `build`, `Vercel` | — | on the PR; this session does not merge |

## 2. What the table is, and who has rows in it (re-derived, measured)

`model NlpRequestLog { id, userId @map("user_id"), createdAt }`, indexes on both columns, `@@map("nlp_requests_log")`, **no relation** — `grep -n -A8 "model NlpRequestLog" prisma/schema.prisma`. There is no text column: cloud-26's finding 2 called these rows "Magic Log request text", which is wrong; they are the parse route's rate-limit counter (10/min · 100/day), one timestamp per paid parse.

Who writes it (`git grep -n "nlpRequestLog" -- src` restricted to non-test files): only `src/app/api/nlp/parse/route.ts` — `tx.nlpRequestLog.count` ×2 and `tx.nlpRequestLog.create({ data: { userId } })` inside the reservation transaction, guarded by `if (!isDevBypass && userId)`, and `prisma.nlpRequestLog.delete({ where: { id: reservedId } })` in `settle()` when the run did no paid work (the refund). So a dev-key caller, a bypass bearer and a cookie-only web user have no rows, and a parse that was all cache hits leaves none. The app's users are bearer users with no Prisma `User` row (nothing on the bearer path creates one — cloud-26 §1), so this table was the one backend row the privacy page's deletion promise did not reach.

## 3. The route diff, in order of execution

Nothing before step (3) changed: the build-time guard, `authenticateRequest(req, { accept: ['bearer', 'cookie'] })`, the two 401s and the chokepoint 503, `getSupabaseAuthClient()` → 503, `admin.deleteUser(userId)` → 502 on refusal or throw, are byte-identical. The outer `catch` → 500 `"Failed to delete account. Please try again."` is unchanged and now reachable only from failures BEFORE the auth deletion (the chokepoint or `getSupabaseAuthClient()` throwing).

1. **State.** `requestLogRowsDeleted: number | null = null`, `appDataFound: boolean | null = false` (was `boolean`), `appDataDeleted = false`, `appDataError` — declared before the import, so every later branch can report into them.
2. **The import, guarded** (ROW 2). `({ prisma } = await import("@/lib/db"))` stays dynamic and after the guard (its comment says why), now inside its own try/catch: on failure `appDataFound = null`, `appDataError = <message>`, the existing warn idiom `[account.delete] app-data cleanup failed after auth deletion:`. Without `prisma` neither (3a) nor (3b) can run, so `requestLogRowsDeleted` stays `null`.
3. **(3a) The scrub** (ROW 1), inside `if (prisma)`, before and outside the `User` lookup: `prisma.nlpRequestLog.deleteMany({ where: { userId } })`, its `count` into `requestLogRowsDeleted`. Its own try/catch: a failure logs `console.warn('[account.delete] request-log scrub failed after auth deletion:', detail)` and leaves `requestLogRowsDeleted` `null`; it sets none of `appDataFound` / `appDataDeleted` / `appDataError` and does not stop (3b).
4. **(3b) The lookup, guarded** (ROW 2). `prisma.user.findUnique({ where: { id: userId }, include: {…} })` — the same argument object — runs inside an async IIFE that returns `{ ok: true, row }` or `{ ok: false, err }`, so the row's type is still inferred from the call and no Prisma payload type is spelled out. `!lookup.ok` → `appDataFound = null`, `appDataError`, the same warn idiom. `lookup.row` → `appDataFound = true` and the transaction, whose body and its catch (`appDataDeleted = false`, `appDataError`, the existing `console.warn` line) are unchanged apart from indentation.
5. **The 200.** `requestLogRowsDeleted` is added between `authDeleted` and `appDataFound`. `success`, `message`, `redirectTo` and the conditional `appDataError` spread are unchanged.

The seven removed lines (`git diff -w`): the old `(3)` two-line comment, the unguarded `const { prisma } = await import(...)`, `let appDataFound = false;` (retyped), `const userData = await prisma.user.findUnique({` (now inside the IIFE), the closing `});` of that call as a statement, and `if (userData) {` (now `else if (lookup.row)`). Literal counts, before → after (measured with `grep -c`): `auth_delete_failed` 2 → 2, `auth_unavailable` 2 → 2, `Account and all associated data deleted successfully` 1 → 1, `Not available during build` 1 → 1, `Unauthorized` 2 → 2; the existing `console.warn('[account.delete] app-data cleanup failed after auth deletion:'` line 1 → 3 (kept, and reused for the import and lookup arms); `console.log` 0 → 0.

**Header comment** extended with one paragraph describing both rows; its existing sentences are kept verbatim.

## 4. Pins and mutations (measured)

New suite `src/app/api/account/delete/route.scrub.test.ts`, 12 tests, the auth suite's harness plus `nlpRequestLog.deleteMany` on the `@/lib/db` mock. The `jest.fn()`s are `mock`-prefixed and declared above `jest.mock`; the `@/lib/db` factory is a `function mockDbModule()` declaration (a `const` arrow was tried first and fails with `Cannot access 'mockDbModule' before initialization`, because the hoisted `jest.mock` reads the reference eagerly), named so (g) can put it back. `resetSupabaseAuthClientForTests()` in `afterEach`, as the existing suite does.

**Red first:** with the pristine `b5b2b944` route swapped in (`cp` of a saved copy, then restored and `cmp`-identical), `npx jest src/app/api/account/delete` → `7 failed, 14 passed, 21 total`; the auth suite 9/9 green, and (a), (b), (d1), (d2), (e), (e2), (g) red. The five (c) pins are green on the old route by construction — they assert the scrub does NOT run, and the old route has no scrub — which is why each has its own mutation below.

**Green after:** 21/21 (9 existing + 12 new).

| pin | arrangement | asserts | mutation that reds it (route line reverted, red observed, restored) |
|---|---|---|---|
| (a) | valid bearer, `findUnique` → null, `deleteMany` → `{ count: 3 }` | 200; `deleteMany` once with `{ where: { userId: 'user-1' } }`, called after `deleteUser` and before `findUnique` (`invocationCallOrder`); `requestLogRowsDeleted: 3`, `appDataFound: false`, `appDataDeleted: false`, no `appDataError`; `$transaction` not called | M1 remove the `deleteMany` call → red (also M1b move the scrub inside the `lookup.row` branch → red; M2 → red on the order assertion) |
| (b) | cookie user, a `User` row, `deleteMany` → `{ count: 0 }` | 200; `deleteMany` once with `cookie-user`; `$transaction` once; `requestLogRowsDeleted: 0`, `appDataFound: true`, `appDataDeleted: true`, no `appDataError` | M1 → red |
| (c1) | `deleteUser` → `{ error }` (502) | `deleteMany` and `findUnique` not called | M2 hoist the scrub above step (2) → red |
| (c2) | `deleteUser` throws (502) | `deleteMany` not called | M2 → red |
| (c3) | no credentials; then a bad bearer (both 401) | `deleteUser` and `deleteMany` not called | M2 does NOT red this one — the hoisted scrub still sits after the 401s. Reasoned: the only way to reach `prisma` before `authenticateRequest()` is to move the import above it, which the build-time-guard comment forbids; the pin stands as a regression guard. |
| (c4) | bearer, `getUser` throws → chokepoint 503 `auth_unavailable` | `deleteUser` and `deleteMany` not called | same as (c3) |
| (c5) | cookie user, the four Supabase env values deleted, the route `require`d inside `jest.isolateModules` — the existing (h) harness verbatim, env save/restore included | 503 `{ error: 'Auth deletion unavailable', reason: 'auth_unavailable' }`; `deleteUser`, `deleteMany`, `findUnique` not called | same as (c3): the route's own check is after authentication and before step (2), and M2 places the scrub after it |
| (d1) | bearer, `deleteMany` rejects, `findUnique` → null | 200; `findUnique` still called; `requestLogRowsDeleted: null`, `appDataFound: false`, `appDataDeleted: false`, no `appDataError`; `console.warn` called with the scrub message and the error text | M3 remove the scrub's try/catch → red (the throw reaches the outer catch: 500, no lookup). M3 also reds four tests of the EXISTING suite, whose mock has no `nlpRequestLog` — see (f) |
| (d2) | cookie user, a row, `deleteMany` rejects | 200; `$transaction` once; `requestLogRowsDeleted: null`, `appDataFound: true`, `appDataDeleted: true`, no `appDataError` | M3 → red |
| (e) | bearer, `findUnique` rejects | 200, not 500; `authDeleted: true`, `requestLogRowsDeleted: 3`, `appDataFound: null`, `appDataDeleted: false`, `appDataError` the thrown message, no `error`; `$transaction` not called; the existing warn idiom called with the message | M4 rethrow from the lookup's catch → red (500); M4b report `appDataFound = false` on a failed lookup → red |
| (e2) | cookie user, a row, `$transaction` rejects | 200; `appDataFound: true` (not null), `appDataDeleted: false`, `appDataError: 'deadlock detected'`, `requestLogRowsDeleted: 3` | M1 → red (on the count). The `true`-not-`null` half is the existing (g) test's territory and is green under every mutation here |
| (g) | bearer; `jest.resetModules()`, `jest.doMock('@/lib/db', () => { throw … })`, the route `require`d fresh; the normal factory restored in `finally` | 200, not 500; `authDeleted: true`, `requestLogRowsDeleted: null`, `appDataFound: null`, `appDataDeleted: false`, `appDataError` contains the thrown text; `deleteMany` and `findUnique` not called | M5 remove the import's try/catch → red (500) |
| (f) | the existing `route.auth.test.ts`, UNEDITED | 9/9 | — |

**(f), what actually happens.** The existing suite's `@/lib/db` mock is `{ prisma: { user: { findUnique }, $transaction } }` with no `nlpRequestLog`, so in its four tests that reach step (3) — (c), (f), (g), (i) — `prisma.nlpRequestLog.deleteMany` throws `TypeError: Cannot read properties of undefined (reading 'deleteMany')`, the scrub's own catch swallows it, `requestLogRowsDeleted` is `null`, and the lookup and transaction run as before. Their `toMatchObject` assertions do not mention `requestLogRowsDeleted`, and (c)/(f) assert `appDataError` is undefined, which holds because the scrub never writes it. That is expected and was not "fixed" by editing that file; M3 (removing the scrub's catch) is what shows the dependency — it reds those four tests with a 500.

**About (g)'s harness.** The (c5)/(h) `isolateModules` harness cannot pin the import failure: the route's `await import("@/lib/db")` runs after `isolateModules`' synchronous callback has returned, so the dynamic require resolves against the outer registry and sees the normal mock (measured: that first version got `requestLogRowsDeleted: 3, appDataFound: false`). `resetModules` + a throwing `doMock` + a fresh `require('./route')` is the honest version; it is last in the file and restores the factory in `finally`. Labelled MEASURED, not reasoned.

## 5. The response shape

Before (`b5b2b944`) and after; non-2xx bodies are unchanged and carry `error` as a string plus a machine `reason`. All three known clients (the app's delete sheet, cloud-23's `DeleteAccountCard` on #465, `src/components/account/SettingsPanel.tsx` on master) read `response.ok` on success and a string `error` on a non-2xx, and nothing under `src/` types this route's response (`grep -rn "appDataFound" src` outside the route's own folder → nothing), so the added field is invisible to them.

| status | before | after |
|---|---|---|
| 401 | `{ error: 'Unauthorized', reason: 'missing_credentials' \| 'invalid_bearer' }` | unchanged |
| 503 | `{ error: 'Authentication unavailable', reason: 'auth_unavailable' }` (chokepoint) · `{ error: 'Auth deletion unavailable', reason: 'auth_unavailable' }` (route) · `{ error: 'Not available during build' }` (guard) | unchanged |
| 502 | `{ error: 'Auth deletion failed', reason: 'auth_delete_failed', detail }` | unchanged |
| 200 | `{ success: true, authDeleted: true, appDataFound: boolean, appDataDeleted: boolean, appDataError?: string, message, redirectTo }` | `{ success: true, authDeleted: true, requestLogRowsDeleted: number \| null, appDataFound: boolean \| null, appDataDeleted: boolean, appDataError?: string, message, redirectTo }` |
| 500 | `{ error: 'Failed to delete account. Please try again.' }` — reachable from the chokepoint throwing AND from the Prisma import or `findUnique` throwing after the auth deletion | same body; reachable only from failures BEFORE the auth deletion |

Field values on the 200, after:

- `requestLogRowsDeleted`: `number ≥ 0` — the rows deleted (0 for a web or dev-bypass user); `null` — the scrub failed, or the Prisma import failed so it never ran.
- `appDataFound`: `false` — the lookup answered and there is no `User` row (every mobile user); `true` — a row was found; `null` — the import or the lookup failed, so whether a row exists is unknown.
- `appDataDeleted`: `true` only when a row was found and the transaction committed; `false` otherwise (no row, failed lookup, failed import, failed transaction).
- `appDataError`: present only when the import, the lookup or the transaction failed; the error's message. Never set by the scrub.

## 6. What a Mac session must verify, before and after the deploy (not run here)

Deploy per CLAUDE.md §Server Ops: `git fetch` + `git merge --ff-only`, `npm run build` on the box, then `systemctl --user restart recipe-api` — a pull plus restart deploys nothing.

1. **Content proof** — the literal this change is REQUIRED for is `requestLogRowsDeleted`; it exists nowhere in `b5b2b944`. On the box, find the served chunk for the route under `.next/server/app/api/account/delete/` and count: `grep -c requestLogRowsDeleted <chunk>` should read **served 1 / anchor 0** (the anchor being a build of `b5b2b944`, or the pre-deploy `.next`). The five control literals (`auth_delete_failed`, `auth_unavailable`, `Account and all associated data deleted successfully`, `Not available during build`, `Unauthorized`) must count the same before and after — they were not reworded.
2. **Behaviour proof** — a throwaway account. BEFORE deleting, do one parse that did PAID work (an uncached line; a cache-hit parse is refunded in `settle()` and leaves no row), then on the box:
   ```
   docker exec mealspire-db psql -U postgres -d mealspire -c "SELECT count(*) FROM nlp_requests_log WHERE user_id = '<id>'"
   ```
   expect ≥ 1. Delete the account through the app (or `curl -X DELETE -H "Authorization: Bearer <token>" <funnel>/api/account/delete`), expect a 200 whose body has `requestLogRowsDeleted` ≥ 1 and `appDataFound: false`; re-run the count, expect 0.
3. **Refund race (read-only).** `journalctl --user -u recipe-api | grep -c "NLP Parse Rate Limiter refund failed"` before and after; an increase that coincides with a deletion is the in-flight-parse case in §7, not a regression.

## 7. Not in scope — still open

- The read-only check of `weight_entries`'s foreign-key action on production (Lane A's, on the Mac).
- The three `ON DELETE RESTRICT` recipe tables that can roll the web half back (`appDataDeleted: false` with an `appDataError` naming the constraint).
- **The privacy page's wording** — not edited (#465 owns `src/app/privacy/**`). Proposed sentence, true once this PR is deployed: *"Deleting your account removes your sign-in, your profile, meals, logs and preferences, and the per-request rate-limit timestamps our food-parsing service kept for your account; nothing of yours remains on our servers afterwards."* (It says "timestamps", not "request text": the table has no text column.)
- **The stale `dist/` copy.** `dist/src/app/api/account/delete/route.js` is a tracked build artefact, last touched by the #408 merge; it still calls `getCurrentUser()` and knows neither `authDeleted` nor `requestLogRowsDeleted`. It is stale by construction (it predates #471 as well) and is not what the box serves (`next start` serves `.next/`). Left alone.
- **A parse in flight during the deletion** can re-create one `nlp_requests_log` row after the scrub (its reservation lands after `deleteMany`), and its later refund of an already-scrubbed row logs a swallowed `NLP Parse Rate Limiter refund failed` error. One orphan row per such race, no text in it. Not fixed here.
- A `prisma/**` change (a relation with `onDelete: Cascade`, or a nullable `user_id`) was considered and refused for this brief.

## 8. Push and PR

`origin/master` re-fetched immediately before the push: __MASTER_AT_PUSH__. Branch `cloud/account-delete-scrub`, one PR against `master`, left OPEN: __PR_URL__. Required checks `build` and `Vercel` run on the PR; this session does not merge.
