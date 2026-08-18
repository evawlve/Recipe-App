#!/usr/bin/env bash
#
# winner-gate.sh — one command for the winner-diff gate.
#
# WHY THIS EXISTS
# ---------------
# scripts/eval/winner-diff.ts is the gate the playbook demands before any
# admission or ranking change may be called safe. It is a good harness. It was
# also run for ZERO of the six mapping investigations on 2026-07-26, and the
# reason is visible in its own header: doing it right is six commands, one of
# which is the prose instruction "copy the tree, edit the copy". Under any time
# pressure that loses to writing a plausible argument instead — which is how
# "admit-only by inspection is not a safety argument" became a four-time repeat
# finding in this repo.
#
# So this driver makes the correct sequence the cheap one. It:
#   1. REFUSES to run without a cold-seed file (winner-diff blind spot (D): a
#      population of already-asked queries cannot contain the cases a fix is
#      supposed to CREATE — that blind spot has invalidated a gate before);
#   2. ABORTS when the diff it is about to print would not be a measurement of the
#      change — retrieval (blind spot (A)), a frozen snapshot input, or a surface
#      the replay never executes at all. See EXIT CODES: those are three different
#      failures with three different remedies, so they are three different aborts;
#   3. builds the BASE tree as a git worktree instead of `git checkout -- <file>`,
#      which is how uncommitted work gets destroyed;
#   4. takes ONE snapshot shared by both sides, so retrieval nondeterminism
#      cannot enter the diff;
#   5. enforces the noise-floor receipt (must be 0) before it will diff.
#
# The underlying harness is strictly read-only and enforces that with a Prisma
# write-guard middleware. This driver adds no writes of its own.
#
# USAGE
#   scripts/eval/winner-gate.sh --cold-seeds <file> [options]
#
#   --cold-seeds <file>   REQUIRED. One raw ingredient line per line: the queries
#                         your change is supposed to FIX. These must include keys
#                         that have never been asked. Blank lines and #-comments
#                         are ignored.
#   --base <ref>          Base to compare against (default: origin/master).
#   --regression <n>      Also sample n already-asked lines from the event log as
#                         a regression population (default 250, 0 to disable).
#   --label <name>        Names the artifact directory (default: the branch name).
#   --keep                Keep the base worktree for inspection.
#   --no-serving          Skip the serving stage. Do NOT pass this for any change
#                         that could touch grams — see below.
#
# THE SERVING STAGE IS ON BY DEFAULT
#   winner-diff stops at winner selection (its own limit (B)). That blind spot
#   passed a green gate on PR #173, which moved `mac and cheese` onto the correct
#   record while the billed number went 90.4 -> 39.5 kcal against a true ~400 --
#   the 28g serving anchor never moved and the new record has a lower kcal/100g.
#   So this driver runs `--with-serving` on both replays and both noise floors,
#   and the diff prints a SERVING section reporting what the USER IS BILLED.
#   Rows it cannot adjudicate (AI-estimated tiers) are listed as UNJUDGED, never
#   folded into the SAME count.
#
# EXAMPLE
#   scripts/eval/winner-gate.sh --cold-seeds /tmp/mac-and-cheese-seeds.txt
#
# EXIT CODES — three different NOs, and the difference is the whole point
#   0  the gate ran and printed a diff (a diff is not a verdict; read the questions
#      it prints at the end)
#   2  bad invocation, or no --cold-seeds
#   3  THE DIFF WOULD BE VACUOUS. The run can happen, would report SAME, and that
#      SAME means nothing: retrieval changed (the pool is one neither tree makes) or
#      a FROZEN SNAPSHOT INPUT changed (the field is replayed, not recomputed).
#   4  the noise floor is non-zero, so nothing below it is a result.
#   5  THE DIFF WOULD BE ABOUT A DIFFERENT PROGRAM. The change is on a surface
#      winner-diff never executes — see UNOBSERVED_SURFACE_PATHS. Distinct from 3
#      on purpose: 3 says "the instrument was pointed at your change and is blind",
#      5 says "the instrument was never pointed at your change at all", and those
#      two have different remedies.
#
set -euo pipefail

