# cloud-33 — backend `npm run lint` works again and equals `lint:ci` without the ceiling

Run 2026-10-16 UTC, cloud session, GitHub checkout only (no box, no DB, no secrets). Base: `origin/master` = `be9b27ab` (descendant of `5560b864`, checked with `git merge-base --is-ancestor` → 0). Node v22.22.0, ESLint v9.39.1, `eslint-config-next@15.0.0`.

## Change

| File | Change |
|---|---|
| `package.json` | `"lint": "node scripts/lint.js"` → `"lint": "eslint ."` (the `lint:ci` line, `--max-warnings 447`, untouched; no dependency line touched) |
| `scripts/lint.js` | deleted (`git rm`) |
| `CLAUDE.md` | the Commands **Lint** line only: now names `npm run lint` (= `eslint .`) next to `npm run lint:ci` |

Candidate **(a)** was taken. The caller check (`git grep -nE "scripts/lint\.js|node scripts/lint\b" -- . ':!reports/**' ':!package-lock.json'`) returned exactly one hit, `package.json:11` (the `lint` line), so nothing else invokes the script and deleting it is safe. (b) (keep a wrapper that spawns `eslint .`) would be a file that does what one npm script string already does.

## Mechanism

- **Measured.** `@rushstack/eslint-patch/modern-module-resolution` throws `Failed to patch ESLint because the calling module was not recognized.` whenever ESLint gets two or more patterns:
  - Node API: `new ESLint().lintFiles(['src/lib/db.ts'])` → resolved (1 result); `lintFiles(['src/lib/db.ts','src/middleware.ts'])` → rejected with the message.
  - CLI: `npx eslint src scripts` → exit 2, message present once.
  - One pattern works, `.` included (`lint:ci` exit 0).
- **Measured.** `scripts/lint.js` globbed `src/`, `scripts/`, `eval/` and `prisma/` and passed every matched path to `lintFiles` (770 tracked paths at `be9b27ab`), so it crashed on every run: BEFORE `npm run lint` → `exit=1`, the patch message appears once in its output.
- **Measured.** Those 770 paths are a strict subset of the 783 files `eslint .` lints (all 783 are tracked; 0 lint.js paths are missing from `eslint .`). The 13 extra files: `.claude/workflows/triage-fix-classes.js`, `.eslintrc.ci.js`, `dangerfile.ts`, `eslint.config.cjs`, `jest.config.js`, `jest.setup.no-analysis-writes.js`, `jest.setup.no-llm.js`, `next-env.d.ts`, `next.config.ts`, `postcss.config.js`, `sentry.edge.config.ts`, `sentry.server.config.ts`, `tailwind.config.js`. (The brief measured 769/782 at `5560b864`. One more tracked file has landed since then. The 13 extras are the same.)
- **Measured.** `node_modules/eslint-config-next/index.js:53` has its own `require('@rushstack/eslint-patch/modern-module-resolution')`. Running `node -e "require('eslint-config-next')"` outside ESLint throws the same error. **Reasoned** from that: removing line 1 of `eslint.config.cjs` would not stop the crash, because loading the config still loads the patch. This is why candidate (c) stays refuted. I did not edit the config (MUST NOT), so (c) itself was not run.

## Gates (BEFORE = `be9b27ab`, AFTER = this branch, same container)

| Gate | BEFORE | AFTER |
|---|---|---|
| `npm ci` | exit 0 | (same tree of deps; not re-run, no dependency change) |
| `npm run lint` | **exit=1** (patch crash) | **exit=0**, `✖ 423 problems (0 errors, 423 warnings)` |
| `npm run lint:ci` | exit=0, 0 errors / 423 warnings | exit=0, 0 errors / 423 warnings |
| `npm run typecheck` | exit 0 | exit 0 |
| `test:ci` (`env -i …DATABASE_URL=postgresql://x:y@localhost:5432/z`) | exit=0, 275/275 suites, 5540 passed, 1 skipped | exit=0, 275/275 suites, 5540 passed, 1 skipped |

## Equality proof

- **`lint:ci` stylish output, BEFORE vs AFTER:** identical. The only differing line is the `(node:<pid>)` prefix on the `.eslintignore` deprecation warning. With the PID normalised, `diff` exits 0 (667 lines).
- **AFTER `npm run lint` vs BEFORE `npm run lint:ci` stylish:** identical, PID normalised (`diff` → 0). So `lint` is `lint:ci` without `--max-warnings 447`.
- **`npx eslint . -f json` rule-id histogram (rule:severity → count):**

  | rule | BEFORE | AFTER |
  |---|---|---|
  | `no-console` (warn) | 225 | 225 |
  | `@typescript-eslint/no-unused-vars` (warn) | 194 | 194 |
  | `(null)` (warn — unused disable directives) | 4 | 4 |
  | **errors / warnings** | **0 / 423** | **0 / 423** |

- **File set:** BEFORE 783 entries, AFTER 782. The single difference is `scripts/lint.js`, present only BEFORE with **0 messages**. Every other file's `[ruleId, line, column, severity]` message list is identical (strict JSON compare → `true`).
- `--max-warnings 447` unchanged; `lint:ci` reads the same files minus the deleted script.

## Lines for consolidation to update (NOT edited — no mobile checkout here)

- mobile `CLAUDE.md` §Git & CI: "Lint with `npm run lint:ci` (`lint` is broken at baseline)"
- mobile `sync-docs/claude_md_annex.md` §Git & CI: "NOT `lint`, broken at baseline"
- user-scope `~/.claude/CLAUDE.md`: "backend `npm run lint` is broken at baseline"

Backend README/AGENTS/PR-template lines that already say `npm run lint` are now true as written; not edited.

## Findings for Diego (NOT acted on)

**(i) Orphaned devDependencies after (a).**
- `glob` (`package.json:153`, `^11.0.3`): `git grep -n "require('glob')\|from 'glob'"` hit only `scripts/lint.js:7` before this PR, so it now has no direct importer. jest pulls in its own `glob@7.2.3` transitively, so removing the top-level `glob@11` would not affect jest. Removing it is a dependency + lockfile change, which is out of this brief's scope.
- `@rushstack/eslint-patch` (`package.json:138`, `^1.15.0`): still loaded by `eslint.config.cjs:1`. `eslint-config-next@15.0.0` lists it as its own dependency (`^1.10.3`, deduped to 1.15.0) and requires it at `index.js:53`. So the top-level entry is only needed while line 1 of the config exists. It is redundant for resolution, not for function.

**(ii) No Next / React / react-hooks / jsx-a11y rule runs under either command.** `eslint-config-next@15.0.0` exports an **eslintrc object** (`{ extends: ['plugin:react/recommended','plugin:react-hooks/recommended','plugin:@next/next/recommended'], … }`), not a flat array, and has no `.default`. So `nextFlat` in `eslint.config.cjs` takes the `[]` branch and the spread adds nothing. `npx eslint --print-config src/components/auth/AuthCard.tsx`:
- `plugins`: `["@", "@typescript-eslint:@typescript-eslint/eslint-plugin@8.46.3"]`
- `rules` (5 in total): `no-console`, `no-unused-vars` (off), `@typescript-eslint/no-unused-vars`, `react/jsx-key` (off, the repo's own override), `no-restricted-imports`

The histogram above shows the same thing: only `no-console`, `@typescript-eslint/no-unused-vars` and unused-directive reports fire anywhere in the repo. Wiring Next's rules in (e.g. via `FlatCompat` or a flat-capable `eslint-config-next`) would change the histogram and the 447 ceiling, so it is a separate decision.

## CI

CI: not read — consolidation runs `gh pr checks`.
