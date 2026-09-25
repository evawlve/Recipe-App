# Security review of the backend API, with the mobile repo's Supabase migrations — 2026-09-24

Written by cloud session cloud-3 (brief "cloud-3"; mobile punch row #281). The trees reviewed:

- `evawlve/Recipe-App` `master` at `297aa2c` (merge of #448). This is the primary tree.
- `evawlve/KindaHealthyMobile` `main`, read only.

**What this session could and could not check.** The session had no box, database, device, `.env`, secrets or network access to the product. So:

- **Measured** means a command that ran in this checkout on 2026-09-24. Each one is quoted.
- **Reasoned** means read from code or config. Nothing reasoned here was exercised against a running API.
- **Not run** means the check needs a machine-side session. §5 lists those checks.

A clean checkout has neither a DB nor `.env`, so it cannot show which `DATABASE_URL` the Vercel and GitHub Actions side holds. Every finding that depends on that value says so.

## 0. Gates

The commands are the ones in the brief. `DATABASE_URL=postgresql://x:y@localhost:5432/z` was exported for `test:ci`.

| gate | `origin/master` `297aa2c` (baseline) | fixes head `cloud/security-fixes` |
|---|---|---|
| `npm ci` | exit 0 | (same lockfile) |
| `npm run test:ci 2>&1 \| tail -5` | `Test Suites: 250 passed, 250 total` · `Tests: 1 skipped, 5217 passed, 5218 total` · exit 0 | `Test Suites: 254 passed, 254 total` · `Tests: 1 skipped, 5235 passed, 5236 total` · exit 0 (+4 suites, +18 tests, 0 red) |
| `npm run lint:ci 2>&1 \| tail -2` | `0 errors and 34 warnings potentially fixable with the --fix option.` · exit 0 | `0 errors and 34 warnings potentially fixable with the --fix option.` · exit 0 (unchanged) |
| `npm run typecheck 2>&1 \| tail -3` | `tsc --noEmit` · exit 0 | exit 0 |

There is one extra check on the fixes head, which is not a brief gate. `DATABASE_URL=<dummy> NEXT_PUBLIC_SUPABASE_URL=https://unit.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npx next build` exited 0. It ran with no database behind it, as a compile check only.

This PR adds only this file. Its head therefore carries the baseline numbers by construction; they were re-run on the head and the results are in the PR description.

## 1. Corrections to the brief (reasoned, with the evidence)

These change how several findings rank, so they come first.

1. **`/api/_debug/*` is not routed at all.** In Next 15.5.12, `collectAppFiles()` in `node_modules/next/dist/build/entries.js` walks `app/` with `ignorePartFilter: (part)=>part.startsWith('_')`. Any path segment that starts with `_` is a private folder.
   - All four `_debug` handlers (`env`, `health`, `oops`, `whoami`) and `recipes/[id]/__save` are therefore dead code, not unauthenticated endpoints.
   - Re-derive: `grep -nE "startsWith\(['\"]_['\"]\)" node_modules/next/dist/build/entries.js`.
   - **Measured** on the fixes head's `next build` (above): the printed route table has no `_debug` or `__save` line (`grep -c "__save\|_debug" <build log>` → `0`), and `ls .next/server/app/api/_debug` → `No such file or directory`. The routed siblings `/api/debug/foods`, `/api/oops` and `/api/health` are all listed.
   - Machine-side confirmation: `curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/_debug/env` should print 404.
   - Rename or delete these folders. Otherwise someone "fixing" the folder name turns `_debug/env` (DB host, path and query string) into a live anonymous route (L1).
2. **Two of the three "key-only" routes also accept any web cookie session.**
   - `admin/food-stats` falls back to `getCurrentUser()` with `const isAdmin = true; // TODO`, so any signed-in web user passes (M3).
   - `foods/map` falls back to `getCurrentUser()` but scopes the write to the caller's own recipes. That is correct.
   - Only `foods/[id]/serving` is key-only.
   - Re-derive: `grep -n "getCurrentUser\|isAdmin" src/app/api/admin/food-stats/route.ts src/app/api/foods/map/route.ts`.
3. **The cron pairs are 03:00 and 03:30 UTC, not both at 03:00.**
   - `nightly-rollup.yml` and `cron-rollup.yml` both fire at `0 3 * * *`.
   - `nightly-similar.yml` and `cron-similar.yml` both fire at `30 3 * * *`.
   - Each job runs twice nightly (L3).
   - Re-derive: `grep -n "cron:" .github/workflows/*.yml`.
4. **`.env.example` has 104 names, not about 103.** Re-derive: `grep -cE '^[A-Z_][A-Z0-9_]*=' .env.example` → `104`.
5. **`weight_entries` is recorded as APPLIED, not PROPOSED.** `plans/v1/profile-goals-and-weight.md` marks its DDL **APPLIED 2026-08-31** ("receipt: 7 cols, rls=true, pol=1"). It still has no migration file, so the live RLS is not auditable from either checkout.
6. **UPDATE / `FOR ALL` policies with `USING` but no `WITH CHECK` are not a re-ownership hole.** Postgres applies the `USING` expression to the new row when `WITH CHECK` is absent.
7. **Dependabot alerts: not re-run.** This session has no `gh` CLI and no dependabot-alerts tool. The brief's statement that `gh api repos/evawlve/Recipe-App/dependabot/alerts` returns 403 (alerts disabled) is carried as finding M8 on the brief's evidence, labelled **not re-verified here**.

## 2. Findings, ranked

Each finding gives the route or symbol, the caller class, the input and its outcome, the evidence, and a PROPOSED patch with a test. Four findings are already patched on the separate branch `cloud/security-fixes`, marked **[fixed in cloud/security-fixes <sha>]**.

### CRITICAL

#### C1. `next@15.5.12` has an unauthenticated RCE advisory in the Image Optimizer, and `images.remotePatterns` admits every https host

- **Caller:** anonymous, on any origin that serves `/_next/image`. On the box that includes the public Funnel origin, if the Funnel forwards `/_next/*`. That is not verifiable here.
- **Input → outcome:** `GET /_next/image?url=https://attacker.example/x.avif&w=64&q=75`. The optimizer fetches and decodes the attacker's AVIF.
  - GHSA-2xp9-vwfh-vxw4 is "Unauthenticated Remote Code Execution in Image Optimization API when AVIF files are used", affecting `>=10.0.0 <15.5.24`.
  - The same `npm audit` lists GHSA-p293-qw3h-jr36 (critical, Windows-hosted only, so not the Linux box), several high DoS advisories, and several middleware-bypass advisories.
  - The middleware-bypass class does not reach API auth, because every API route authenticates in its own handler. The web pages' `protectedRoutes` check in `src/middleware.ts` is affected. (reasoned)
- **Why the config makes this reachable:** `next.config.ts` has `images.remotePatterns: [..., { protocol: 'https', hostname: '**' }]` and `images.domains: ['localhost']` with `unoptimized: false`.
  - The first entry turns the optimizer into an open fetch-and-decode proxy for any https host.
  - The second allows `localhost` URLs. `domains` matches on hostname, so any port matches. That gives blind SSRF and port probing against the box's loopback services (Typesense `:8108`, Postgres `:5432`). Only image content types are returned. (reasoned)
- **Evidence (measured):**
  - `node -p "require('next/package.json').version"` → `15.5.12`.
  - `npm audit --omit=dev --json` → `next` severity `critical`, with advisories up to `<15.5.24`.
  - `sed -n 45,58p next.config.ts`.
- **Patch (PROPOSED).** Bump within the 15.x line; this is the smallest change. Dependabot's open PR to `16.3.1` is a major upgrade and also clears the range (`npm audit` lists `next` as vulnerable through `16.3.0-preview.10`).

  ```diff
  --- a/package.json
  -        "next": "15.5.12",
  +        "next": "15.5.24",
  --- a/next.config.ts
     images: {
       remotePatterns: [
         {
           protocol: 'https',
           hostname: process.env.NEXT_PUBLIC_CLOUDFRONT_HOST || 'd3abc123xyz0.cloudfront.net'
         },
  -      // Fallback for other external images
  -      { protocol: 'https', hostname: '**' }
       ],
  -    // Enable image optimization for /api/image/... proxy routes
  -    domains: ['localhost'],
  +    formats: ['image/webp'],
       unoptimized: false
     },
  ```

  Regenerate `package-lock.json` with `npm install`, never by hand. Only the web app uses `next/image`: `grep -rln "next/image" src --include=*.tsx | wc -l` → 10 files. Check them for non-CloudFront hosts before dropping `**`.
- **Test that pins it:**

  ```ts
  // src/lib/__tests__/next-config-images.test.ts
  import config from '../../../next.config';
  test('the image optimizer admits no wildcard host and no localhost', () => {
    const pats = (config.images?.remotePatterns ?? []) as Array<{ hostname: string }>;
    expect(pats.map(p => p.hostname)).not.toContain('**');
    expect(config.images?.domains ?? []).not.toContain('localhost');
  });
  test('next is at or above the 15.5.24 advisory floor', () => {
    const [maj, min, pat] = require('next/package.json').version.split('.').map(Number);
    expect(maj > 15 || (maj === 15 && (min > 5 || (min === 5 && pat >= 24)))).toBe(true);
  });
  ```
- **Deploy:** Lane A's window. It needs `npm ci` on the box plus a rebuild.

#### C2. `POST /api/recipes/[id]/ingredients` let anyone wipe and replace any recipe's ingredients **[fixed in cloud/security-fixes 1302ade]**

- **Caller:** anonymous. The route had no auth call at all.
- **Input → outcome:**
  - `POST /api/recipes/<any id>/ingredients {"items":[]}` runs `prisma.ingredient.deleteMany({ where: { recipeId } })` through `upsertRecipeIngredients()` in `src/lib/recipes/ingredients.server.ts`. Every ingredient is gone.
  - `items` of any length is a `createMany` of that many rows.
  - Recipe ids are enumerable. The feed and search routes return them, and mobile 003 lets any signed-in Supabase user read `Recipe` (L8).
- **Evidence (reasoned):**
  - `cat 'src/app/api/recipes/[id]/ingredients/route.ts'` on `297aa2c`.
  - No in-repo caller POSTs it: `grep -rn "ingredients" src/components --include=*.tsx | grep -i post` → nothing.
- **Patch:** on the fixes branch. The route requires `getCurrentUser()` and returns 401 anonymous, 403 for a non-author, 404 for an unknown recipe. It caps `items` at 200 (400 above that).
- **Test:** `src/app/api/recipes/[id]/ingredients/route.auth.test.ts`, 5 cases.

### HIGH

#### H1. `/api/nlp/parse` has no bound on `items[]` or `text`, and each request is charged once however much paid work it does

- **Caller:** any bearer user (the alpha client, or anyone who signs up). Rate-limited to 10/min and 100/day, but per *request*.
- **Input → outcome:**
  - `{"items": [<5,000 strings>]}` → `items.map` → `Promise.all(items.map(buildParsedItem))`. That is 5,000 concurrent mapper runs in one request, each doing retrieval and possibly model calls.
  - The two per-request budgets cap only LLM *nutrition* backfill (`AI_NUTRITION_MAX_PER_REQUEST`, default 3) and *hydration* (`AI_NUTRITION_HYDRATION_MAX_PER_REQUEST`, default 20).
  - The other structured purposes are not under a per-request allowance: `normalize`, `serving`, `ambiguous`, `produce`, `simplify` (`STRUCTURED_LLM_PURPOSES` in `src/lib/ai/llm-purposes.ts`).
  - The charge half writes **one** `NlpRequestLog` row per request, so 100 requests a day buys unbounded lines.
  - A long `text` goes whole into the segmenter prompt. `singleItemFromText()` only short-circuits at ≤ 60 chars, and `maxTokens: 600` bounds output, not input.
  - A DoS here is a model bill plus Postgres pool exhaustion on the box.
- **Evidence (reasoned):** re-derive with
  - `grep -n "Promise.all(items.map" src/app/api/nlp/parse/route.ts`
  - `grep -rn "createAi[A-Za-z]*Budget" src/lib --include=*.ts | grep -v test`, which finds only `createAiNutritionBudget`.
- **Patch (PROPOSED).** It is the production parse route, so it is not on the fixes branch. Pick the caps from the mobile client's real maximum; the mobile composer's limit was not measured here.

  ```diff
  --- a/src/app/api/nlp/parse/route.ts
  +const MAX_PARSE_TEXT_CHARS = 2000;
  +const MAX_PARSE_ITEMS = 40;
  @@ POST, after `const { text, items: inputItems } = body;`
  +    if ((typeof text === 'string' && text.length > MAX_PARSE_TEXT_CHARS) ||
  +        (Array.isArray(inputItems) && inputItems.length > MAX_PARSE_ITEMS)) {
  +      return NextResponse.json({ error: 'Request too large' }, { status: 413 });
  +    }
  ```

  Also cap the segmenter's output item count to `MAX_PARSE_ITEMS`, since a 2,000-character line can still split into many items.
- **Test:** `route.bounds.test.ts` beside `route.rate-limit.test.ts`, reusing that file's mocks.
  - A 41-item body → 413, and the mapper mock is never called.
  - A 2,001-character `text` → 413, and `callStructuredLlm()` is never called. Stub it with `jest.mock('@/lib/ai/structured-llm', ...)` per the repo's convention.
  - A 40-item body proceeds.

#### H2. The parse limiter is count-then-charge, so concurrency and DB errors bypass it

- **Caller:** any bearer user.
- **Input → outcome:**
  - The COUNT runs in the route preamble. The CHARGE (`prisma.nlpRequestLog.create`) runs after the mapper finishes.
  - N parallel requests sent in the same instant all read the same count, below `perMinute`, and all do paid work. 50 parallel requests pass a 10/min limit.
  - The COUNT's `catch` is explicitly "Fail open in case of DB tracking error", so a slow or failing `nlp_requests_log` read disables the limiter.
- **Evidence (reasoned):**
  - `grep -n "Fail open\|nlpRequestLog.count\|nlpRequestLog.create" src/app/api/nlp/parse/route.ts`
  - The header of `src/lib/nlp/parse-rate-limit.ts` describes the split.
- **Patch (PROPOSED).**
  - Reserve before work: insert a provisional `NlpRequestLog` row in the preamble, inside the same transaction as the count (or use `pg_advisory_xact_lock(hashtext(userId))`).
  - After the mapper, delete the row when `isFreeParseRequest()` is true. That keeps the "free requests cost nothing" contract.
  - Add a per-user in-flight cap: an in-process `Map<userId, number>`, refusing more than 2 concurrent requests. The box runs one process.
  - Fail closed after N consecutive count errors, instead of always failing open.
- **Test:** in `route.rate-limit.test.ts`.
  - Mock `nlpRequestLog.count` to resolve 9 for every call, and fire 5 concurrent requests with `perMinute=10`. Assert that at most 1 reaches the mapper mock.
  - Assert that a count rejection yields 503, not a mapper call.

#### H3. The `isDevBypass` email allowlist is only as strong as Supabase's email confirmation

- **Caller:** anyone who can create a Supabase user with an allowlisted email.
- **Input → outcome:**
  - `api/nlp/parse/route.ts` sets `isDevBypass = true` for `userEmail.endsWith('@google.com') || userEmail === 'diego@example.com'`.
  - A bypass user skips both limits and gets the admin flags `nocache=1`, `debug=1` and `nosave=1`.
  - `diego@example.com` is an unreceivable address (RFC 2606). The mobile client signs up directly against Supabase with the public anon key. So if **Confirm email** is off in the Supabase dashboard, anyone can register it (if it is free), or any `x@google.com`, and get unlimited paid parsing.
  - With confirmation on, `@google.com` needs a real Google mailbox. That is presumably the intended Play-review path.
  - Also relevant: `request-auth.ts` reads `user.email` from GoTrue's `getUser()` and does not check `email_confirmed_at`.
- **Evidence (reasoned):** `grep -n "endsWith('@google.com')\|diego@example.com" src/app/api/nlp/parse/route.ts`. The dashboard setting is **not run**.
- **Patch (PROPOSED).**

  ```diff
  --- a/src/lib/auth/request-auth.ts
  -      return { via: 'bearer', userId: user.id, email: user.email || null };
  +      // An unconfirmed address is not an identity claim; allowlists key on email.
  +      const email = user.email && user.email_confirmed_at ? user.email : null;
  +      return { via: 'bearer', userId: user.id, email };
  --- a/src/app/api/nlp/parse/route.ts
  -    userEmail.endsWith('@google.com') ||
  -    userEmail === 'diego@example.com'
  +    userEmail.endsWith('@google.com')
  ```

  Alternatively, move the allowlist to an env var of exact addresses, shaped like `NOSAVE_TESTER_EMAILS`. The doc-check claim `dev-bypass-email-substring-removed` greps this route's allowlist, so keep it inline and re-run `npm run doc-check` machine-side.
- **Test:** `request-auth.test.ts`: `getUser` resolving `{ email: 'x@google.com', email_confirmed_at: null }` → `email: null`. In `route.rate-limit.test.ts`: that user is counted and charged.

#### H4. `POST /api/upload` hands anonymous callers S3 upload credentials, and `GET /api/image/[...key]` reads any object in the bucket

- **Caller:** anonymous for both. Neither route calls an auth function.
- **Input → outcome:**
  - `POST /api/upload {"filename":"a.png","contentType":"image/png"}` returns a presigned POST valid for 60 s and up to 15 MB. It is unbounded in count, so anyone can store arbitrary bytes labelled `image/*` in the bucket, at the project's S3 cost.
  - `GET /api/image/<anything>` runs `GetObjectCommand({ Key: keyArray.join('/') })` with no prefix check. Any object in `S3_BUCKET` is readable through the server's IAM credentials, not only `avatars/` and `uploads/`.
  - What else lives in that bucket, and the IAM policy's scope, are **not verifiable** here.
- **Evidence (reasoned):** `grep -n "getCurrentUser\|GetObjectCommand\|Key:" src/app/api/upload/route.ts 'src/app/api/image/[...key]/route.ts'`.
- **Patch (PROPOSED).** Web-app routes; the mobile client uses neither (`grep -rhoE "api/[a-z/]+" src` in the mobile checkout).

  ```diff
  --- a/src/app/api/upload/route.ts
  +  const { getCurrentUser } = await import('@/lib/auth');
  +  const user = await getCurrentUser();
  +  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  --- a/src/app/api/image/[...key]/route.ts
     const key = keyArray.join("/");
  +  if (!/^(avatars|uploads)\/[A-Za-z0-9._-]+$/.test(key)) {
  +    return NextResponse.json({ error: "Not found" }, { status: 404 });
  +  }
  ```

  Check the web sign-up flow first: an avatar upload before the session exists would break.
- **Test:** `upload/route.auth.test.ts`: no user → 401, and `createPresignedPost` (mocked) is never called. `image/route.key.test.ts`: `['private','x']` → 404 and `S3Client.send` is never called; `['avatars','a.png']` reaches `send`.

#### H5. CI hands production-grade secrets to every step of every push and same-repo PR

- **Caller:** anyone who can push a branch to `evawlve/Recipe-App` (collaborators and cloud sessions), and any compromised npm dependency's install script.
- **Input → outcome:**
  - `.github/workflows/ci.yml` sets job-level `env:` with `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, `DEV_API_KEY` and more.
  - Every step inherits them, including `npm ci` (all lifecycle scripts), `npm run test:ci` (any test file on the branch) and `next build`.
  - A branch that adds `console.log(process.env.SUPABASE_SERVICE_ROLE_KEY)` to a test gets it into the Actions log (masked, but trivially exfiltrated by encoding it).
  - No workflow except `size.yml` declares `permissions:`, so `GITHUB_TOKEN` scope is the repo default. That default is **not readable** here.
  - Whether `secrets.DATABASE_URL` is the box, Supabase or a throwaway is **not readable** from a checkout.
- **Evidence (reasoned):**
  - `grep -nE "^\s*[A-Z_]+: \\$\{\{ secrets" .github/workflows/ci.yml`
  - `for w in .github/workflows/*.yml; do echo "$w $(grep -c 'permissions:' $w)"; done`
- **Patch (PROPOSED; `.github/**` is code-owned, and this session may not edit it):**

  ```diff
  --- a/.github/workflows/ci.yml
  +permissions:
  +  contents: read
   jobs:
     build:
  -    env:
  -      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
  -      DATABASE_URL: ${{ secrets.DATABASE_URL }}
  -      AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
  -      DEV_API_KEY: ${{ secrets.DEV_API_KEY }}
  +    env:
  +      DATABASE_URL: postgresql://ci:ci@localhost:5432/ci   # build/test need a string, not a DB
  ```

  `build` = lint + typecheck + test + `next build`, and none of those should need a live credential (reasoned; `test:ci` already passes here with a dummy `DATABASE_URL`). Any step that truly needs a secret gets a step-level `env:`.
- **Test:** none in jest. The pin is a `danger` rule or a doc-check claim: `grep -c 'SERVICE_ROLE_KEY' .github/workflows/ci.yml` → `0`.

#### H6. `/api/fatsecret/barcode` was an anonymous open proxy onto the FatSecret API **[fixed in cloud/security-fixes d0ea9b2]**

- **Caller:** anonymous.
- **Input → outcome:** `GET /api/fatsecret/barcode?barcode=<n>`. Each call spends FatSecret quota, which is licensed and under an open attribution audit (backend `CLAUDE.md` §Attribution), and republishes the FatSecret record to anyone. The 500 body also echoed `error.message`.
- **Evidence:** the route on `297aa2c` had no auth call. `grep -rn "fatsecret/barcode" src` in both repos finds no client caller.
- **Patch:** `authenticateRequest(req, { accept: ['key','bearer'] })`, the same as `/api/foods/barcode`, and a fixed 500 body.
- **Test:** `src/app/api/fatsecret/barcode/route.auth.test.ts`, 4 cases.

### MEDIUM

#### M1. The bearer path costs one GoTrue round trip per request, and anonymous callers can trigger it

- **Caller:** anonymous. Any `Authorization: Bearer <garbage>` on the 5 bearer routes costs one `auth.getUser(jwt)` call.
  - That includes `/api/ok`, which accepts `bearer` but only ever uses `key` to authorize its `llm` block.
  - There is no in-process `exp`/shape pre-check and no cache.
- **Input → outcome:**
  - A flood of fake bearers costs the box nothing but consumes the project's GoTrue rate budget from the box's egress IP. Real users then read `auth_unavailable`/`invalid_bearer`, which amounts to a denial of service of the alpha.
  - A valid user's every request costs about one extra network round trip of latency.
- **Service-role exposure:**
  - `getSupabaseAuthClient()` prefers `SUPABASE_SERVICE_ROLE_KEY` over the anon key. `getUser(jwt)` works with either (the file's own header says so).
  - Holding the service-role key in the API process means any RCE or SSRF-to-env in that process (see C1) yields a key that bypasses every RLS policy in §3.
  - The anon-key fallback is the least-privilege choice for this call.
- **Evidence (reasoned):** `sed -n '/export function getSupabaseAuthClient/,/^}/p' src/lib/supabase/admin.ts`; `grep -n "accept:" src/app/api/ok/route.ts`.
- **Patch (PROPOSED):**

  ```diff
  --- a/src/lib/supabase/admin.ts
  -  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  +  // getUser(jwt) validates the JWT itself; the anon key is sufficient and least-privilege.
  +  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  --- a/src/lib/auth/request-auth.ts
  +  // Cheap local refusal before any network: three base64url segments and an unexpired `exp`.
  +  if (!looksLikeUnexpiredJwt(token)) return { via: null, reason: 'invalid_bearer' };
  --- a/src/app/api/ok/route.ts
  -  const auth = await authenticateRequest(req, { accept: ['key', 'bearer'] });
  +  const auth = await authenticateRequest(req, { accept: ['key'] });
  ```

  Changing `/api/ok` alters its `auth.via` echo for bearer callers. Check the mobile `api/ok` consumer first; the mobile grep shows one reference. A short (≤ 60 s) positive cache keyed by `sha256(token)` would remove the per-request round trip. It is not proposed here, because it delays a revocation by that TTL.
- **Test:** `request-auth.test.ts`: `Bearer not-a-jwt` → `invalid_bearer`, and `mockGetUser` is never called. A JWT with `exp` in the past → the same.

#### M2. `foods/search`, `foods/barcode` and `foods/[id]` have no limiter, and `foods/barcode` fans out upstream and writes rows

- **Caller:** any bearer user.
- **Input → outcome:**
  - `GET /api/foods/barcode?code=<random>` in a loop. Each call hits FatSecret (`lookupFatSecretBarcode()`) and then Open Food Facts (`getOffProductByBarcode()`), and may persist rows (`ensureFoodCached()`, `hydrateOffCandidate()`).
  - OFF rate-limits product reads per IP, so one user can get the box's IP throttled or blocked for everyone. (reasoned; OFF's current published limit was not re-read.)
  - `code` is not format-checked. It is `encodeURIComponent`-ed into the OFF URL, so this is not SSRF.
  - `foods/search?s=` has a ≥ 2-character floor and no ceiling.
  - `foods/search?withImpact=1&recipeId=<any>` runs `computeTotals()` on any recipe. That is a read IDOR on recipe totals, low value.
- **Evidence (reasoned):** `grep -ln "rateLimit\|nlpRequestLog" src/app/api/foods/*/route.ts src/app/api/foods/\[id\]/route.ts` → nothing.
- **Patch (PROPOSED).**
  - Validate `code` as `/^\d{6,14}$/` (400 otherwise).
  - Cap `s` at 200 characters.
  - Add a per-`userId` in-process token bucket in a shared `src/lib/auth/user-rate-limit.ts`, keyed on `auth.userId`, never on `x-forwarded-for`. For example 60/min for search and 20/min for barcode, env-tunable like `readParseLimits()`.
- **Test:** `foods/barcode/route.code.test.ts`: `code=abc` → 400, and the lookups are never called. A limiter unit test: the 21st call in a window → false.

#### M3. `/api/admin/food-stats` authorizes any signed-in web user as admin

- **Caller:** any web cookie session. Web sign-up is open (`api/auth/signup`).
- **Input → outcome:** returns corpus-wide aggregate stats. The data is low sensitivity. The defect is that an "admin" route's authorization is a hard-coded `true`.
- **Evidence (reasoned):** `grep -n "isAdmin" src/app/api/admin/food-stats/route.ts` → `const isAdmin = true; // TODO`.
- **Patch (PROPOSED).** Make it key-only, as its sibling `foods/[id]/serving` already is: delete the `getCurrentUser()` fallback and use `matchesDevApiKey(req)`. The `#23` key surface grows by nothing, because the key already works here.
- **Test:** `admin/food-stats/route.auth.test.ts`: a mocked `getCurrentUser` returning a user, with no key → 401.

#### M4. The web app's cookie routes have IDORs on shared or foreign rows

All of these need a web cookie session, which anyone can get.

- **`POST /api/recipes/[id]/tags/accept`:** selects `authorId` and never compares it, so any user tags any recipe.
- **`POST /api/recipes/[id]/compute-nutrition`:** any user recomputes any recipe's `Nutrition` row. The body's `goal` is written into it, so a caller can change the recipe's displayed goal.
- **`POST /api/foods/[id]/units` and `/aliases`:** any user adds `FoodUnit`/`FoodAlias` rows to shared `Food` rows.
  - Units feed `deriveServingOptions()` for every reader of that food through `foods/[id]`'s legacy branch, so this is shared-corpus poisoning of serving weights.
  - That branch runs only when `FATSECRET_CACHE_MODE` misses. Whether mobile ever reads a legacy `Food` row is **not measured**.
- **Evidence (reasoned):** `grep -n "authorId" 'src/app/api/recipes/[id]/tags/accept/route.ts' 'src/app/api/recipes/[id]/compute-nutrition/route.ts'`.
- **Patch (PROPOSED).** Add `if (recipe.authorId !== user.id) return 403` in `tags/accept` and `compute-nutrition`. For units and aliases, allow only `food.createdById === user.id`, otherwise mark rows `verification: 'community'` and exclude them from `deriveServingOptions()` for other users.
- **Test:** one `route.auth.test.ts` per route, shaped like the C2 test.

#### M5. The auth limiter keys on a spoofable header and one shared bucket

- **Caller:** anonymous, on `api/auth/signin`, `signup` and `reset-password`.
- **Input → outcome:**
  - `getClientIp()` in `src/lib/auth/rate-limit.ts` trusts the first `x-forwarded-for` entry, then `x-real-ip`, then the literal `'unknown'`.
  - A client that sends its own `X-Forwarded-For: <random>` gets a fresh bucket per request. Whether the Funnel or Vercel appends to, or overwrites, a client XFF is **not verifiable** here.
  - Behind a proxy that strips XFF, every client shares `'unknown'`, so one attacker locks out all web sign-ins.
  - Every attempt reaches Supabase from the server's IP, so Supabase's own per-IP limit then locks out all web users.
  - The `Map` is in-memory, so it resets on every restart.
- **Evidence (reasoned):** `sed -n '/export function getClientIp/,/^}/p' src/lib/auth/rate-limit.ts`.
- **Patch (PROPOSED).** Use the right-most XFF entry that was added by a proxy you trust, configured by an env var such as `TRUSTED_PROXY_HOPS` (default 1). On Vercel, prefer `x-vercel-forwarded-for`. Also key sign-in on the submitted email (lowercased), not only on IP.
- **Test:** `rate-limit.test.ts`: with `TRUSTED_PROXY_HOPS=1`, `x-forwarded-for: evil, 1.2.3.4` → `1.2.3.4`, and 6 sign-ins for one email from 6 different XFFs → the 6th is 429.

#### M6. Supabase (mobile migrations): `recompute_user_streak` is probably callable by anyone for any user, and several legacy tables have unknown RLS

The data comes from the mobile checkout's `supabase/migrations/001`–`011`, read on 2026-09-24. All of it is reasoned; no Supabase call was made.

- **`recompute_user_streak(p_user_id UUID, p_reset_longest BOOLEAN)` (010).**
  - It is `SECURITY DEFINER SET search_path = public, pg_temp` and never compares `p_user_id` to `auth.uid()`.
  - The only grant change is `REVOKE ALL … FROM PUBLIC`. Supabase's default privileges grant `EXECUTE` to `anon` and `authenticated` directly, and a PUBLIC revoke does not remove those grants.
  - So `POST /rest/v1/rpc/recompute_user_streak {"p_user_id":"<victim>","p_reset_longest":true}` probably works with the public anon key.
  - Impact is integrity only: the function recomputes from the victim's real history, so the worst case is a downward reset of `longest_streak`.
  - Victim ids come from `Recipe."authorId"` (L8).
  - **Fix (PROPOSED, a new mobile migration):**

    ```sql
    REVOKE EXECUTE ON FUNCTION public.recompute_user_streak(UUID, BOOLEAN) FROM anon, authenticated;
    ```

  - **Verify:** `select has_function_privilege('anon','public.recompute_user_streak(uuid,boolean)','execute'), has_function_privilege('authenticated','public.recompute_user_streak(uuid,boolean)','execute');` should give `f, f`.
- **Legacy tables 011 kept.** `"User"`, `LogEntry`, `DailyLog`, `UserPortionOverride`, `PortionOverride`, `Food`, `FoodAlias`, `FoodUnit`, `Barcode` and `IngredientFoodMap` are still in `public`, and neither repo records their RLS state.
  - `LogEntry`, `DailyLog` and `UserPortionOverride` are per-user.
  - **Verify:** `select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace order by 1;`
- **No size bounds on client-writable tables.** The only exception is `nlp_failures_log`, whose INSERT policy is `length(input_text) <= 2000 AND length(error_message) <= 1000`. Examples of unbounded columns:
  - `food_log_items.metadata` (jsonb)
  - `saved_meal_templates.items` (jsonb)
  - `weight_entries.note`
  - With open sign-up and a free-tier DB cap, one account can fill the database. That is a denial of service for every user.
- **Other items, LOW:**
  - `handle_new_user()` (004) deletes `user_profiles` rows by a mutable `email`.
  - `create_default_meal_config()` (001) has no pinned `search_path`. It is a trigger, so it is not callable through rpc.

**What RLS must hold, given the public anon key.** `EXPO_PUBLIC_SUPABASE_ANON_KEY` is compiled into the app and committed in the mobile repo's `.env.development` / `.env.production`; it decodes to `role: anon`, which is public by design. So RLS must hold all of the following:

- Every `public` table either has RLS enabled with `auth.uid()`-scoped policies, or has no grants to `anon`/`authenticated`.
- No `SECURITY DEFINER` function is executable by `anon`/`authenticated` unless it derives the user from `auth.uid()`.
- No client-writable column is unbounded.

The seven client-used tables pass the first rule as written in the migrations:

| table | as written in the migrations |
|---|---|
| `food_log_items` | `FOR ALL USING (auth.uid() = user_id) WITH CHECK (… AND meal owned by auth.uid())`, from 005 |
| `meals`, `saved_meal_templates`, `user_preferences` | `FOR ALL USING (auth.uid() = user_id / id)` |
| `user_streaks` | SELECT only |
| `nlp_failures_log` | INSERT only, `TO authenticated`, `user_id = auth.uid()` |
| `weight_entries` | the plan doc's `FOR ALL USING (auth.uid() = user_id)`; **not auditable** |

#### M7. `ILIKE ${brand}` in `hydration-lane.ts` binds the value but not its wildcard meaning (INFO-level; listed here with the SQL review)

All nine `$queryRaw` sites are tagged templates with bound parameters. `grep -rnE "\\\$queryRawUnsafe|\\\$executeRawUnsafe|Prisma\.raw\(" src --include=*.ts | grep -v test | wc -l` → `0`.

- `api/health`, `api/_debug/health` (unrouted, §1) and `ops/stuck-keys.ts` have no user input or only bound input.
- `api/search/suggest` ×2 binds `lowerQ` everywhere.
- `validated-mapping-helpers.ts` (`AiNormalizeCache` touch) binds `normalizedKey`.
- `ambiguous-unit-backfill.ts`:
  - Its regex argument is built from `unitStem`, which is already stripped to `[a-z]` by `.replace(/[^a-z]/g, '')`.
  - So there is no regex injection and no ReDoS.
- `hydration-lane.ts` ×3:
  - Its `"brandName" ILIKE ${brand}` is bound. A `%` or `_` inside `brand` still acts as a LIKE wildcard.
  - That is a matching-semantics question for the mapping pipeline, not injection. It is under `src/lib/mapping/`, so it is out of this PR's scope.
- **No injection found.**

#### M8. Dependabot alerts are disabled, and the open dependabot PRs cover one advisory set

- **Alerts:** per the brief, `gh api repos/evawlve/Recipe-App/dependabot/alerts` → 403 (alerts disabled). **Not re-run here.**
- **Measured, backend** `npm audit --omit=dev` (2026-09-24): `{'low': 1, 'moderate': 19, 'high': 11, 'critical': 2, 'total': 33}`.
  - critical: `next` (C1) and `fast-xml-parser` (via `@aws-sdk/*`; fix `@aws-sdk/s3-presigned-post@3.1139.0`)
  - high: `@huggingface/transformers`, `adm-zip`, `brace-expansion`, `glob`, `minimatch`, `nanoid` (direct), `onnxruntime-node`, `picomatch`, `postcss` (direct), `sharp`, `ws`
- **The five open dependabot PRs, cross-referenced:**
  - Only `next` 15.5.12 → 16.3.1 addresses an audited advisory. It is a major upgrade; C1 proposes 15.5.24.
  - `@supabase/ssr` 0.7.0 → 0.12.4, `@radix-ui/react-checkbox`, `@hookform/resolvers` and `@testing-library/react` do not appear in the audit output.
  - None of the PRs touches `@aws-sdk/*`, `nanoid`, `postcss`, `sharp` or `ws`.
- **Measured, mobile** (`npm audit --omit=dev` from its lockfile): `{'moderate': 15, 'high': 9, 'critical': 0, 'total': 24}`.
  - Nearly all are build-time: Metro, `@expo/*` config plugins, `@xmldom/xmldom`, `js-yaml`, `image-size`, `shell-quote`, `brace-expansion`, `browserslist`.
  - npm's suggested "fix" is a semver-major *downgrade* of `expo`. Do not apply it; update within SDK 56.
- **Patch (PROPOSED):**
  - Enable Dependabot alerts in repo settings (a machine-side or owner action).
  - Bump `@aws-sdk/client-s3` and `@aws-sdk/s3-presigned-post` together to ≥ 3.1139.0.
  - Bump `nanoid` and `postcss` within their majors.

### LOW

#### L1. Anonymous test and debug routes

- `/api/oops` and `/api/sentry-example-api` are routed, anonymous and throw on purpose. That is log noise, and each one is an unauthenticated 500 on demand.
- `/api/health` returned the Prisma error text. **[fixed in cloud/security-fixes 2c25d63]**
- `/api/debug/foods` 404s when `NODE_ENV === 'production'` (correct).
- The four `_debug/*` handlers are unrouted (§1). Delete them.
- **Patch (PROPOSED):** delete `src/app/api/oops`, `src/app/api/sentry-example-api` and `src/app/api/_debug`. The pin is a test that globs `src/app/api/**/route.ts` and asserts none of those paths exist.

#### L2. Secret comparisons were not constant-time **[fixed in cloud/security-fixes 5003a86]**

- The cron routes compared `secret !== process.env.CRON_SECRET`, and `matchesDevApiKey()` compared with `===`. Both already failed closed when the env was unset.
- They now use `safeEqualSecret()` (SHA-256 on both sides, then `timingSafeEqual`).
- The three inline `DEV_API_KEY` compares in `foods/[id]/serving`, `foods/map` and `admin/food-stats` are left as they are: that surface is #23's, which is parked. They should call `matchesDevApiKey()` when #23 is un-parked.
- Remote timing attacks over the internet are weak, so this ranks low.

#### L3. Duplicated nightly jobs, with two credential paths into the same work

- `nightly-rollup.yml` POSTs `$VERCEL_URL/api/admin/cron/rollup` with `X-Cron-Secret`, while `cron-rollup.yml` runs `scripts/rollup-interactions.ts` directly with `secrets.DATABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Both run at 03:00 UTC.
- The `similar` pair does the same at 03:30 UTC.
- Unless the Vercel deployment's `DATABASE_URL` and the Actions secret point at different databases (**not readable**), each job runs twice a night against the same data.
  - Is that safe? `rollupInteractions()` idempotency was not checked here.
- Either way, the Actions path keeps a direct production DB credential in GitHub for a job that an HTTP endpoint already performs.
- **Patch (PROPOSED):** delete `cron-rollup.yml` and `cron-similar.yml` (code-owned `.github/**`). Keep the `X-Cron-Secret` pair, and remove `DATABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` from Actions secrets if nothing else uses them.

#### L4. `emailRedirectTo` and `redirectTo` are built from the request Host

- `api/auth/signup` uses `${request.nextUrl.origin}/auth/callback`, and `reset-password` uses `${request.nextUrl.origin}/update-password`.
- A forged `Host` header yields a confirmation or reset email linking to the attacker's origin. This is safe only if the Supabase **Redirect URLs** allowlist has no wildcard. That setting is **not run**.
- **Patch (PROPOSED):** use `process.env.NEXT_PUBLIC_SITE_URL`, which is already in `.env.example`.

#### L5. `getCurrentUser()` re-links a `User` row to a new auth id by email

- In `src/lib/auth.ts`, when no `User` row has `authUser.id`, it looks one up by `email` and rewrites that row's `id` to the new auth id. It does not check `authUser.email_confirmed_at`.
- Exploiting it needs a second GoTrue identity with the victim's address, which requires the original auth user to have been deleted or confirmation to be off. (reasoned)
- **Patch (PROPOSED):** only re-link when `authUser.email_confirmed_at` is set.

#### L6. Minor disclosures

- `foods/[id]` returns `createdById`, a user id.
- `/api/ok` returns `buildId` to anyone. That is intended for deploy verification.
- `search/suggest` is anonymous and its `q` has no ceiling in trigram `SIMILARITY()` (cost only; the SQL is bound).
- **Logging:** `getCurrentUser()` `console.log`s the user's email on every cookie request, and `upload` logs its request body.
  - `next.config.ts` has `compiler.removeConsole: { exclude: ['error','warn'] }` in production, so those `console.log` calls are stripped from production builds (reasoned).
  - `console.error`/`warn` survive. None of the reviewed `error`/`warn` calls logs a bearer, the dev key or a cookie:

    ```
    grep -rnE "console\.(error|warn)\([^)]*(authorization|token|api_key|apiKey|password)" src --include=*.ts
    ```

    That grep returns nothing.
- **Headers:** `src/middleware.ts` matches `/(.*)`, including `/api`, and sets CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, and HSTS in production. No route sets `Access-Control-Allow-*`:

  ```
  grep -rn "Access-Control-Allow" src next.config.ts
  ```

  That grep returns nothing. So browsers cannot read cross-origin API responses; the mobile client is unaffected.

#### L7. `/api/nlp/parse` returns the missing env var's name in a 500 body

The body is `Configuration error: missing environment variables: DATABASE_URL`. The disclosure is minimal. **Patch (PROPOSED):** return a fixed body and log the detail.

#### L8. Mobile 003: `USING (true)` on `Recipe` / `Ingredient` / `Nutrition` / `Photo` for SELECT to `authenticated`

- By schema, none of these tables carries private or draft data. `prisma/schema.prisma` has no `isPublic`/`visibility`/`status` column on `Recipe`.
- So a signed-in user reading them all is by design, but it hands out `authorId` UUIDs (which feed M6's streak call) and `Photo.s3Key` (which feeds H4's any-key image read).
- Nothing in either repo reads these tables through Supabase, and 011 defers dropping them to a future migration.
- **Patch (PROPOSED):** `REVOKE SELECT ON public."Recipe", public."Ingredient", public."Nutrition", public."Photo" FROM authenticated;`, or drop the tables.

### Reviewed, nothing to fix

- **The `nosave=1` gate.**
  - `readNoSaveTesters()` and `isNoSaveTester()` in `src/lib/nlp/nosave-testers.ts` require exact addresses containing `@`, compare them case-insensitively after trimming, and fail closed when unset.
  - The gate is consumed as `isDevBypass || isNoSaveTester(userEmail)` in `api/nlp/parse`, and as `auth.via === 'key' || isNoSaveTester(auth.email)` in `api/foods/barcode`.
  - It inherits H3's email-confirmation dependency.
- **`NEXT_PUBLIC_*`.** Five are declared: `grep -oE '^#?\s*NEXT_PUBLIC_[A-Z0-9_]*' .env.example | sort -u`. All are public by nature: the Supabase URL, the anon key, the site URL and two CloudFront names. No secret carries the prefix.
- **SSRF.** No route fetches a caller-supplied URL. OFF and FatSecret lookups `encodeURIComponent` a code into a fixed base. The only open fetch is the image optimizer (C1).
- **`[id]` validation.** Every dynamic route passes `id` as a bound Prisma `where` value, so there is no injection. Missing format checks mean a 404 instead of a 400, which is not a security defect.

## 3. Already owned — not re-filed

| item | owner | note from this review |
|---|---|---|
| #23: the hardcoded admin key / `DEV_API_KEY` (**parked by Diego; not re-ranked**) | mobile `sync-docs/sprint_execution_progress.md` | Two observations are recorded for when it is un-parked. First, the key is accepted as `?api_key=` (`readDevApiKey()`), so it lands in any proxy or access log. Second, the retired literal `adminAPI_dev_key_bypass` is still in `scripts/doc-check/claims.json` as a `${key:-…}` fallback in a URL (`grep -c "adminAPI_dev_key_bypass" scripts/doc-check/claims.json`). If the box's `DEV_API_KEY` ever equalled a retired literal, it would be public. §5 lists the check. |
| `/api/foods/barcode` has no attribution chokepoint (a licensing defect) | Lane A: mobile punch #241, backend PR #445 (OPEN) | Not re-filed. |
| `master`'s required checks (`build` + `Vercel`, strict, admins included) | backend `CLAUDE.md` §Git & CI | This PR and the fixes PR go through them. |

## 4. The optional fixes PR (`cloud/security-fixes`)

It contains four commits, each with its own test. None touches `src/lib/mapping/`, `src/lib/parse/`, `src/lib/search/`, `src/lib/openfoodfacts/`, `src/lib/nutrition/` or `data/`.

| sha | fix | test |
|---|---|---|
| `1302ade` | C2: author-only, bounded `POST /api/recipes/[id]/ingredients` | `src/app/api/recipes/[id]/ingredients/route.auth.test.ts` |
| `d0ea9b2` | H6: key/bearer on `/api/fatsecret/barcode`, fixed 500 body | `src/app/api/fatsecret/barcode/route.auth.test.ts` |
| `5003a86` | L2: `safeEqualSecret()` for the cron secret and `matchesDevApiKey()` | `src/lib/auth/safe-equal.test.ts` (plus the existing `request-auth.test.ts`) |
| `2c25d63` | L1 part: fixed `/api/health` 500 body | `src/app/api/health/route.test.ts` |

- **Code owners:** none of these paths is code-owned. A change under `scripts/`, `docs/`, `prisma/`, `.github/`, `src/lib/parse/` or `src/lib/nutrition/` would need a code-owner review (`.github/CODEOWNERS`); `reports/` does not.
- **Deploying:** these are `src/app/api/**` and `src/lib/auth/**` changes. The winner-gate never hashes them, and they change no mapping behaviour. They go live only through Lane A's deploy window (`npx prisma generate && npm run build && systemctl --user restart recipe-api`), with the content proof from the mobile `CLAUDE.md` §Deploying.
  - A literal the change requires: `"unauthorized"` does not work, because it occurs elsewhere.
  - Use the new comment-free string `'invalid_items'` from the ingredients route: served 1 / anchor 0.

## 5. What a MACHINE-SIDE session must still do

Nothing below was run here.

1. **The box's `.env`** (read names only; never print values):
   - Confirm `DEV_API_KEY` is set and is **not** one of the retired literals (`dev-key-123`, `adminAPI_dev_key_bypass`).
   - Confirm `CRON_SECRET` is set on whichever deployment serves `/api/admin/cron/*`.
   - Confirm which of `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` is set (M1).
   - Confirm `S3_BUCKET` and the IAM policy's scope (H4).
2. **The Funnel.** From outside the tailnet:
   - Does `https://<funnel>/_next/image?url=…` answer (C1)?
   - Does `https://<funnel>/api/_debug/env` 404 (§1)?
   - With a client-supplied `X-Forwarded-For: 1.2.3.4`, what does the app see as the first XFF entry? Log it once from a throwaway route or read it in `journalctl` (M5).
3. **Supabase dashboard / SQL:**
   - Is Auth → **Confirm email** on (H3)? Are the **Redirect URLs** free of wildcards (L4)?
   - Run the two SQL checks in M6: `has_function_privilege` on `recompute_user_streak`, and `relrowsecurity` over `public`.
   - Is `weight_entries` RLS on, with the one policy the plan doc records?
   - Do any storage buckets and policies exist? None are defined in migrations.
4. **GitHub (owner):**
   - Enable Dependabot alerts (M8).
   - Read the repo's default `GITHUB_TOKEN` permission and which database `secrets.DATABASE_URL` points at (H5, L3).
5. **Deploy through Lane A's window:** the fixes PR once merged. C1's `next` bump, if taken, needs `npm ci` on the box before the build, and the mobile alpha re-smoked afterwards.
