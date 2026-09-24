# Security round two: parse bounds, reserve-then-refund, the bypass allowlist, and three small fixes — 2026-09-24

Written by cloud session cloud-7 (mobile punch row **#301**; the review it continues is `reports/2026-09-24_cloud-security-review.md`, row #281). Branch `cloud/security-round-two` in `evawlve/Recipe-App`, one PR against `master`.

- **Trees.** `evawlve/Recipe-App` `origin/master` at `38671b0` (the #450 merge) is the primary tree. `evawlve/KindaHealthyMobile` `main` at `7b9eb3b` was cloned read-only as a reference.
- **#451 was OPEN.** `git merge-base --is-ancestor 2c25d63 origin/master && echo MERGED || echo OPEN` printed `OPEN` (2026-09-24). So the branch's first commit merges `origin/cloud/security-fixes` (a merge, not a rebase). This PR's diff shrinks by itself once #451 lands.
- **Labels.** "Measured" means a command run in these checkouts on 2026-09-24, and each one is quoted. "Reasoned" means read from code. "Not run" means it needs the box, Supabase or Vercel, none of which this session could reach.

## 0. Gates

The dummy `DATABASE_URL=postgresql://x:y@localhost:5432/z` was exported for `test:ci`. All figures below are measured.

| gate | `origin/master` `38671b0` (baseline) | this branch's head |
|---|---|---|
| `npm ci` | exit 0 | (lockfile untouched) |
| `npm run test:ci 2>&1 \| tail -5` | `Test Suites: 250 passed, 250 total` · `Tests: 1 skipped, 5217 passed, 5218 total` · exit 0 | `Test Suites: 261 passed, 261 total` · `Tests: 1 skipped, 5321 passed, 5322 total` · exit 0 |
| `npm run lint:ci 2>&1 \| tail -2` | `0 errors and 34 warnings potentially fixable…` (`✖ 466 problems (0 errors, 466 warnings)`) · exit 0 | `0 errors and 34 warnings potentially fixable…` (`✖ 465 problems (0 errors, 465 warnings)`) · exit 0 |
| `npm run typecheck 2>&1 \| tail -3` | `tsc --noEmit` · exit 0 | exit 0 |

**Where the +11 suites and +104 tests come from:**

- #451's merge adds 4 suites and 18 tests. Its own review measured 254 suites and 5,235 tests.
- This work adds 7 new suites:
  - `src/lib/nlp/parse-bounds.test.ts`
  - `src/app/api/nlp/parse/route.bounds.test.ts`
  - `src/lib/nlp/parse-rate-limit.inflight.test.ts`
  - `src/app/api/nlp/parse/route.config-error.test.ts`
  - `src/app/api/admin/food-stats/route.auth.test.ts`
  - `src/app/api/foods/search/route.bounds.test.ts`
  - `src/app/api/foods/barcode/route.bounds.test.ts`
- It also adds new cases to `route.rate-limit.test.ts` and `request-auth.test.ts`.

The head adds **no red**. The only pins whose meaning changed are the ones named in §ROW 2 and §ROW 3.

**The gates that cannot see this work:**

- `scripts/eval/winner-gate.sh` aborts on `src/app/api/|src/lib/nlp/` (`UNOBSERVED_SURFACE_PATHS`). So jest is the receipt here, and Lane A's post-deploy probes (§6) are the live proof.
- Not a brief gate, and run as a compile check only (no database behind it):
  - `DATABASE_URL=<dummy> NEXT_PUBLIC_SUPABASE_URL=https://unit.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npx next build`
  - Result: exit 0 on the head (measured 2026-09-24; the build log's last line is the route legend).

### Doc-check claims that read these files

Each claim's own command was re-run from `scripts/doc-check/claims.json` on the baseline and on the head (2026-09-24).

| claim | baseline | head | expect |
|---|---|---|---|
| `dev-bypass-email-substring-removed` | 0 | 0 | count 0 |
| `parse-owns-whitelist` | 3 | 3 | min 1 |
| `parse-no-attribution-import` | 0 | 0 | count 0 |
| `nosave-tester-allowlist-wired` | 1 | 1 | count 1 (EXACT) |
| `parse-cache-hit-not-charged` | 3 | 3 | min 1 |
| `parse-wire-sugar-sodium-are-present-and-null` | `0@0@14` | `0@0@14` | equals |
| `parse-limits-documented` | `2@10@100` | `2@10@100` | equals |
| `dev-api-key-no-fallback-sites` | 0 | 0 | count 0 |
| `search-route-accepts-key-or-bearer` | 1 | 1 | count 1 |
| `search-uses-gathercandidates` | 3 | 3 | min 1 |

Every command stays green. **Two claims now have stale PROSE.** These are notes for the merging session: `scripts/**` is code-owned and was not edited here.

- `dev-bypass-email-substring-removed` says the allowlist keeps "endsWith @google.com, diego@example.com". The `diego@example.com` entry is gone (§ROW 3).
- `parse-cache-hit-not-charged` says the row "is written at the end of runParse() … never in the preamble". It is now reserved before the mapper and refunded after it (§ROW 2). Its command (`grep -c isFreeParseRequest`) still reads ≥ 1.

## ROW 1 — H1, the input bounds (built)

**The new module is `src/lib/nlp/parse-bounds.ts`.** It is pure: no imports, and constants rather than env, so CI's `check` job needs no `.env.example` entry. It holds:

- `MAX_PARSE_TEXT_CHARS` = **1,000**
- `MAX_PARSE_ITEMS` = **30**
- `MAX_PARSE_ITEM_CHARS` = **200**
- `MAX_SEGMENTED_ITEMS` = **30**
- `MAX_PARSE_BODY_BYTES` = **32 KiB**
- `PARSE_TOO_LARGE_MESSAGE` = *That log is too long — up to 1,000 characters or 30 foods at a time.*
- `checkParseBounds()`, `contentLengthTooLarge()`, `readBodyTextWithin()` and `capSegmentedItems()`

**The floors (measured 2026-09-24).** The rule was: take the default when every floor clears by ≥ 3×, otherwise raise it.

| input | floor | command | bound | margin |
|---|---|---|---|---|
| `text` | **184** chars. The S51 arm driver's ten-food line: `2 tbsp peanut butter, 1 tbsp honey, …, 1 medium banana`. Golden: 176. Spanish: 50. `stress-latency.ts` `NLP_PHRASES`: 38. | `jq -r '[.nlp[] \| (.text // "") \| length] \| max' scripts/eval/golden-set.json` → `176`; `jq -r '[.cases[] \| .rawText \| length] \| max' scripts/eval/spanish/spanish-corpus-2026-09-12.json` → `50`; `for f in scripts/eval/spanish/s51-2026-09-15/*.tsv; do awk -F'\t' 'NR>1{print length($NF)}' $f; done \| sort -n \| tail -1` → `184` | 1,000 | 5.4× |
| `items[]` length | **1**. Every repo script posts `{ items: [<one>] }`: `warm-cache.ts`, `cache-parity-sweep.ts`, `warm-cold-diff.ts`, `run-eval.ts`. | `grep -rn "items" scripts/ --include=*.ts --include=*.py \| grep -v test` | 30 | 30× |
| `items[].rawText` | **51**. The golden set's longest `item.rawText`. | `jq -r '[.nlp[] \| select(.item) \| .item.rawText \| length] \| max' scripts/eval/golden-set.json` → `51` | 200 | 3.9× |
| segmented items | **10**. The S51 line's `itemCount`. The golden set's `expectItems` max is 7. | `for f in scripts/eval/spanish/s51-2026-09-15/*.tsv; do awk -F'\t' 'NR>1{print $6}' $f; done \| sort -n \| tail -1` → `10`; `jq -r '[.nlp[] \| select(.expectItems) \| .expectItems] \| max' scripts/eval/golden-set.json` → `7` | 30 | 3× |
| body bytes | ≤ ~200 bytes per script request (reasoned from the bodies above) | — | 32 KiB | — |

**Why 1,000 / 30 and not the review's 2,000 / 40, and not the brief's 1,000 / 25.**

- 1,000 characters already clears the longest line in the repo by 5.4×. 2,000 would only double what one request may put into the segmenter prompt.
- The segmented floor (10) clears 25 by only 2.5×, so the brief's own rule raised the segmented cap to 30.
- The user copy must name ONE number of foods, so `MAX_PARSE_ITEMS` moved to 30 with it. Its own floor (1) clears either value.
- The body cap moved from 16 KiB to 32 KiB. 30 items × 200 UTF-16 units × 3 UTF-8 bytes is 18,000 bytes of `rawText` alone, so 16 KiB could refuse a body that the character bounds admit.
- `parse-bounds.test.ts` pins that the largest in-bounds body fits: 30 items of 200 × `食`.

**The order in the route, cheapest first.** Every step comes before the reservation (ROW 2), so a refused body never reserves.

1. The env check.
2. `contentLengthTooLarge(req.headers.get('content-length'))` → 413.
3. `readBodyTextWithin(req.body, MAX_PARSE_BODY_BYTES)` → 413 on overflow. A chunked body with no `content-length` is refused at the same cap, so parsing costs at most 32 KiB.
4. `JSON.parse`. It throws into the handler's existing 500 branch, as `req.json()` did.
5. The existing 400.
6. `checkParseBounds()` → 413.
7. The reservation.
8. `wantStream`.

The bounds sit **ahead of the dev-key bypass**. A keyed caller skips the reservation and the in-flight cap, so these bounds are the only cap it gets.

**The segmented cap.** `capSegmentedItems()` slices:

- the AI answer, **before** `writeSegmentationCache()` and before the `segments` frame;
- `forceSegmentText()`'s answer (belt-and-braces: the heuristic already slices itself at `MAX_ITEMS = 12` in `heuristic-segmenter.ts`);
- a `SegmentationCache` row written before this cap existed.

Each slice logs one `console.warn` line with the counts.

**Should a split over 30 be a 413 instead?** Default kept: **slice**.

- By the time the split is known, the segmenter call has been paid for and the reservation made. A 413 there would throw away paid work and tell the user nothing they could act on.
- The 1,000-char bound makes a split over 30 foods rare: 30 foods in 1,000 characters is about 33 characters per food.
- The cost is that foods past the 30th are dropped silently. A later wire field could say "N more not shown". That is not built.

**Pins.**

- `parse-bounds.test.ts` pins each bound at N and N+1, the copy byte for byte, and that `{}` and `{ text: 5 }` return null so the route's 400 keeps them. It also covers the bounded read (bytes, not characters; UTF-8 split across chunks).
- `route.bounds.test.ts` is new and uses `route.rate-limit.test.ts`'s harness. Each refused case below is a 413 with the exact copy, and neither the mapper, `callStructuredLlm()` nor the limiter's write runs:
  - 31 items
  - a 1,001-char `text`
  - a 201-char item
  - the dev key with 31 items (still 413)
  - a `content-length` over the cap
  - a chunked body over the cap
- On `?stream=1`, a refused body is a JSON 413 and **no SSE frame**.
- `{}`, `{ text: 5 }` and `{ items: 'nope' }` → 400.
- 30 items and 1,000 chars proceed.
- An AI split of 31 → 30 mapped, 30 in the cache row, 30 in the `segments` frame and `done.count`.

### The mobile handoff (a hunk for Lane B — the mobile repo is not touched here)

The composer has no cap today. `grep -n maxLength 'src/app/(tabs)/logging.tsx'` printed nothing (exit 1, measured 2026-09-24 in the mobile checkout at `7b9eb3b`).

The server's 413 `error` string reaches the user through two paths (reasoned from the mobile code):

- `apiFetch()` / `apiFetchStream()` in `src/lib/api-client.ts` put `errorBody?.error` into `error.message`.
- `logging.tsx` then shows it in `Alert.alert('Parser Error', …)` and logs it to `nlp_failures_log`.

The mobile repo cannot import a backend constant, so the literal is owned by the backend:

```diff
--- a/src/app/(tabs)/logging.tsx  (the composer's TextInput)
+                  // 1,000 = MAX_PARSE_TEXT_CHARS in backend src/lib/nlp/parse-bounds.ts (the
+                  // owner). Past it the server answers 413 "That log is too long — up to
+                  // 1,000 characters or 30 foods at a time." Change both together.
+                  maxLength={1000}
```

At the cap, show one line under the composer: *Up to 1,000 characters per log*. (PROPOSED — Lane B's file and copy.)

**`plans/v1/api-contract.md` §NLP Parse gains this paragraph** (a mobile docs hunk, PROPOSED):

> **Bounds (backend `src/lib/nlp/parse-bounds.ts`, the owner).**
> - `text` ≤ 1,000 characters; `items[]` ≤ 30 entries, each `rawText` ≤ 200 characters; body ≤ 32 KiB.
> - Past any of these the route answers **413** `{ "error": "That log is too long — up to 1,000 characters or 30 foods at a time." }`. That holds on `?stream=1` too: a JSON body, never a frame.
> - The bounds apply to every caller, dev key included.
> - A `text` whose split exceeds 30 foods is sliced to the first 30. It is not refused.

## ROW 2 — H2, reserve then refund, on both wires (built)

**(a) The reservation.** It replaces the preamble COUNT and runs after ROW 1's bounds. It is one `prisma.$transaction(async (tx) => …, { maxWait: 2000, timeout: 5000 })`:

1. `tx.$executeRaw\`SELECT pg_advisory_xact_lock(hashtext(${userId}::text))\``
2. `count` the minute window, then the day window. They run sequentially: an interactive transaction runs on one connection, so parallel queries would only queue.
3. Over either limit → return `{ over }` and write nothing.
4. Otherwise `tx.nlpRequestLog.create({ data: { userId } })` → `reservedId`.

What that gives:

- **The lock serialises one user's reservations.** Under READ COMMITTED, the second transaction's counts run after the first has committed, so they see its row (reasoned).
- **Locks can be shared across users.** `hashtext` returns a 32-bit int4, cast to the `bigint` the lock takes, so two users can share a lock. That only over-serialises a millisecond transaction; it never produces a wrong count.
- **A `P2028`** (Prisma's interactive-transaction timeout) is answered **429** with the minute message and is not counted as a limiter error.
- **Two caveats on `P2028`, reasoned.**
  - `P2028` also fires when `maxWait` passes with no free pool connection. That is DB saturation, not this user's cap. The brief's rule treats both the same way, and 429 is at least the honest "try again".
  - The lock is held only for the count+create transaction, so a real lock wait is milliseconds.
- **No migration.** `NlpRequestLog` already has `id`. `prisma/**` is not touched.

**(b) The refund.** It replaces the CHARGE. `runParse()` now returns `free = isFreeParseRequest(…)`. `settle(refund)` is idempotent and never throws. It deletes the reserved row when `refund` is true and releases the in-flight slot. It is called where each run ENDS:

- **One-shot:** inside the `runWithWritePolicy` callback after `runParse(null)` (`settle(free)`), in that branch's `finally` (`settle(true)`, a no-op after success), and in the outer `catch`.
- **`?stream=1`:** in `runParse(send).then(…)`, after the `done` frame (`settle(free)`), and in `.catch(…)`, after the `error` frame (`settle(true)`), both before `.finally` closes the stream.
- **Never in a handler-level `finally`.** On the stream wire that runs before the mapper starts.

The standing contracts still hold:

- *Free requests cost nothing:* reserve then refund, net 0.
- *A 400 is not charged:* it never reserves.
- *A throwing mapper is not charged:* it is refunded.

Two failure cases:

- **A refund that fails** is logged (`NLP Parse Rate Limiter refund failed`) and swallowed. The user has paid one slot for a free request.
- **A request that fails open** (the reservation errored) reserves nothing and is not charged. Before this change, the post-hoc charge could still land if the DB recovered by then. Reasoned: the loss is at most one uncharged request per isolated error.

**(c) The in-flight cap.** `MAX_INFLIGHT_PER_USER = 2`, in `src/lib/nlp/parse-rate-limit.ts`:

- `acquireInflight()` / `releaseInflight()` / `inflightCount()` operate on a module-level `Map`. `_resetInflightForTests()` clears it, because module state survives `jest.clearAllMocks()`.
- The slot is acquired **before** the reservation, so the third concurrent request is refused with no DB call: 429 *You already have food logs being processed. Please wait for them to finish.*
- It is released by `settle()`, which covers every early 429/503 after acquisition and both wires' ends.
- **It is per process.** The box runs one `recipe-api` process, so the cap is exact there. A multi-instance deployment (Vercel) would multiply it.

**A keyed caller** (`userId` null, `isDevBypass` true), and the `@google.com` allowlist, are exempt from (a) and (c). The bounds are their only cap, which is why ROW 1 sits ahead of the bypass.

**(d) DB errors — NEEDS-DIEGO. Default built.**

- An isolated reservation error **fails open**, as today, and is logged.
- After **3 consecutive** errors (`RESERVATION_FAILURES_BEFORE_FAIL_CLOSED`; a module counter, reset by any successful reservation; `P2028` does not count), the route answers **503** *Food logging is temporarily unavailable. Please try again in a moment.* It keeps answering 503 until a reservation succeeds. Every request still attempts the reservation, so recovery is immediate.

**The mock.** `route.rate-limit.test.ts`'s prisma mock gains:

- a **serialising** callback-form `$transaction` (a promise chain, standing in for the per-user lock), whose `tx` shares `nlpRequestLog`'s mocks and whose `$executeRaw` is a no-op;
- `nlpRequestLog.delete`;
- `_resetInflightForTests()` in `beforeEach`.

**The new pins.** They sit in a second `describe` in `route.rate-limit.test.ts`, with a stateful count (`count` → `rows`; `create` → `rows++`; `delete` → `rows--`):

- **The lock and the reservation:**
  - The lock statement is exactly `SELECT pg_advisory_xact_lock(hashtext(?::text))`, with `user-1` as a bound value, and runs before the count.
  - The reservation runs before the mapper.
  - The options are `{ maxWait: 2000, timeout: 5000 }`.
- **Concurrency and the cap:**
  - Two concurrent at 9 → one 200 and one 429 (minute message); the mapper runs once and `rows` ends at 10.
  - Five concurrent at a 2/min limit → exactly two run.
  - Three concurrent at 0 → one 429 (in-flight message) with `$transaction` called only twice; the other two run once released, and a fourth then runs.
  - Three consecutive 429s are all the minute message, never in-flight (slots are released).
  - A 413 opens no transaction.
  - The dev key: three concurrent all run, with no transaction.
- **DB errors:**
  - One rejection → 200 and the mapper runs, with nothing to refund.
  - Four in a row → 200, 200, 200, then 503 with no mapper call, then 200 once a reservation succeeds.
  - Three errors, one success, then three errors → never a 503.
  - Three `P2028` → 429 each, and not counted: the next generic error still fails open.
  - A refund that rejects → still 200.
- **The stream arm:**
  - A streamed `cache_hit` → `done`, then `delete({ where: { id: 'res-1' } })` after the mapper, and `rows` returns to 0.
  - A streamed paid request → the reservation is kept.
  - A streamed throw → an `error` frame and `delete`.
  - Three streamed → one JSON 429 before any byte; the two streams finish, and a next stream runs, because the producer released the slots.

`src/lib/nlp/parse-rate-limit.inflight.test.ts` (new) pins the pure half: N/N+1 for the cap, per-user isolation, no double-release mint, the breaker's 4th error, reset on success, and `isReservationTimeout()`. The module's existing `parse-rate-limit.test.ts` and `isFreeParseRequest()` are untouched.

### The six pins rewritten (their own commit)

| was | now | why |
|---|---|---|
| *every line a cache hit → 200, counted … but NOT charged* (`create` not called) | *… counted and reserved …, then refunded: net 0* (`create` 1, `delete` 1 by id) | The row is written before the mapper. Was red. |
| *every line the zero-calorie fast path → not charged* | *… → reserved, then refunded: net 0* | Same. Was red. |
| *the mapper throwing → 500 and nothing is charged* | *… → 500; reserved, then refunded: net 0* | A throw refunds. Was red. |
| *a 400 (no text, no items) is not charged* | *… never reserves: no transaction, no row* | Now also asserts `$transaction` was not called. Was green. |
| *the charge failing → still 200 (fail open)* | *the reservation write failing → still 200 (fail open), and nothing to refund* | `create` now fails inside the reservation. Was green. |
| *the charge is written AFTER the mapper ran, not before* | *the reservation is written BEFORE the mapper runs; a refund comes AFTER it* | The order is inverted by design. Was red. |

**A deviation from the brief, stated plainly.** The brief listed six pins and said no other existing test may be edited. Three sibling suites assert the count or the charge through `prisma.nlpRequestLog`:

- `route.debug-echo.test.ts`: *…the request was charged one NlpRequestLog row*
- `route.nosave-tester.test.ts`: *count … toHaveBeenCalledTimes(2)*
- `route.stream.test.ts`: *a bearer caller is charged exactly as on the one-shot path*

Their `@/lib/db` mocks had no `$transaction`, so the reservation would have failed open there and those assertions would have gone red. With enough requests in one file, the breaker would also have answered 503.

Each of those three files gains **only** the `$transaction` / `delete` mock extension, with a `tx` sharing `nlpRequestLog`'s mocks. **No assertion in them changed**, and each is named in the ROW 2 commit message.

## ROW 3 — H3, the allowlist, honestly (built, with its limits stated)

**Three facts decide this row.**

1. The alpha runs Supabase with **Confirm email OFF**. The mobile `src/app/(auth)/welcome.tsx` says so: *"With email confirmations OFF (the alpha setting) Supabase returns a session…"*. Under autoconfirm, GoTrue stamps `email_confirmed_at` at signup (reasoned from GoTrue, not measured).
2. Diego's own bypass is the dev key, not an email.
3. The review's patch drops the literal.

**(i) `request-auth.ts`: the bearer branch returns `email` only when `user.email_confirmed_at` is set.** The user id is returned either way.

- This is **defence in depth**, and the header says so.
- It bites **only once Confirm email is turned ON**. Turning it on does not un-confirm accounts already created.
- It cannot lock Diego out.
- The shared sitting account was created under autoconfirm, so it carries the stamp (reasoned).

**(ii) The route drops the `diego@example.com` entry and keeps the `@google.com` suffix rule.**

- The comment beside the rule said *"Exact matches and the review domain ONLY"*. The review domain is the presumed Play-review path.
- `grep -c 'diego@example.com' src/app/api/nlp/parse/route.ts` → `0` (measured, head).
- **NEEDS-DIEGO:** *does anything still sign in as `diego@example.com`?* Default: no, so it is dropped.

**Stated plainly: with Confirm email OFF, anyone who registers `x@google.com` still gets the bypass** — no limit, `nocache`, `debug`, `nosave`.

- **The fix is the console setting:** Supabase → Auth → **Confirm email ON** (review §5.3; Lane A S57 Needs Diego 2).
- **The stronger shape**, once Google sign-in is live (cloud-2, build 15), is `user.app_metadata.provider === 'google'`. It keys on how the account authenticated, not on a string the user typed. Designed, **not built** (ROW 5).

**The `nosave=1` trap (beside mobile `CLAUDE.md` §Logging-screen traps).** `NOSAVE_TESTER_EMAILS` keys on the same `email`.

- Once Confirm email is ON, a NEW tester account that has not confirmed gets `email: null`. Its `nosave=1` is then silently ignored, and a sitting **writes rows**.
- The same holds on `/api/foods/barcode`: `auth.via === 'key' || isNoSaveTester(auth.email)`.
- So a new sitting account must confirm its address before its first sitting.

**Pins.**

- `request-auth.test.ts`:
  - The shared `USER` fixture gains `email_confirmed_at: '2026-01-01T00:00:00Z'`. That is an edit to the existing *valid bearer* pin, named in the commit.
  - Three new cases: set → email; `null` → `null`; absent → `null`.
- `route.rate-limit.test.ts`:
  - `USER` gains the stamp.
  - The pin *an allowlisted email (diego@example.com) is neither counted nor charged* **inverts** to *diego@example.com is NO LONGER allowlisted (H3): counted and reserved like anyone*. Its fixture gains the stamp, so the inversion tests the allowlist, not the gate.
  - New: a **confirmed** `reviewer@google.com` is neither counted nor reserved.
  - New: an **unconfirmed** `x@google.com` (`email_confirmed_at: null`) is counted and reserved.
- `route.nosave-tester.test.ts`: `TESTER` and `STRANGER` gain the stamp.
- `src/app/api/foods/barcode/route.nosave.test.ts`: both bearer fixtures gain the stamp. This one was found by the brief's grep; without the stamp, its tester lost `nosave`.

**Untouched and green.** These came from `grep -rln "email:" src/app/api --include='route*.test.ts'` plus `grep -ln "email:" src/lib/auth/*.test.ts`:

- `ok/route.usage.test.ts`
- `nlp/parse/route.stream.test.ts`
- `nlp/parse/route.debug-echo.test.ts`
- `foods/[id]/route.test.ts`
- `foods/search/route.auth.test.ts`
- `foods/barcode/route.auth.test.ts`
- `fatsecret/barcode/route.auth.test.ts`

## ROW 4 — M3, L7, M2's input bounds (built, three commits)

**M3: `admin/food-stats` is key-only.**

- It checks `matchesDevApiKey(req)`: constant-time, and it fails closed on an unset or empty `DEV_API_KEY`.
- The `getCurrentUser()` fallback and its `const isAdmin = true; // TODO` are deleted. That also retires one of the three inline key compares L2 left.
- The 401 body is unchanged.
- The #23 surface grows by nothing, because the key already worked here.
- `grep -rl 'process.env.DEV_API_KEY ||' src/app/api --include=route.ts | wc -l` → `0` (measured, head).
- Pin (`route.auth.test.ts`):
  - A cookie user with no key → 401, and neither the stats nor `getCurrentUser()` are read.
  - The key in `x-api-key` or `?api_key=` → 200.
  - A wrong key → 401.
  - An unset key refuses an empty one.
- **Note for the merging session.** Mobile `CLAUDE.md` says *"exactly 3 routes stay key-only"*, and the review (§1.2) showed that two of those three also took cookies. After this commit, `foods/[id]/serving` and `admin/food-stats` are truly key-only. `foods/map` still falls back to a cookie session, which is correctly scoped.

**L7: the parse env-check 500 body is `{ "error": "Configuration error" }`.**

- The missing names are still `console.error`'d beside it.
- Pin (`route.config-error.test.ts`):
  - `DATABASE_URL` unset → exactly that body, and the raw body does not contain the variable's name.
  - The log line carries `['DATABASE_URL']`.
  - The mapper never runs.

**M2's bounds.** The limiter is design only (ROW 5).

- **`foods/search`:**
  - `s` over 200 characters (trimmed, like the existing 2-character floor) → 400 *Search query must be at most 200 characters*, before any search.
  - Pin (`route.bounds.test.ts`): 201 → 400 with no `findMany`; 200 and 200+padding → 200; the floor unchanged.
- **`foods/barcode`:**
  - `code` must match `/^\d{6,14}$/` after trim → otherwise 400 *code must be 6 to 14 digits*, before either upstream lookup.
  - This admits everything the app sends. The scanner reads only `['ean13', 'ean8', 'upc_a', 'upc_e']` (`barcodeTypes` in mobile `src/app/scan.tsx`), and `isPlausibleBarcode()` in mobile `src/lib/barcode-hit.ts` already floors the code at `/^\d{8,14}$/`. Both were read in the mobile checkout, 2026-09-24.
  - Pin (`route.bounds.test.ts`): seven malformed codes (`abc`, 5 digits, 15 digits, a letter, dashes, `+`, `1e10`) → 400, with neither `lookupFatSecretBarcode()` nor `getOffProductByBarcode()` called. UPC-E, EAN-8, UPC-A, EAN-13, GTIN-14 and a space-padded code → the lookups run. A missing `code` keeps its own 400.
- Both bounds are module constants in the route. They are not exported, because a Next route module may export only its handlers and config.

## ROW 5 — designs, each with an owner (nothing here is built)

- **M1: the bearer pre-check and the anon key.**
  - `looksLikeUnexpiredJwt()` in `request-auth.ts` would refuse `Bearer <garbage>` locally: three base64url segments, and a JSON payload whose `exp` is in the future. That removes the anonymous GoTrue round trip.
  - `getSupabaseAuthClient()` in `src/lib/supabase/admin.ts` would prefer `NEXT_PUBLIC_SUPABASE_ANON_KEY`, because `getUser(jwt)` needs no service role.
  - Owner: **Lane A**, with a live probe, because this is the auth hot path. Size: S (about 30 lines and 4 pins).
  - Blocker: a window, plus a probe that a real mobile bearer still resolves. Lane A S57 measured both keys set on the box.
- **M2: a per-user limiter for `foods/*`.**
  - It would be an in-process token bucket keyed on `auth.userId`, in a new `src/lib/auth/user-rate-limit.ts`.
  - What a real user sends (reasoned from the mobile code):
    - **Search:** fires on **submit**, not per keystroke. `onSubmitEditing={() => setTriggeredSearchQuery(searchQuery)}` in `logging.tsx`, and `useFoodSearch()` is a react-query keyed on the submitted query, so a repeat is served from the client cache. A real user sends at most a few searches a minute.
    - **Barcode:** one lookup per scan, from `handleLookup` in `scan.tsx`.
  - So 30/min for search and 10/min for barcode would be far above real use. **The numbers are Diego's.**
  - Owner: Lane A. Size: S–M. Blocker: Diego's numbers.
- **M4: the web app's IDORs.**
  - `recipes/[id]/tags/accept` and `recipes/[id]/compute-nutrition` each need `if (recipe.authorId !== user.id) return 403`. `tags/accept` already selects `authorId` and never compares it.
  - `foods/[id]/units` and `foods/[id]/aliases` need `food.createdById === user.id`. Otherwise their rows should be marked community rows and excluded from `deriveServingOptions()` for other users.
  - Owner: **a web-app session** (the mobile client uses none of these). Size: M (four routes, four `route.auth.test.ts`). Blocker: none.
- **M5: `TRUSTED_PROXY_HOPS`.** This is moot on the box: Lane A S57 found `/api/auth` is not forwarded by the Funnel and XFF is not observable. Vercel's `x-vercel-forwarded-for` is a separate question, owned by whoever serves the web sign-in. Size: S. Blocker: which deployment serves `/api/auth`.
- **C1: the `next` bump and `remotePatterns`.** This is **Diego's**: a `package.json` bump, then `npm ci` on the box. The Funnel 404s `/_next/image` (Lane A S57, measured on the box), so it is not reachable from outside there. Its urgency is the **Vercel** deployment's. Size: S (the bump) plus an M re-smoke.
- **H4: `upload` / `image`.**
  - `POST /api/upload` needs `getCurrentUser()` → 401.
  - `GET /api/image/[...key]` needs a `^(avatars|uploads)/[A-Za-z0-9._-]+$` key allowlist → 404.
  - Owner: a web-app session. Size: S (two routes, two tests). Blocker: check the web sign-up avatar flow first.
- **H5: CI secrets.** `.github/**` is code-owned, so this is **Diego's**. Add `permissions: contents: read` and drop the job-level `SUPABASE_SERVICE_ROLE_KEY` / `DATABASE_URL` / AWS / `DEV_API_KEY`. Size: S. Blocker: code-owner review.
- **L1's rest: a delete list.**
  - `src/app/api/oops`, `src/app/api/sentry-example-api`, `src/app/api/_debug`
  - `src/app/api/recipes/[id]/__save` (unrouted per review §1)
  - Pin: a glob test asserting they are absent.
  - Owner: any backend session. Size: S.
- **L3.** Delete `cron-rollup.yml` / `cron-similar.yml` and keep the `X-Cron-Secret` pair. Diego's, because `.github/**` is code-owned.
- **L4.** Build `emailRedirectTo` / `redirectTo` from `NEXT_PUBLIC_SITE_URL`, not the request `Host`. Web-app session. S.
- **L5.** Re-link a `User` row in `getCurrentUser()` only when `authUser.email_confirmed_at` is set. Web-app session. S.
- **M6 / L8: mobile Supabase migrations.**
  - `REVOKE EXECUTE ON FUNCTION public.recompute_user_streak(UUID, BOOLEAN) FROM anon, authenticated;`
  - `REVOKE SELECT` on the legacy `Recipe` / `Ingredient` / `Nutrition` / `Photo` tables from `authenticated`.
  - Owner: a **mobile** session with the Supabase CLI. Size: S each. Blocker: the SQL checks in review §5.3.
- **The provider-gated `@google.com` rule.** Once cloud-2's Google sign-in ships (build 15), `request-auth.ts` returns `provider` (`user.app_metadata.provider`). The route's rule becomes `auth.provider === 'google' && userEmail?.endsWith('@google.com')`.
  - Owner: Lane A, after cloud-2 is live. Size: S (one field and 2 pins).
  - Blocker: cloud-2 shipped, plus a real Google-auth review account to probe.

## 6. What a MACHINE-SIDE session must still do (not run here)

**Lane A S58 deploys this PR in the window that carries #451 and #452.**

- This is a `src/` PR: merged is never deployed. Deploy recipe: `npx prisma generate && npm run build && systemctl --user restart recipe-api`, with the content proof from mobile `CLAUDE.md` §Deploying.
- The box's `.env` gains **nothing**. No new env var; no migration.

**The live proofs, after the deploy:**

1. **A 26-item body WITH THE KEY → 413.** The bounds sit ahead of the bypass. Any count over 30 is refused, so send 31 or more to be unambiguous. The body must be *That log is too long — up to 1,000 characters or 30 foods at a time.*
2. **Five parallel `nosave=1` parses as the BEARER sitting account → at most two mapper runs and three 429s**, read in the journal. It must be the bearer, because a keyed caller is exempt from the cap and the reservation. Use `items` with one food each, so no segmenter runs.
3. **`GET /api/admin/food-stats` with a web cookie and no key → 401.**
4. Optionally: `GET /api/foods/barcode?code=abc` with a bearer → 400 with no upstream call in the journal. `/api/foods/search?s=<201 chars>` → 400.

## 7. Needs Diego

1. **ROW 2(d): the limiter's rule when its own DB read keeps failing.** Built default: fail open on an isolated error; **503 after three consecutive**, until a reservation succeeds. The alternative is to fail open forever, as before.
2. **ROW 3: does anything still sign in as `diego@example.com`?** Built default: no, so the literal is dropped. Your bypass is the dev key.
3. **Supabase → Auth → Confirm email ON.** This is what makes H3 bite. Until then, any `x@google.com` sign-up gets the dev bypass.
   - It does not un-confirm existing accounts.
   - Every NEW tester account must confirm its address before `nosave=1` is honoured. Otherwise a sitting writes rows.

## 8. Notes for the merging session

- **Stale claim prose** (commands green): `dev-bypass-email-substring-removed` and `parse-cache-hit-not-charged`. See §0.
- **#452 is also open** and edits the same route at the `segments` frame's emit site and in `parse-stream.ts`. This PR's hunks sit in the preamble, the body read, the segmented cap just above the emit, and the settle sites. If #452 merges first: `git merge origin/master` into this branch (never a rebase), then re-run the gates.
- **The mobile `CLAUDE.md` key-only count** is covered in §ROW 4 M3.
