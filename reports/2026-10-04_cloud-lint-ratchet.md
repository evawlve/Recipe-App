# The lint ceiling ratchet: `--max-warnings` 700 → 447, and #199 verified as shipped (2026-10-04)

Written by cloud session cloud-22. Branch `cloud/lint-ratchet` in `evawlve/Recipe-App`, one PR against `master`, left OPEN for a Mac session or Diego. Nothing here touches runtime behaviour: 35 dead `eslint-disable`/`eslint-enable` comment lines are removed from 15 files, and one number changes in `package.json`.

- **Tree.** `evawlve/Recipe-App` `origin/master` at `a2c7b76` (the #463 merge); re-fetched before the push, unchanged.
- **Labels.** "Measured" means a command run in this checkout on 2026-10-04 (Node v22.22.0, npm 10.9.4, ESLint 9.39.1, after `npm ci`). "Not run" means the step needs the box, the DB, Typesense or an LLM key, and this session had none of them. No live API was called.
- **Siblings.** cloud-21 co-owns `package.json` through its dependency lines (far from line 12); cloud-23 owns `src/app/account/delete/**` and friends. Neither overlaps a file in this PR. Whichever PR merges second takes `git merge origin/master`.

## 0. Gates (measured, BEFORE on `a2c7b76` → AFTER on this branch)

| gate | before | after |
|---|---|---|
| `npm ci` | clean | — |
| `npm run lint:ci` | exit 0 · `✖ 461 problems (0 errors, 461 warnings)` · `38 warnings potentially fixable` (ceiling 700) | exit 0 · `✖ 427 problems (0 errors, 427 warnings)` · `4 warnings potentially fixable` (ceiling **447**) |
| `npm run typecheck` | exit 0 | exit 0 |
| `env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="postgresql://x:y@localhost:5432/z" npm run test:ci` | exit 0 · 271/271 suites · 5482 passed, 1 skipped | exit 0 · 271/271 suites · 5482 passed, 1 skipped |
| CI (`build`, `Vercel`) | — | on the PR; this session does not merge |

The `ESLintIgnoreWarning: The ".eslintignore" file is no longer supported` line on stderr is baseline on both sides and was left alone (the config files are MUST NOT).

## 1. ROW 1 — which config `lint:ci` reads, and the tracked baseline

**Measured.** `npx eslint --print-config src/app/api/ok/route.ts` resolves from `eslint.config.cjs` alone (flat config: `linterOptions.reportUnusedDisableDirectives: 1`, `no-console` warn with `warn`/`error` allowed, `@typescript-eslint/no-unused-vars` warn with the `^_` ignore patterns, the `fetch('/api/...')` `no-restricted-syntax` rule). `.eslintrc.ci.js` and `.eslintrc.json` are inert under ESLint 9 and were not touched.

**Baseline, tracked files only.** Command:

```
npx eslint . -f json -o lint-before.json
git ls-files > tracked.txt
# python: sum warningCount over results whose path (relative to the repo root) is in tracked.txt
```

Result: **461 tracked warnings, 0 errors**; 0 warnings in untracked files (the `scratch/` tree the Mac measured on 2026-10-03 does not exist in this checkout, so here `eslint .` == the tracked count, matching PR #464's CI reading of `461 problems`). All 38 fixable messages are `ruleId: null` / `Unused eslint-disable directive (no problems were reported from '@typescript-eslint/no-var-requires')` — none is a `no-console` fix.

Fixable directives per tracked file at baseline (38 = 34 in the 15 brief-named files + 4 in the 3 skipped files):

| file | directives | action |
|---|---|---|
| `scripts/backfill-recipe-features.ts` | 1 | fixed |
| `scripts/eval/__tests__/panel-scale-divided.test.ts` | 1 | fixed |
| `scripts/eval/__tests__/warm-cold-diff.test.ts` | 1 | fixed |
| `scripts/eval/adversary/cli.ts` | 4 | fixed |
| `scripts/eval/classify-drops.ts` | 2 | fixed |
| `scripts/eval/correctness-screen.ts` | 6 | fixed |
| `scripts/eval/probe-bare-serving.ts` | 6 | fixed |
| `scripts/eval/serving-provenance.ts` | 1 | fixed |
| `scripts/eval/snapshot-off-food.ts` | 1 | fixed |
| `scripts/eval/triage-drops.ts` | 2 | fixed |
| `scripts/eval/validator-triage-queue.ts` | 2 | fixed |
| `scripts/eval/winner-diff.ts` | 3 | fixed |
| `src/app/api/nlp/parse/route.write-policy.test.ts` | 2 | fixed (a `/* eslint-disable */ … /* eslint-enable */` block pair + one line directive) |
| `src/lib/__tests__/logger-transform-immunity.test.ts` | 1 | fixed |
| `src/lib/write-policy.test.ts` | 1 | fixed |
| `src/lib/mapping/__tests__/cache-validator.test.ts` | 1 (line 95) | **SKIPPED** — `src/lib/mapping/**` is MUST NOT |
| `src/lib/mapping/__tests__/hand-panel-repair.test.ts` | 1 (line 196) | **SKIPPED** — `src/lib/mapping/**` is MUST NOT |
| `src/lib/nlp/__tests__/segmentation-cache.test.ts` | 2 (lines 45, 195) | **SKIPPED** — `src/lib/nlp/**` is MUST NOT |

Those 4 skipped directives are the `4 warnings potentially fixable` that remain after this PR. They are inside the 447 ceiling and are a one-line job for whichever session next owns those directories.

## 2. ROW 2 — the auto-fix on the 15 files

**EOL check first (measured).** `git ls-files --eol` on the 15 files: all `i/lf w/lf` (`scripts/eval/winner-diff.ts` additionally carries an `eol=lf` attribute). Repo census on `a2c7b76`: 1198 `i/lf`, 106 `i/crlf`, 2 `i/mixed`, 15 `i/-text`, 8 `i/none` — the brief's 106/2 reproduce. `package.json` is LF.

**A baseline quirk that bit, recorded so the next session does not lose an hour to it.** `npx eslint --fix <15 paths>` in one invocation crashes before linting anything:

```
Error: Failed to patch ESLint because the calling module was not recognized.
    at …/node_modules/@rushstack/eslint-patch/lib/_patch-base.js:244:19
    at …/node_modules/@rushstack/eslint-patch/lib/modern-module-resolution.js:11:23
```

Measured bisection: **one** explicit path works (`eslint src/lib/write-policy.test.ts`, `eslint scripts/eval/winner-diff.ts`, `eslint scripts/eval`, `eslint .` all exit 0); **any two or more** explicit paths crash (`eslint a.ts b.ts` → exit 2), with or without `--fix`, and `--concurrency=off` (already the default) does not change it. The crash is `require('@rushstack/eslint-patch/modern-module-resolution')` on line 1 of `eslint.config.cjs`, whose `module.parent` walk cannot find ESLint when the flat config is loaded for a multi-pattern run. It does not affect `lint:ci` (`eslint .` is one pattern) and the config file is MUST NOT, so it is **not fixed here**. Work-around used: one `npx eslint --fix <file>` per file, 15 invocations, each exit 0. The first attempt at the bulk form had its stderr discarded and read as "no diff" — the hidden exit code was 2.

**What the fixer produced, and the one cleanup on top of it.** ESLint's fix for an unused directive replaces the comment text with a single space, so every fixed file gained a whitespace-only line (`+     ` and friends) where the comment stood: 35 insertions / 35 deletions after the 15 runs. Those 35 residual lines were then deleted (line-targeted, from the `git diff -U0` line numbers, each asserted whitespace-only before removal; every file asserted free of `\r\n` before and after). Final diff over the 15 files, measured:

```
15 files changed, 35 deletions(-)      # 0 insertions
```

Every removed line is a directive: 34 are `// eslint-disable-next-line @typescript-eslint/no-var-requires` or `/* eslint-disable @typescript-eslint/no-var-requires */`, and the 35th is the `/* eslint-enable @typescript-eslint/no-var-requires */` that closed the block pair in `route.write-policy.test.ts` (ESLint removes the pair together; the brief's "34" counts warnings, and an `eslint-enable` has no warning of its own). No `console.warn` line was touched; no `no-console` fix was applied. `git ls-files --eol` on the 15 files after: still `i/lf w/lf`.

**Tracked count after (measured, same command as §1 on `lint-after.json`): 427 warnings, 0 errors** = 461 − 34, as the brief expected.

## 3. ROW 3 — the ceiling

`package.json` line 12, the only change in that file:

```
-        "lint:ci": "eslint . --max-warnings 700",
+        "lint:ci": "eslint . --max-warnings 447",
```

447 = 427 (tracked warnings after ROW 2, measured 2026-10-04 on this branch with `npx eslint . -f json` ∩ `git ls-files`) + 20 headroom. `npm run lint:ci` under the new ceiling: exit 0, `✖ 427 problems (0 errors, 427 warnings)`. No other tracked file references `max-warnings` or the old `700` (`grep -rn max-warnings` over `*.md,*.json,*.yml,*.js,*.ts` excluding `node_modules` → only `package.json`; `scripts/doc-check/claims.json` has no lint claim).

What the ratchet now enforces: a PR that adds more than 20 net warnings to tracked files fails `build`. The 136 `scratch/` warnings the Mac sees locally are gitignored and never reach CI, so the Mac's local `lint:ci` reading (597 before this PR) is **not** the CI number and should not be compared to 447 — count tracked files as in §1.

## 4. ROW 4 — #199 verified as SHIPPED (nothing added)

Mobile punch #199 (a startup self-test for the write guard) is already on `master`. Recorded so the Mac consolidation can close it by naming the commit. **No second self-test was added and the guard still does not throw at import** — its header (`scripts/eval/winner-diff-write-guard.ts` lines 5–8) forbids any import or `PrismaClient` so its three importers can load it without installing it.

```
$ git log --oneline -S assertWriteGuardIntercepts -- scripts/eval/winner-diff-write-guard.ts scripts/eval/winner-diff.ts
a833ba1 feat(eval): #199 — winner-diff refuses to start unless its write guard intercepts a raw UPDATE
```

(`git log -S` lists only the commit that introduced the identifier; `7ba3dcd` of the same day, "fix(eval): #199 says what the startup self-test cannot see; the Spanish probe writes to the temp dir by default and validates PARSE_BASE", changed its documentation without changing the occurrence count, so `-S` does not list it. Both are dated 2026-09-15.)

```
$ grep -n assertWriteGuardIntercepts scripts/eval/winner-diff.ts
48: * `assertWriteGuardIntercepts()`). It REFUSES to run (FATAL, exit 1) unless the
210:    assertWriteGuardIntercepts,
959:    await assertWriteGuardIntercepts(prisma, () => suppressedWrites[WRITE_GUARD_SELF_TEST_KEY] ?? 0);
```

Line 959 is the one call, inside the `installWriteGuard()` latch. Pinned by six cases in `scripts/eval/__tests__/winner-diff.test.ts`, `describe('assertWriteGuardIntercepts — the startup self-test winner-diff runs after installing the guard', …)` at line 2658:

1. passes when the installed guard intercepts: tally +1, and the statement never reaches the database
2. sends a provably no-op mutating statement, in the args shape the guard reads
3. refuses when a guard lets the statement through: the tally does not rise
4. refuses when the guard sits on a DIFFERENT client from the one the statement goes through
5. refuses when the tally rises by more than one
6. a statement that throws is not an interception: refuses, and quotes the error

Clean-env test lines (measured on this branch):

```
$ env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="postgresql://x:y@localhost:5432/z" npm run test:ci
PASS api scripts/eval/__tests__/winner-diff.test.ts (7.372 s)
Test Suites: 271 passed, 271 total
Tests:       1 skipped, 5482 passed, 5483 total

$ env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="postgresql://x:y@localhost:5432/z" npx jest --ci scripts/eval/__tests__/winner-diff.test.ts -t assertWriteGuardIntercepts
Test Suites: 1 passed, 1 total
Tests:       192 skipped, 6 passed, 198 total
```

**Closure line for the Mac:** mobile punch #199 → backend `a833ba1c` (+ `7ba3dcd1` docs), 2026-09-15, six pins green on 2026-10-04.

## 5. What this PR does NOT do

- Does not touch `eslint.config.cjs`, `.eslintrc.ci.js`, `.eslintrc.json`, `.eslintignore`, or `scripts/lint.js` (`npm run lint` is broken at baseline and stays that way; CI runs `lint:ci`).
- Does not fix the multi-path `@rushstack/eslint-patch` crash in §2 — config is MUST NOT. If someone owns it later: ESLint 9 flat config does not need the patch (`eslint-config-next` carries its own), so line 1 of `eslint.config.cjs` is a candidate for deletion, to be verified with `eslint a.ts b.ts` exiting 0.
- Does not remove the 4 directives in the three MUST NOT test files (§1 table).
- Does not deploy anything. A merge of this PR changes no runtime behaviour, so there is nothing to build on the box for it.