BASE_REF="origin/master"
COLD_SEEDS=""
REGRESSION_N=250
LABEL=""
KEEP=0
SERVING="--with-serving"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --cold-seeds) COLD_SEEDS="$2"; shift 2 ;;
        --base)       BASE_REF="$2";   shift 2 ;;
        --regression) REGRESSION_N="$2"; shift 2 ;;
        --label)      LABEL="$2";      shift 2 ;;
        --keep)       KEEP=1;          shift ;;
        --no-serving) SERVING="";      shift ;;
        -h|--help)    sed -n '2,74p' "$0"; exit 0 ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

cd "$(git rev-parse --show-toplevel)"
[[ -f scripts/eval/winner-diff.ts ]] || { echo "must run from the backend repo root" >&2; exit 2; }

# ---------------------------------------------------------------- blind spot D
if [[ -z "$COLD_SEEDS" ]]; then
    cat >&2 <<'EOF'
REFUSING TO RUN: --cold-seeds is required.

winner-diff's populations (--from-events, --from-cache) contain ONLY queries that
have already been asked. If your change's value proposition is "queries that
returned nothing now work", those queries are by construction absent, the diff
reports SAME on 100% of rows, and the gate passes vacuously. That has already
invalidated one gate in this repo.

Write the queries your change is supposed to fix into a file, one per line,
including ones nobody has ever typed, and pass it here. If your change genuinely
creates no new answers, say so in the PR and pass a file containing the cases you
expect to stay UNCHANGED — but pass a file.
EOF
    exit 2
fi
[[ -f "$COLD_SEEDS" ]] || { echo "cold-seeds file not found: $COLD_SEEDS" >&2; exit 2; }

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
LABEL="${LABEL:-${BRANCH//\//-}}"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
OUT="/tmp/winner-gate-${LABEL}-${STAMP}"
mkdir -p "$OUT"

echo "=== winner-gate ==="
echo "branch:    $BRANCH"
echo "base:      $BASE_REF"
echo "cold:      $COLD_SEEDS ($(grep -cvE '^\s*(#|$)' "$COLD_SEEDS") seeds)"
echo "artifacts: $OUT"
echo

# ---------------------------------------------------------------- blind spot A
# A frozen-pool diff replays a pool BOTH variants inherit. If the branch changes
# retrieval, each side would have produced a different pool and the comparison is
# void — not conservative, void.
# The change set must include UNCOMMITTED work. `$BASE_REF...HEAD` sees only what is
# committed, but winner-diff replays the WORKING TREE — so an uncommitted edit to a
# retrieval or frozen-input file sailed past both aborts while actually changing the
# BRANCH side. Union the committed diff with staged, unstaged and untracked. (2026-08-14)
# TEST FILES ARE FILTERED OUT for the same reason gitDirtyHash() skips them: a test
# file cannot change what a replay produces, so aborting on one is a FALSE abort.
# That matters more than tidiness — a gate that cries wolf on a test-only edit is a
# gate people learn to bypass, and it fired on the very first real change after the
# aborts shipped (a digit-brands lexicon edit whose test file matched `src/lib/parse/`).
#
# EXTENDED 2026-08-15 from a bare `__tests__` to also cover the COLOCATED convention
# (`foo.test.ts` next to `foo.ts`), because this repo uses both and the second half was
# unprotected: 11 tracked files match `*.test.ts` outside any `__tests__` directory, 6
# of them under src/app/api (re-derive: `find src -name '*.test.ts' -not -path
# '*__tests__*' | wc -l` -> 11; `find src/app/api -name '*.test.ts' | wc -l` -> 6,
# measured 2026-08-15). Nothing currently listed matched one, so this fixes no live
# red — it is what keeps UNOBSERVED_SURFACE_PATHS below from shipping the #311 false
# abort a second time, since `src/app/api/foods/search/route.test.ts` is a route-shaped
# path with no `__tests__` segment in it.
#
# It is a NAMED variable so the test suite can read the shipped filter instead of
# restating it. A restated copy is free to drift, which is exactly the failure the
# pattern-read-from-source discipline below exists to prevent.
NON_REPLAY_PATHS='__tests__|\.test\.tsx?$|\.spec\.tsx?$'
changed_paths() {
    {
        git diff --name-only "$BASE_REF"...HEAD
        git diff --name-only
        git diff --name-only --cached
        git ls-files --others --exclude-standard
    } | grep -vE "$NON_REPLAY_PATHS" | sort -u
}

RETRIEVAL_PATHS='src/lib/mapping/gather-candidates.ts|src/lib/search/|query-builder|typesense|fatsecret-lane|embedding'
if changed_paths | grep -qE "$RETRIEVAL_PATHS"; then
    echo "ABORT: this branch touches RETRIEVAL:" >&2
    changed_paths | grep -E "$RETRIEVAL_PATHS" | sed 's/^/  /' >&2
    cat >&2 <<'EOF'

