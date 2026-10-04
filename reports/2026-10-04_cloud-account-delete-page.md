# cloud-23 — the account-deletion web page (backend half of mobile punch #332)

**Date:** 2026-10-04 · **Base:** `a2c7b764` (`master`) · **Branch:** `cloud/account-delete-page` · **PR:** left open for a Mac session or Diego.

Google Play requires an app with account creation to offer an in-app deletion path *and* a web link where a user can request deletion (declared in the Data safety form). The backend already served `DELETE /api/account/delete`; the web had cookie auth and a `/privacy` page offering an email-request path only. This PR adds the self-serve page. The mobile half (the in-app path, Apple 5.1.1(v)) is a separate, later brief, and no mobile code calls the route yet.

Cloud session: GitHub checkout only, no box, no database, no secrets, no live API calls. Nothing was deployed.

---

## 1. Findings (row 1) — read before building

### F1. The route reports success when the Supabase Auth deletion did not run

`src/app/api/account/delete/route.ts` runs in this order:

1. `getCurrentUser()` → 401 if null.
2. `prisma.$transaction` that deletes the Prisma-side web-app data and ends with `tx.user.delete`.
3. `supabaseAdmin.auth.admin.deleteUser(user.id)` — *after* the transaction, inside its own `try`.
4. `return { success: true, message: "Account and all associated data deleted successfully", … }`.

Both the `authError` branch of step 3 and its `catch` log to `console.error` and fall through to step 4 (the in-code comment is "Don't fail the request if auth deletion fails - database is already cleaned up"). So a missing or invalid `SUPABASE_SERVICE_ROLE_KEY`, a missing `NEXT_PUBLIC_SUPABASE_URL`, or any Supabase admin error returns HTTP 200 `success: true` while the auth account and **all Supabase-side data survive**. That data is the user's real data: per the mobile repo's `supabase/migrations/001_mobile_schema.sql` + `002`, `user_profiles.id REFERENCES auth.users(id) ON DELETE CASCADE`, and `user_preferences`, `user_meal_config`, `user_streaks`, `meals`, `food_log_items`, `saved_meal_templates`, `user_overrides`, `weight_entries` all cascade from `user_profiles` (`nlp_failures_log.user_id` is SET NULL). `supabaseAdmin.auth.admin.deleteUser` is therefore the step that removes the food log, meals, targets, streaks, weigh-ins and saved meals; the Prisma tables (recipes, comments, likes, collections, follows) are the parked web app's.

The page cannot detect this: the response body is identical in both cases. Consequences for this PR:

