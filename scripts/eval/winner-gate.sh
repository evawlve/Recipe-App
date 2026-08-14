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
#   2. ABORTS when the branch touches retrieval, because a frozen-pool diff is
#      meaningless then (blind spot (A));
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
        -h|--help)    sed -n '2,58p' "$0"; exit 0 ;;
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
changed_paths() {
    {
        git diff --name-only "$BASE_REF"...HEAD
        git diff --name-only
        git diff --name-only --cached
        git ls-files --others --exclude-standard
    } | sort -u
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
# THE FROZEN INPUTS. replaySelection() reads normalizedName, parsed, isBrandedQuery
# and targetBrand STRAIGHT OFF the snapshot entry — it never re-runs the parser, the
# normalizer or the brand detector. So a change to any PRODUCER of those fields replays
# identically on both sides and the diff reports SAME vacuously: a green receipt for a
# change the instrument structurally cannot observe.
#
# The rule is the snapshot's own field list, NOT "four more filenames". It is deliberately
# not an import closure either: src/lib/mapping is an import cycle, so the closure from
# these roots is all 73 loaded files and the gate would abort on every mapping edit.
FROZEN_INPUT_PATHS='src/lib/parse/|src/lib/mapping/normalization-rules\.ts|data/fatsecret/normalization-rules\.json|src/lib/mapping/brand-detector\.ts|src/lib/mapping/brand-lexicon\.json|src/lib/mapping/digit-brands\.ts|src/lib/mapping/ai-normalize\.ts|src/lib/mapping/normalize-gate\.ts'
if changed_paths | grep -qE "$FROZEN_INPUT_PATHS"; then
    echo "ABORT: this branch touches a FROZEN SNAPSHOT INPUT:" >&2
    changed_paths | grep -E "$FROZEN_INPUT_PATHS" | sed 's/^/  /' >&2
    cat >&2 <<'EOF'

These files produce normalizedName / parsed / isBrandedQuery / targetBrand, which
replaySelection() reads off the FROZEN snapshot rather than recomputing. Both sides
would replay byte-identical inputs, so this run would report SAME no matter what your
change does. That is not a pass — it is the instrument being blind.

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