winner-diff freezes the candidate pool at gatherCandidates' output and replays it
through both variants. When retrieval itself changes, both sides replay a pool
NEITHER would have produced, so the diff measures nothing. Re-snapshot per
variant (--cross-snapshot) and accept that retrieval nondeterminism is then
inside your signal — or gate this change a different way.
EOF
    exit 3
fi

# ---------------------------------------------------------------- blind spot A2
# THE FROZEN INPUTS. replaySelection() reads SEVEN fields straight off the snapshot
# entry and never recomputes any of them:
#     trimmed  parsed  normalizedName  isBrandedQuery  targetBrand
#     aiCanonicalBase  aiNutritionEstimate
# (the first five are read at the top of replaySelection(); aiCanonicalBase becomes the
# rerank query and aiNutritionEstimate the reranker's nutrition tiebreak, both inside
# runStep4()). So a change to any PRODUCER of those fields replays identically on both
# sides and the diff reports SAME vacuously: a green receipt for a change the instrument
# structurally cannot observe.
#
# THE MEMBERSHIP RULE — two clauses, and the second is what keeps the gate usable:
#   (1) a change to the file can move one of the seven fields, i.e. the file is on the
#       PRE-GATHER path that computes them; AND
#   (2) the file is NOT itself executed by replaySelection(). A file the replay runs is
#       observed on both sides, so a frozen-pool diff is a real measurement of it —
#       aborting there would refuse the gate its own purpose.
# It is the snapshot's field list, NOT an import closure: src/lib/mapping is an import
# cycle, so the closure from these roots is all 73 loaded files and the gate would abort
# on every mapping edit.
#
# EXTENDED 2026-08-15, because clause (1) had four dedicated producers missing and the
# hole was paid for. `llm-output-guards.ts` writes THREE of the seven — normalizedName
# (stripIntroducedFoodTokens, restoreNutritionModifiers), aiCanonicalBase (same two) and
# isBrandedQuery (resolveIsBrandedQuery) — and was absent. All three commits that have
# ever touched it are frozen-field changes that this abort should have caught and did
# not: the flavour-word strip (#228/#229 era), the branded-flag downgrade (#230) and the
# nutrition-modifier restoration (#316). #316 is the measured case: its frozen-pool
# receipt would have been green and vacuous, and the deploy write-off says so
# (KindaHealthyMobile sync-docs/reports/2026-08-15_the-modifier-is-dropped-at-the-cache-key.md §4).
# Also added, same rule, same reasoning:
#   ai-parse.ts            aiParseIngredient() REPLACES `parsed` (and baseName) wholesale
#                          when the regex parser finds no unit.
#   ai-synonym-generator.ts findCanonicalName() rewrites the query BEFORE
#                          parseIngredientLine() runs, so it moves `parsed` and
#                          `normalizedName` together.
#   modifier-constraints.ts feeds shouldNormalizeLlm(), i.e. it decides whether the LLM
#                          writer of normalizedName runs at all — exactly the basis on
#                          which normalize-gate.ts is already listed.
#   cache-key-core.ts      owns IDENTITY_UNIT_HINTS, consumed pre-parse to restore
#                          `egg white`/`egg yolk` into baseName -> normalizedName. Only
#                          that one constant is frozen-relevant; a path regex cannot say
#                          "this symbol", so the file is listed and the abort is
#                          conservative on the rest of it.
#
# DELIBERATELY ABSENT, so nobody re-derives them and adds them (each one is a residual
# blind spot this gate KNOWS about and accepts, not an oversight):
#   simple-rerank.ts       hasDecisiveBrandContext() + candidateMatchesTargetBrand()
#                          rewrite normalizedName in the brand re-assert, and the first
#                          also feeds resolveIsBrandedQuery(). But simpleRerank() is what
#                          the replay RUNS. Listing it aborts every ranking change — the
#                          gate's primary use — so the brand-re-assert half stays
#                          unobservable and that is the cheaper of the two failures.
#   map-ingredient-with-fallback.ts  The orchestrator writes frozen fields from its own
#                          literals (GENERIC_FALLBACKS, the identity-hint and qualifier
#                          restorations, the pepper/bouillon/corn rewrites). It is also
#                          partly executed by the replay (computeFloorHitIds,
#                          makeSortedFilteredComparator) and its selection region is
#                          already guarded by the caller-hash drift abort below, which
#                          exits 3 on an unrecognised tree. 76 of the 637 commits since
#                          2026-07-01 touch it (measured: `git log --since=2026-07-01
#                          --oneline -- <path> | wc -l`), so listing it converts "refuse
#                          what you cannot see" into "refuse almost everything" — the
#                          #311 false-abort failure at scale, and a gate people learn to
#                          bypass measures nothing at all.
#   validated-mapping-helpers.ts  getAiNormalizeCache() supplies aiCanonicalBase /
#                          isBranded / aiNutritionEstimate on the gate-skip branch, so it
#                          is a producer; but it is the save-gate + lookup file (33
#                          commits in the same window, second-most-edited in the mapper)
#                          and the rest of it is entirely invisible to a replay.
FROZEN_INPUT_PATHS='src/lib/parse/|src/lib/mapping/normalization-rules\.ts|data/fatsecret/normalization-rules\.json|src/lib/mapping/brand-detector\.ts|src/lib/mapping/brand-lexicon\.json|src/lib/mapping/digit-brands\.ts|src/lib/mapping/ai-normalize\.ts|src/lib/mapping/normalize-gate\.ts|src/lib/mapping/llm-output-guards\.ts|src/lib/mapping/ai-parse\.ts|src/lib/mapping/ai-synonym-generator\.ts|src/lib/mapping/modifier-constraints\.ts|src/lib/mapping/cache-key-core\.ts'
if changed_paths | grep -qE "$FROZEN_INPUT_PATHS"; then
    echo "ABORT: this branch touches a FROZEN SNAPSHOT INPUT:" >&2
    changed_paths | grep -E "$FROZEN_INPUT_PATHS" | sed 's/^/  /' >&2
    cat >&2 <<'EOF'