- The done-state copy says the request was **accepted** and that the account can no longer be signed into **once processed**. It never says "everything has been deleted".
- The route was not widened (brief: Diego's call, separate PR). Two natural fixes, for that PR: (a) delete from Supabase Auth *first* and only then run the Prisma transaction, returning 5xx if the auth step fails; or (b) keep the order but return the auth result honestly (`success: false` / 502 with the Supabase error) so the client can tell the user to write in.

**Prisma-side scope of the route, for the record.** The transaction deletes recipes and their children, collections, comments, likes, both directions of `Follow`, then the `User` row. By schema, `Notification` (both relations), `UserPortionOverride` and `Follow` are `onDelete: Cascade` on `User`, so they go with `tx.user.delete` even though the transaction only deletes `Follow` explicitly. `RecipeView.userId` is optional with no `onDelete`, so Prisma's default for an optional relation applies: SET NULL. `NlpRequestLog.userId` is a bare `String` with no relation to `User`, so those rows are **orphaned** — the Magic Log text the privacy page says we keep "to find and fix bad matches" stays keyed to a user id that no longer exists. A finding, not a change.

One more observation: `getCurrentUser()` finds-or-creates the Prisma `User` row (`prisma.user.create` when no row matches the auth id or email), so a mobile-only account that never touched the web app gets a `User` row created by the deletion request itself and then deleted in the same request. The route's `404 User not found` is unreachable in practice, and mobile-only accounts *can* use the page.

### F2. Which origin can serve the page

The page itself is static and depends on nothing. The **route** it calls needs two things at request time:

- A reachable `DATABASE_URL`: `getCurrentUser()` reads/creates the Prisma `User` row before returning, and returns `null` on any database error, which the route turns into **401 Unauthorized** — for a user who *is* signed in.
- `SUPABASE_SERVICE_ROLE_KEY` (+ `NEXT_PUBLIC_SUPABASE_URL`) for the admin deletion — and per F1 its absence is *silent*.

The route also returns **503 "Not available during build"** when `NODE_ENV === 'production' && !DATABASE_URL` (its build-time guard), which on a Vercel deployment without a database URL is the steady-state answer, not a build-time one.

CLAUDE.md §Machine & Sync Topology: Vercel cannot reach the box's LAN IP; public access must go through the Cloudflare Tunnel / Funnel origin. So **unless the Vercel project's `DATABASE_URL` points at a Postgres Vercel can reach, the public deletion URL declared in the Play Data safety form must be the Funnel origin** (`https://dhl32-opt-5060.tail9ae316.ts.net/account/delete` or whatever public hostname fronts the box), not the Vercel site. On the Vercel preview, a 401 for a signed-in throwaway or a 503 is the deployment's database reach, not the page. The page body says this in a comment; the PR body says it to Diego.

### F3. State of the web auth surface the page reuses

- No web sign-in page exists: `src/app/signin/page.tsx` was deleted by `8efacb9c` (2026-07-21, "park web recipe app"). `src/middleware.ts` still redirects protected `/recipes/*` routes to `/signin`, and `AuthCard` still links `/signup` and `/forgot-password` — all dead. Untouched (not owned).
- `src/components/auth/AuthCard.tsx` had 0 importers. It is `"use client"`, calls `useSearchParams()`, signs in via `createSupabaseBrowserClient()` (`@supabase/ssr` `createBrowserClient`, so its cookies reach the route's server-side `getCurrentUser()`), then `router.replace(searchParams.get('redirectTo') || '/recipes')`. `/recipes` is gone. This PR mounts it on `/account/delete` and changes only that default (see §2).
- `AuthCard` also carries a "Continue with Google" OAuth button and the dead `/signup` link. Neither was added or removed by this PR (brief: add no sign-in path; AuthCard edits limited to the default). The Google flow's callback carries `redirectTo`, so it lands back on the page if Diego has the provider configured; the `/signup` link 404s. Worth a follow-up if the page is to be the public URL.
- `src/components/account/SettingsPanel.tsx`'s `handleDeleteAccount()` is an orphan from the parked web app and was the only client call to the route: two `confirm()`s → `fetch('/api/account/delete', { method: 'DELETE' })` → `supabase.auth.signOut()` → `window.location.href = '/?message=…'`. The card copies the fetch → sign-out sequence, replaces the dialogs with a typed `DELETE` confirmation, and shows a done state instead of redirecting to a `?message=` the landing page does not read.
- `src/app/auth/callback/route.ts` exchanges the code and redirects to `redirectTo`; the middleware rewrites `/?code=` to it. Unchanged.

---

## 2. What was built (rows 2–4)

| File | Change |
|---|---|
| `jest.config.js` | `components` project: `tsconfig: '<rootDir>/tsconfig.json'` → `tsconfig: { jsx: 'react-jsx' }` (one option, with a comment). |
| `src/components/account/DeleteAccountCard.tsx` | New client card: loading / signed-out / signed-in / done (+ an `unavailable` state when the browser client cannot be created). |
| `src/components/account/DeleteAccountCard.test.tsx` | New: 9 tests over the three states and the error paths, with `fetch`, `next/navigation`, the Supabase browser client and `AuthCard` mocked. |
| `src/app/account/delete/page.tsx` | New static page; renders the card inside `<Suspense>`. |
| `src/components/auth/AuthCard.tsx` | `redirectTo` default: `"/recipes"` → `usePathname() \|\| "/"`. 5 insertions, 2 deletions; file stays CRLF. |
| `src/app/privacy/page.tsx` | One sentence with a link to `/account/delete` before the email sentence; `LAST_UPDATED` → `4 October 2026`; `Block.p.text` widened to `ReactNode` so a paragraph can carry a link. `PRIVACY_CONTACT` and its sentence verbatim. |
| `reports/2026-10-04_cloud-account-delete-page.md` | This report. |

### The card

- **Auth detection** uses the browser client's `auth.getUser()` (server-validated, no database) and `onAuthStateChange` for the sign-in that happens on the same page. `INITIAL_SESSION` is ignored (it replays the cached session before `getUser()` answers). `getCurrentUser()` is never used client-side.
- **Signed out:** before `AuthCard` mounts, the card puts the page in the URL — `window.history.replaceState` to `?redirectTo=/account/delete` unless a `redirectTo` is already there — so `AuthCard`'s `router.replace(redirectTo)` lands back here. Next.js syncs `useSearchParams` with `replaceState`. The `AuthCard` default change is the belt to this brace.
- **Signed in:** the account's email, the plain-language scope list ("your account, profile and targets", "your food log and meals", "your saved meals, streaks and weigh-ins", "anything from the former web recipe app (recipes, comments, likes, collections)"), an input that must read exactly `DELETE`, and a destructive button disabled until it does.
- **The call:** `fetch('/api/account/delete', { method: 'DELETE', headers: { 'Content-Type': 'application/json' } })` — same-origin, so the `@supabase/ssr` cookies ride along. On `ok`: `supabase.auth.signOut()` (a failure here is `console.warn`ed, not fatal), then the done state. The `SIGNED_OUT` event from our own sign-out is ignored via a ref so the card does not flip back to the sign-in form.
- **Errors verbatim:** a JSON `error` string from the route is shown as-is (`Unauthorized`, `User not found`, `Failed to delete account. Please try again.`); a non-JSON failure shows `HTTP <status> <statusText>`; a network error shows its message. The card stays signed in so the user can retry.
- **Done copy:** "Your deletion request was accepted … Once it has been processed, this account can no longer be signed into … You have been signed out on this device", plus a pointer to the privacy-policy contact if they can still sign in later. Never "everything has been deleted" (F1). The test asserts the absence.
- No new environment variable; no `process.env` read in any new file.

### The page

Static (`force-static`, like `/privacy`): the server half depends on neither database nor auth, so it cannot 500. `<Suspense>` around the card is required — `AuthCard` calls `useSearchParams()`, and without the boundary `next build` fails prerendering with "Missing Suspense boundary with useSearchParams". The page explains the scope and points to the privacy policy's email path for people who cannot sign in.

### The privacy page

Inside "Keeping and deleting your data", before the unchanged email sentence: *"You can delete your account yourself, at any time, from the [account deletion page]."* Rendered text of the surrounding sentences is byte-identical; the source changed from a template string to a JSX fragment because a string cannot carry a link. The two `scripts/doc-check/claims.json` probes against `/privacy` (`Active Energy Burned`, `saved as your own entry`, `revoking access does not remove it`) are untouched by this edit.

`LAST_UPDATED` is set to today, 2026-10-04. The brief asks for the merge date: whoever merges on a different day should bump it.

### The jest fix, before and after

Baseline `jest.config.js` pointed the jsdom `components` project's ts-jest at `tsconfig.json`, whose `"jsx": "preserve"` makes ts-jest emit raw JSX. No `.test.tsx` had ever been committed, so nothing noticed.

| | Command | Result |
|---|---|---|
| Before | `npx jest --ci --selectProjects components src/components/account/DeleteAccountCard.test.tsx` on baseline config | `SyntaxError: Unexpected token '<'` at the first JSX in the test file (the AuthCard stub); **Test Suites: 1 failed, Tests: 0 total** |
| After | same, with `tsconfig: { jsx: 'react-jsx' }` | **Test Suites: 1 passed, Tests: 9 passed** |

ts-jest still loads `tsconfig.json` (paths, strictness) when given inline compiler options; only the JSX emit changes. The two ts-jest deprecation warnings (`globals` config, `isolatedModules`) are pre-existing and untouched. The `api` project is unchanged; a `.test.tsx` under `src/app/` still runs in no project (brief fact, not in scope).

---

## 3. Gates

All in a clean environment where noted: `env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="postgresql://x:y@localhost:5432/z" npm run test:ci`.

| Gate | Before (`a2c7b764`) | After (`cloud/account-delete-page`) |
|---|---|---|
| `npm ci` | exit 0 | — (same tree) |
| `npm run lint:ci` | 0 errors, 461 warnings, exit 0 | 0 errors, 461 warnings, exit 0 — no warning on any touched or new file |
| `npm run typecheck` | exit 0 | exit 0 |
| `npm run test:ci` (clean env) | 271 suites passed; 5482 passed, 1 skipped | **272** suites passed; **5491** passed, 1 skipped (+1 suite, +9 tests) |
| `npm run build` | not run at baseline | exit 0 with `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` set to dummies (CI sets the real ones): 15/15 static pages generated, `○ /account/delete` 479 kB first-load JS (AuthCard brings react-hook-form, zod and supabase-js), `○ /privacy` unchanged. Without any `DATABASE_URL` the build fails at "Collecting page data" on `/api/me/followers` (`PrismaClientConstructorValidationError`) — pre-existing, nothing to do with this PR, and not what CI runs. |

`npm run lint` was not used (broken at baseline per the brief). Line endings: `git ls-files --eol` census unchanged at 106 CRLF / 2 mixed / 1198 LF tracked text files; the only CRLF file touched (`AuthCard.tsx`) stays `i/crlf w/crlf` and its diff is 5+/2−.

---

## 4. For Diego — verifying the live page

1. Open the Vercel preview's `/account/delete` **with a throwaway account, never the shared tester account**. Signed out, you should see the explanation and the sign-in card; after signing in, the URL should be `/account/delete` and the card should show the throwaway's email.
2. Type `DELETE`, press the button. **A 401 for a signed-in throwaway, or a 503 "Not available during build", is the deployment's database reach (F2), not the page.** The same page served from the Funnel origin, where `DATABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, is the real test.
3. On a 200, the card says the request was accepted. Confirm in the Supabase dashboard that the auth user is gone — the page cannot (F1). If the user is still there, F1 fired: check `SUPABASE_SERVICE_ROLE_KEY` on that origin and the `console.error('Error deleting from Supabase Auth'…)` line in the service log.
4. Decide which origin's URL goes in the Play Data safety form (F2), and whether to take the route fix in F1 as a separate PR.

## 5. Not done / out of scope

- The route (`src/app/api/account/delete/**`) is unchanged — F1 is written up, not fixed.
- `src/middleware.ts`'s dead `/signin` redirect, `AuthCard`'s dead `/signup` / `/forgot-password` links and its Google button, and `SettingsPanel.tsx` are untouched.
- The mobile in-app deletion path (Apple 5.1.1(v)) is the later brief.
- Not merged; auto-merge is off and the PR waits on `build` and `Vercel` plus a human.
