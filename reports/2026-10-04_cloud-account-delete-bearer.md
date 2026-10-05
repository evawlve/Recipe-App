# `/api/account/delete` takes the app's bearer and fails honestly (2026-10-05)

Written by cloud session cloud-26. Branch `cloud/account-delete-bearer` in `evawlve/Recipe-App`, one PR against `master`, left OPEN for a Mac session or Diego. This is the backend half of mobile punch #332 (ruled 2026-10-04: a web page plus an in-app **Delete account** on Profile, both confirming by typing DELETE). cloud-23 (PR #465, open) built the web page and recorded two findings it was told not to fix; this PR fixes the route.

- **Tree.** `evawlve/Recipe-App` `origin/master` at `2a9f5ce` (the #467 merge, `lint:ci --max-warnings 447`). Re-fetched before the push: see §6.
- **Labels.** "Measured" means a command run in this checkout on 2026-10-05 (Node v22.22.0, npm 10.9.4, after `npm ci`). "Not run" means the step needs the box, the database or Supabase, and this session had none of them. No live API was called.
- **Siblings.** PR #465 (cloud-23) touches `src/app/account/delete/**`, `src/components/account/**`, `src/components/auth/AuthCard.tsx`, `jest.config.js`, `src/app/privacy/page.tsx`; #466/#468/#469 (cloud-21) touch `package.json` dependency lines and the lockfile; #467 (cloud-22) is already on `master`. This PR touches none of their files. Whichever of #465 and this PR merges second takes `git merge origin/master`.
- **Files in this PR** (`git diff --stat origin/master`): `src/app/api/account/delete/route.ts` (rewritten, LF before and after), `src/app/api/account/delete/route.auth.test.ts` (new, LF), this report. No `.env.example` change: the route now reads no Supabase env of its own, and `SUPABASE_SERVICE_ROLE_KEY` is already read by `src/lib/supabase/admin.ts`.

## 0. Gates (measured, BEFORE on `2a9f5ce` → AFTER on this branch)

BEFORE was run in a `git worktree` of `origin/master` with this checkout's `node_modules` symlinked in; AFTER in this checkout.

| gate | before | after |
|---|---|---|
| `npm ci` | clean (exit 0) | — |
| `npm run lint:ci` | exit 0 · `✖ 427 problems (0 errors, 427 warnings)` · `4 warnings potentially fixable` (ceiling 447) | exit 0 · `✖ 423 problems (0 errors, 423 warnings)` · `4 warnings potentially fixable` (ceiling 447) — the four fewer are the removed `console.log` lines (`no-console`) |
| `npm run typecheck` | exit 0 | exit 0 |
| `env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="postgresql://x:y@localhost:5432/z" npm run test:ci` | exit 0 · 271/271 suites · 5482 passed, 1 skipped | exit 0 · 272/272 suites · 5491 passed, 1 skipped (+1 suite, +9 tests, all this PR's) |
| CI (`build`, `Vercel`) | — | on the PR; this session does not merge |

## 1. ROW 1 — the route

Same file, same path, same method. `export async function DELETE(req: NextRequest)`; the build-time guard block is byte-identical.

**Authentication.** `getCurrentUser()` (the web cookie session, which also find-or-creates a Prisma `User` row) is replaced by the shared chokepoint: `authenticateRequest(req, { accept: ['bearer', 'cookie'] })` from `src/lib/auth/request-auth.ts`. Not `'key'`: the dev key names no user, and a deletion must name a person. A failure is 401 `{ error: 'Unauthorized', reason }` for `missing_credentials` / `invalid_bearer` and 503 `{ error: 'Authentication unavailable', reason: 'auth_unavailable' }`. A second narrowing (`if (!auth.userId)` → 401) follows with a comment saying it is unreachable at runtime; it exists because `RequestAuth.userId` is `string | null` (null only for `via: 'key'`) and `npm run typecheck` needs `auth.userId` to be a `string` below.

**Order flipped.** The Supabase auth user is the thing both stores require gone, and the user's real data (profile, meals, log items, streaks, templates, overrides, weight entries) cascades from `auth.users` on the Supabase side; the Prisma rows are the parked web recipe app's. So:

1. `getSupabaseAuthClient()` (imported from `src/lib/supabase/admin.ts`; the route's own `createClient` and its `@supabase/supabase-js` import are gone). `null` → 503 `{ error: 'Auth deletion unavailable', reason: 'auth_unavailable' }`, nothing touched.
2. `client.auth.admin.deleteUser(auth.userId)`. An `error` → 502 `{ error: 'Auth deletion failed', reason: 'auth_delete_failed', detail: error.message }`, nothing else touched, `console.warn` of the message (never the token). A throw → the same 502 with the thrown message as `detail`.
3. Only after the auth deletion succeeded, the Prisma cleanup. `prisma.user.findUnique` → `null` is the normal mobile-only case (nothing on the bearer path creates the row): the transaction is skipped and the response carries `appDataFound: false, appDataDeleted: false`. A row → the existing transaction body (the recipes loop, collections, comments, likes, both `Follow` directions, `tx.user.delete`), the only edit being `user.id` → `userId` because `user` no longer exists, inside its own `try/catch`: a failure is `appDataDeleted: false, appDataError: <message>` on a **200**, with a `console.warn`, because the auth user is already gone and a 500 would tell the app nothing happened.

**Response on success:** `{ success: true, authDeleted: true, appDataFound, appDataDeleted, appDataError?, message, redirectTo }`. `success`/`message`/`redirectTo` stay for compatibility although nothing consumes them; what the web card and the app read is `response.ok` on success and a string `error` on a non-2xx (re-derived: `git show origin/cloud/account-delete-page:src/components/account/DeleteAccountCard.tsx | grep -n 'response.ok\|body.error'` → line 145 `if (!response.ok)`; `describeFailure()` at lines 55–65 reads `body.error` when it is a string; the parked `SettingsPanel.tsx` reads `response.ok` and `errorData.error`). Every non-2xx body in the route carries `error` as a string.

**Logging.** The four `console.log` lines (two of which printed the user's email) are gone; new logging is `console.warn` only and never carries an email or a token. The route reads no `process.env` beyond the untouched guard block, so the CI `check` job has nothing new to find. No `source:` property is written (the `api-source-emitting-routes-nine` doc-check claim greps every route file for `^ *source:`).

### 1a. The response contract (for the mobile brief, cloud-27)

| status | body | what was deleted |
|---|---|---|
| 401 | `{ error: 'Unauthorized', reason: 'missing_credentials' }` | nothing — no bearer and no cookie session |
| 401 | `{ error: 'Unauthorized', reason: 'invalid_bearer' }` | nothing — GoTrue rejected the token; it does NOT fall through to the cookie |
| 503 | `{ error: 'Authentication unavailable', reason: 'auth_unavailable' }` | nothing — the bearer could not be validated (no Supabase env in the process, or GoTrue threw) |
| 503 | `{ error: 'Auth deletion unavailable', reason: 'auth_unavailable' }` | nothing — authenticated (cookie), but no admin client could be built |
| 502 | `{ error: 'Auth deletion failed', reason: 'auth_delete_failed', detail }` | nothing — Supabase refused `admin.deleteUser` (e.g. anon key only) or the call threw |
| 200 | `{ success: true, authDeleted: true, appDataFound: false, appDataDeleted: false, message, redirectTo }` | the Supabase auth user and everything that cascades from it; there was no Prisma `User` row (mobile-only user) |
| 200 | `{ success: true, authDeleted: true, appDataFound: true, appDataDeleted: true, … }` | the Supabase auth user and the Prisma rows |
| 200 | `{ success: true, authDeleted: true, appDataFound: true, appDataDeleted: false, appDataError, … }` | the Supabase auth user only; the Prisma transaction failed (message in `appDataError`) |
| 503 | `{ error: 'Not available during build' }` | nothing — the pre-existing build-time guard, unchanged |
| 500 | `{ error: 'Failed to delete account. Please try again.' }` | unknown — the pre-existing outer catch, unchanged (now reachable only from `findUnique` itself or the chokepoint throwing) |

`import("@/lib/db")` is still dynamic, after the auth deletion, so a process without a reachable database still deletes the auth user and reports the Prisma half as a 200 with `appDataDeleted: false` (or a 500 if Prisma throws on `findUnique`, see §3 finding 3).

## 2. ROW 2 — the tests

`src/app/api/account/delete/route.auth.test.ts`, in the barcode idiom: `jest.mock('@supabase/supabase-js')` with a `createClient` returning `{ auth: { getUser, admin: { deleteUser } } }`, `jest.mock('@/lib/auth')` with `getCurrentUser` for the cookie arm, `jest.mock('@/lib/db')` with `user.findUnique` and a `$transaction` that runs its callback against a stub `tx`; `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set above the imports; the handler imported from `./route`.

**Red first (measured).** Against the unedited route (`git stash push src/app/api/account/delete/route.ts`, run, `git stash pop`):

```
Test Suites: 1 failed, 1 total
Tests:       9 failed, 9 total
```

**A correction to the brief's expectation.** The brief predicted one compile-time red (`TS2554: Expected 0 arguments, but got 1`). It did not happen, for two reasons that are both baseline and worth knowing: `tsconfig.json` **excludes** `**/*.test.ts` (so `npm run typecheck` never sees a test file — measured: `tsc --noEmit` exits 0 with the new test present and the OLD route in place), and `tsconfig.json` sets `isolatedModules: true`, under which ts-jest transpiles without type-checking. So the red was nine **runtime** failures: the old route ignored the request and answered the cookie-only `getCurrentUser()`, which the harness defaults to `null`, so (a)–(h) got 401 bodies without a `reason` / 401 where 200, 502 or 503 was expected, and (i) got a 200 whose body lacked `authDeleted`, `appDataFound`, `appDataDeleted`.

**Green after ROW 1 (measured):** 9/9.

| pin | credential | arrangement | asserts |
|---|---|---|---|
| (a) | none | — | 401 `missing_credentials`; `deleteUser` and `findUnique` never called |
| (b) | bad bearer | `getUser` → `{ user: null, error }`; a cookie user is ALSO available | 401 `invalid_bearer`; `getCurrentUser` never consulted |
| (c) | valid bearer | `findUnique` → null | `deleteUser('user-1')` once; 200 `{ authDeleted: true, appDataFound: false, appDataDeleted: false }`, no `appDataError`; `$transaction` never called |
| (d) | valid bearer | `deleteUser` → `{ error: { message: 'boom' } }` | 502 `{ error, reason: 'auth_delete_failed', detail: 'boom' }`; `findUnique` and `$transaction` never called |
| (e) | valid bearer | `deleteUser` throws | 502, same `error`/`reason`, `detail` = the thrown message; `findUnique` never called |
| (f) | valid bearer | `findUnique` → a row with one recipe; `$transaction` runs its callback | 200 `{ authDeleted: true, appDataFound: true, appDataDeleted: true }` |
| (g) | valid bearer | a row; `$transaction` rejects | 200 `{ authDeleted: true, appDataFound: true, appDataDeleted: false, appDataError: 'deadlock detected' }`; `deleteUser` was called |
| (h) | cookie | the four Supabase env values deleted; the route `require`d inside `jest.isolateModules` so `admin.ts` has no memoised client | 503 `{ error: 'Auth deletion unavailable', reason: 'auth_unavailable' }`; `deleteUser` and `findUnique` never called |
| (i) | cookie | `getCurrentUser` → `{ id: 'cookie-user' }`, a Prisma row | 200 with all three flags true; `getUser` never called; `deleteUser('cookie-user')` |

(h) authenticates through the cookie arm because a bearer with no Supabase env is refused by the chokepoint first (`request-auth.ts`'s bearer arm returns `auth_unavailable` before the route's own check runs). `afterEach` reassigns the four values and calls `resetSupabaseAuthClientForTests()`, because `admin.ts` memoises its client.

## 3. Findings for Diego

1. **The old route reported success on a failed auth deletion — fixed here.** Both the `authError` branch and the `catch` fell through to `{ success: true }` ("Don't fail the request if auth deletion fails"), after the Prisma rows were already gone. So a user who "deleted" through the old route on a deployment where `SUPABASE_SERVICE_ROLE_KEY` was unset or where Supabase refused the call saw a success message, was signed out, and still has: the `auth.users` row (they can sign back in), and everything that cascades from it on the Supabase side — `user_profiles`, `user_preferences`, `user_meal_config`, `user_streaks`, `meals`, `food_log_items`, `saved_meal_templates`, `user_overrides`, `weight_entries`. What they lost was only the parked web app's Prisma rows. Whether anyone actually hit that path is a box/Supabase question (the Supabase dashboard's auth users versus the box's request logs), not answerable here. Under the new order, nothing is deleted unless the auth deletion succeeded.
2. **`NlpRequestLog` rows orphan.** `NlpRequestLog.userId` is a bare string with no relation to `User`, so a deletion leaves Magic Log request text keyed to an id that no longer exists (cloud-23 found it; this PR does not change it — `prisma/**` is out of scope). A `prisma/**` change is his call: a nullable `userId` with `onDelete: SetNull`, or a scrub in the route after `tx.user.delete`, or an explicit retention statement on the privacy page.
3. **On Vercel, the web page now needs a reachable `DATABASE_URL` only for the Prisma half.** With this route the auth deletion no longer depends on Prisma: a mobile-only user who signs in to the Vercel page deletes cleanly (200, `appDataFound: false`) — provided the cookie session itself resolves, which `getCurrentUser()` still does through Prisma (it find-or-creates the `User` row and returns `null` on a database error, i.e. a 401 for a signed-in user, cloud-23's F2). So on a Vercel deployment without database reach the page still cannot authenticate anyone, and on one WITH reach a web user's recipe rows may survive with `appDataDeleted: false` if the transaction fails. The complete path, as cloud-23 said, is the Funnel origin (`https://dhl32-opt-5060.tail9ae316.ts.net/account/delete`), where both `DATABASE_URL` and the service-role key are set. Note also the guard block: on Vercel with `NODE_ENV=production` and no `DATABASE_URL` the route answers 503 "Not available during build" before authenticating — pre-existing, unchanged.

## 4. Deploy note for Lane A

This route runs on the box: the app's `EXPO_PUBLIC_API_BASE_URL` is the Funnel origin. A source pull + restart deploys nothing — `npm run build` on the box, then `systemctl --user restart recipe-api` (CLAUDE.md §Server Ops). The route now needs `SUPABASE_SERVICE_ROLE_KEY` and a Supabase URL in the box `.env`: `admin.ts` reads `SUPABASE_URL || NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY || NEXT_PUBLIC_SUPABASE_ANON_KEY`, and with only the anon key Supabase refuses `admin.deleteUser`, which now surfaces as a 502 `auth_delete_failed` instead of a 200. Re-derive on the box, never in a cloud session:

```
ssh owner@192.168.1.133 'grep -cE "^(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_URL|NEXT_PUBLIC_SUPABASE_URL)=" /home/owner/Recipe-App/.env'
```

Expect 2 or 3. A 1 means the service-role key is missing and every deletion will be a 502 until it is added.

**Mobile CLAUDE.md sentence to update (the merging Mac session, not this one — no mobile checkout here).** `grep -rl authenticateRequest src/app/api --include=route.ts | wc -l` is 6 on `2a9f5ce` and **7** on this branch; the mobile repo's CLAUDE.md quotes the 6 with that re-derive command.

## 5. What was not done, and why

- `prisma/**` (finding 2), `src/lib/auth/request-auth.ts`, `src/lib/supabase/admin.ts`, `src/lib/auth.ts`, `.env.example`: MUST NOT, and none was needed.
- `npm run build`: not run here; it is the `build` CI check on the PR.
- No live Supabase call: the `admin.deleteUser` path is exercised only through the mock. The first real deletion through the box is the real test, with a throwaway account.

## 6. Push and PR

`origin/master` re-fetched immediately before the push: still `2a9f5ce`, no merge needed. Branch `cloud/account-delete-bearer`, one PR against `master`, left OPEN (PR number recorded in the follow-up commit on this branch). Required checks `build` and `Vercel` run on the PR; this session does not merge.