These files produce trimmed / parsed / normalizedName / isBrandedQuery / targetBrand /
aiCanonicalBase / aiNutritionEstimate, which replaySelection() reads off the FROZEN
snapshot rather than recomputing. Both sides would replay byte-identical inputs, so this
run would report SAME no matter what your change does. That is not a pass — it is the
instrument being blind.

Two arms are available instead:
  1. Re-cut the snapshot per side (--cross-snapshot). The harness brands the result
     RETRIEVAL-NOISE-CONTAMINATED, and it means it; read the diff with that in mind.
  2. Score a hand-cut corpus live, the way the tail-audit fleet runs. Slower, and the
     only arm that observes a normalization or detector change end to end.

Either way, pair it with a cold golden ×3 restarted against the §10x baseline, served
from the host you are actually gating (run-eval.ts is an HTTP client; --base decides
which build answers, NOT your working tree).
EOF
    exit 3
fi

# ------------------------------------------------------- THE UNOBSERVED SURFACE
# A THIRD KIND OF BLINDNESS, AND IT IS NOT EITHER OF THE TWO ABOVE. Filing it under
# them was considered and rejected, because the reason a reader is given is the whole
# value of an abort:
#
#   RETRIEVAL_PATHS   winner-diff RUNS your change, on a pool neither tree would have
#                     produced. The diff happens and is VOID.
#   FROZEN_INPUT      winner-diff RUNS, but reads your changed field off the frozen
#                     snapshot instead of recomputing it. The diff reports SAME
#                     vacuously — blind about a surface it is genuinely pointed at.
#   here              winner-diff NEVER EXECUTES THIS CODE. replaySelection() calls
#                     the mapper directly; the HTTP route is not on that path at all.
#                     A green receipt is not a weak result about your change, it is an
#                     accurate result about a DIFFERENT program.
#
# THE MEMBERSHIP RULE IS ONE CLAUSE, and it is structural rather than a judgement
# call: the import direction is one-way. `src/lib` imports `src/app` in ZERO files
# (re-derive: `grep -rl '@/app/' src/lib | wc -l` -> 0, measured 2026-08-15), and the
# replay's import closure roots entirely in `src/lib`, so nothing under `src/app/api`
# can be reached by a replay however the routes are refactored. That is why the whole
# directory is listed and not just the two lane routes: narrowing to
# `foods/search|nlp/parse` would state a rule weaker than the one that is actually
# true, and would hand a silent green to `/api/foods/barcode` and
# `/api/foods/[id]/serving` — the two routes the #324 write-off names as carrying the
# same latent defect.
#
# THE PRICE, measured against the boundary this gate has already accepted. 30 of the
# 656 commits since 2026-07-01 touch `src/app/api` (4.6%); narrowing to the two lane
# routes would be 27 (4.1%), so the extra breadth costs THREE commits in that window.
# `map-ingredient-with-fallback.ts` is deliberately absent from FROZEN_INPUT_PATHS at
# 76/656 (11.6%) on the stated grounds that listing it converts "refuse what you
# cannot see" into "refuse almost everything"; 4.6% is comfortably inside that
# accepted boundary and buys a rule with no exceptions in it. (re-derive:
# `git log --since=2026-07-01 --oneline -- src/app/api | wc -l` -> 30 against
# `git log --since=2026-07-01 --oneline | wc -l` -> 656, measured 2026-08-15.)
#
# WHY THIS IS AN ABORT AND NOT A WARNING. It is the weakest of the three cases —
# the diff it suppresses is honest about the mapper — and a warning was the obvious
# proportionate answer. It loses to this file's own precedent: `announceVariantFit`
# printed exactly such a warning, the driver piped it to `tail -6`, and every run
# this driver had ever done replayed the wrong variant behind it. A warning nobody
# can see is not a warning. The escape hatch is a SPLIT, named in the message.
#
# WHAT THIS DOES NOT FIX, so nobody reads the abort as a closure. gitDirtyHash() still
# never hashes these files, and it should not — the reasoning is owned by
# HASHED_SOURCE_ROOTS in winner-diff-screens.ts. Short version: hashing 72 files no
# replay loads (164 -> 236, +43.9%) would mint a fresh-looking tree id that proves
# nothing, which is worse than an honest vacuous SAME. The blindness is structural and
# stays. This abort only stops it being sold as a receipt.
#
# WHY src/lib/nlp/ IS HERE TOO (added 2026-08-18). It is not a route, but it is reachable
# only THROUGH one: `grep -rn "lib/nlp/" src --include=*.ts` outside that directory returns
# `src/app/api/nlp/parse/route.ts` and route tests, and nothing else — src/lib/mapping,
# src/lib/parse, src/lib/search and src/lib/servings import it in ZERO files. replaySelection()
# calls mapIngredientWithFallback directly and issues no HTTP request, so the segmenter, the
# segmentation cache, the seg-line key and the segmentation diff are all code the replay cannot
# execute. winner-diff-screens.ts says so in its own words: item count "comes from the LLM
# segmenter, which a single-query replay never runs".
#
# Before this line, a segmenter change matched NONE of the three lists, so the gate RAN and
# reported a clean SAME over code it never touched — the exact failure UNOBSERVED_SURFACE exists
# to stop, one directory over from where it was first found.
UNOBSERVED_SURFACE_PATHS='src/app/api/|src/lib/nlp/'
if changed_paths | grep -qE "$UNOBSERVED_SURFACE_PATHS"; then
    echo "ABORT: this branch changes an HTTP ROUTE, a surface winner-diff never executes:" >&2
    changed_paths | grep -E "$UNOBSERVED_SURFACE_PATHS" | sed 's/^/  /' >&2
    cat >&2 <<'EOF'

THIS IS NOT THE USUAL "the instrument is blind here" ABORT. winner-diff does not
execute this code AT ALL. It replays a frozen pool through mapIngredientWithFallback
directly and never issues an HTTP request, and nothing under src/app/api is reachable
from src/lib (the import direction is one-way). gitDirtyHash() does not even hash
these files, so the tree id identifying the two sides does not move when you edit one.

So a SAME here is not a weak result about your change. It is an accurate result about
a different program, and quoting it as a receipt is the mistake PR #324 made: the
search route billed kcal100 0 on 3,394 FatSecret chain records, and a winner-gate run
on that branch would have reported SAME on every row while saying nothing whatsoever
about the defect.

DO NOT PRESENT A GREEN WINNER-GATE AS A RECEIPT FOR A ROUTE CHANGE.

What DOES constitute evidence for a route, in the order you should build it:
  1. A per-case golden assertion naming the wire field, list-wide and fail-closed —
     PR #321's `requireEnergy` is the worked example. Write it FIRST and watch it go
     red on master; an assertion added after the fix proves only that the fix is
     self-consistent.
  2. Cold golden x3, restarted, against the current baseline, served from the host you
     are actually gating (run-eval.ts is an HTTP client, so --base decides which build
     answers, NOT your working tree). That arm DOES call the route.
  3. A live probe at the CONSUMER, both directions: the record you fixed AND an honest
     one that must not move. And probe BOTH lanes — search and parse disagree in both
     directions on the same record, so a value verified on one says nothing about the
     other.

If the route edit is incidental and the change you want gated lives under src/lib,
SPLIT IT: gate the src/lib half on a branch that does not carry the route edit. That
is the supported way past this abort. There is no --force, deliberately.
EOF
    exit 5
fi

RUN='npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/eval/winner-diff.ts'

# ------------------------------------------------------- blind spot A, part 2
# THE VARIANT MUST BE THE ONE THE TREES ACTUALLY CONTAIN.
#
# `resolveVariant()` defaults to 'baseline', and this driver never passed
# --variant, so every run it has ever done replayed `baseline` -- the PRE-#168
# caller, where confidenceGate PRE-EMPTS Step 4 and simpleRerank never runs. No
# tree has contained that shape since 2026-07-26 (`fb211474`). On the ~10.6% of
# lines where the gate fires, both sides were therefore modelling a caller
# neither tree has, and any change living inside Step 4 is INVISIBLE on exactly
# those rows -- understating both its benefit and its risk.
#
# winner-diff says this out loud (`announceVariantFit`). The driver piped it to
# `tail -6` and it scrolled past. A warning nobody can see is not a warning,
# which is the same lesson as the drift banner it sits next to.
#
# Derived from the tree, never assumed: `hashes` resolves this tree's caller hash
# through KNOWN_CALLERS. If the tree is UNRECOGNISED there is no honest variant
# to pick and we stop -- that is the drift guard's job and it must not be routed
# around here.
TREE_VARIANT="$(eval "$RUN" hashes 2>/dev/null | sed -n 's/^this tree is: \([a-z-]*\) .*/\1/p' | head -1)"
if [[ -z "$TREE_VARIANT" || "$TREE_VARIANT" == "UNRECOGNISED" ]]; then
    echo "ABORT: cannot resolve this tree's caller variant (got '${TREE_VARIANT:-<empty>}')." >&2
    echo "The caller block is drifted or unrecognised. Re-pin it in winner-diff.ts" >&2
    echo "(KNOWN_CALLERS + TRANSCRIBED_CALLER) after running \`winner-diff verify\`." >&2
    echo "Replaying a variant this tree does not contain is not a measurement." >&2
    exit 3
fi
VARIANT_ARG="--variant $TREE_VARIANT"
echo "variant:   $TREE_VARIANT (resolved from this tree's caller hash)"

# ------------------------------------------------------------ base worktree
# A worktree, NOT `git checkout <ref> -- <file>`: that form silently discards
# uncommitted edits when HEAD is the base commit (playbook section 9).
BASE_TREE="/tmp/winner-gate-base-${STAMP}"
cleanup() {
    if [[ $KEEP -eq 0 ]]; then
        git worktree remove "$BASE_TREE" --force >/dev/null 2>&1 || true
    else
        echo "base worktree kept at $BASE_TREE"
    fi
}
trap cleanup EXIT

echo "[1/5] materializing BASE tree from $BASE_REF"
git worktree add -q --detach "$BASE_TREE" "$BASE_REF"
ln -s "$(pwd)/node_modules" "$BASE_TREE/node_modules"
[[ -f .env ]] && cp .env "$BASE_TREE/.env"

# ------------------------------------------------------------ population
POP="$OUT/population.txt"
grep -vE '^\s*(#|$)' "$COLD_SEEDS" > "$POP"
COLD_N=$(wc -l < "$POP" | tr -d ' ')
if [[ "$REGRESSION_N" -gt 0 ]]; then
    echo "[2/5] snapshot: $COLD_N cold seeds + up to $REGRESSION_N already-asked lines"
else
    echo "[2/5] snapshot: $COLD_N cold seeds (regression population disabled)"
fi

# One snapshot, taken from BASE, shared by both replays. Retrieval runs once.
( cd "$BASE_TREE" && eval "$RUN" snapshot --from-file "$POP" --out "$OUT/snap.json" ) 2>&1 | tail -20

if [[ "$REGRESSION_N" -gt 0 ]]; then
    ( cd "$BASE_TREE" && eval "$RUN" snapshot --from-events --limit "$REGRESSION_N" \
        --out "$OUT/snap-regression.json" ) 2>&1 | tail -8
fi

# ------------------------------------------------------------ noise floor
# The receipt is keyed by (SNAPSHOT, TREE HASH), so `diff` requires one per
# snapshot per side — four runs when a regression population is in play. Missing
# any one makes diff refuse to report, which is how both of this driver's own
# bugs were caught.
noise_floor_both_trees() {
    local snap="$1" name="$2"
    if ! ( cd "$BASE_TREE" && eval "$RUN" noise-floor --snapshot "$snap" $VARIANT_ARG $SERVING ) 2>&1 | tail -6; then
        echo "ABORT: noise floor non-zero on BASE for $name. The replay is not" >&2
        echo "deterministic, so any before/after claim below it is not a result." >&2
        exit 4
    fi
    if ! eval "$RUN" noise-floor --snapshot "$snap" $VARIANT_ARG $SERVING 2>&1 | tail -6; then
        echo "ABORT: noise floor non-zero on BRANCH for $name. Your change" >&2
        echo "introduced nondeterminism into replay — that is itself the finding." >&2
        exit 4
    fi
    # The ledger-path bug this used to work around is FIXED upstream: a replay now
    # records its own snapshot path, so `diff` finds the ledger by construction.
    # The old workaround mirrored the ledger to a shared "snapshot.noise-floor.json",
    # which was actively harmful once this driver grew a second population — the
    # regression mirror overwrote the cold one and `diff` refused to report a run
    # whose receipts were all present and all zero.
}

echo "[3/5] noise floor: every snapshot x both trees (must be 0)"
noise_floor_both_trees "$OUT/snap.json" "cold"
if [[ "$REGRESSION_N" -gt 0 ]]; then
    noise_floor_both_trees "$OUT/snap-regression.json" "regression"
fi

# ------------------------------------------------------------ replays
echo "[4/5] replay BASE, then BRANCH, against the identical frozen pool"
( cd "$BASE_TREE" && eval "$RUN" replay --snapshot "$OUT/snap.json" \
    --out "$OUT/A-base.json" --label BASE $VARIANT_ARG $SERVING ) 2>&1 | tail -6
eval "$RUN" replay --snapshot "$OUT/snap.json" \
    --out "$OUT/B-branch.json" --label BRANCH $VARIANT_ARG $SERVING 2>&1 | tail -6

if [[ "$REGRESSION_N" -gt 0 ]]; then
    ( cd "$BASE_TREE" && eval "$RUN" replay --snapshot "$OUT/snap-regression.json" \
        --out "$OUT/A-base-regression.json" --label BASE $VARIANT_ARG $SERVING ) 2>&1 | tail -4
    eval "$RUN" replay --snapshot "$OUT/snap-regression.json" \
        --out "$OUT/B-branch-regression.json" --label BRANCH $VARIANT_ARG $SERVING 2>&1 | tail -4
fi

# ------------------------------------------------------------ diff
echo
echo "[5/5] DIFF — cold population (the cases the change is supposed to create)"
eval "$RUN" diff --a "$OUT/A-base.json" --b "$OUT/B-branch.json" --screens 2>&1 | tee "$OUT/diff-cold.txt"

if [[ "$REGRESSION_N" -gt 0 ]]; then
    echo
    echo "=== DIFF — regression population (already-asked lines that must not move) ==="
    eval "$RUN" diff --a "$OUT/A-base-regression.json" --b "$OUT/B-branch-regression.json" --screens \
        2>&1 | tee "$OUT/diff-regression.txt"
fi

cat <<EOF

=== winner-gate done ===
artifacts: $OUT

Read it in this order, and do not skip questions 2 or 3:
  1. Did the COLD population move in the intended direction? If it shows SAME on
     everything, the change does not do what the PR says it does.
  2. Did the REGRESSION population move at all? Every mover there is a cost you
     are paying, and it must be enumerated in the PR body — not summarized.
  3. In the SERVING DIFF: which way did the BILLED number go? A winner can move
     onto the right record and bill worse. If the PR claims an under-bill is
     fixed, a GRAMS-CHANGED row going the wrong way refutes that claim outright,
     and UNJUDGED rows are not evidence of safety.

Still invisible to this harness: the save gates, and warm behaviour (replay forces
skipCache). A SAME here does NOT prove the CACHED row is unchanged — for that,
run the eval and check the stored FoodMapping row directly.
EOF
