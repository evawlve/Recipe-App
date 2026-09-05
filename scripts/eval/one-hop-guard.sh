#!/usr/bin/env bash
#
# one-hop-guard.sh — sourced by winner-gate.sh. Not a program: it defines two lists
# and four shell functions, and nothing here starts node, ts-node or a database.
#
# THE HOLE THIS CLOSES (2026-09-02). RETRIEVAL_PATHS names the three files that
# PRODUCE the frozen pool — gather-candidates.ts, openfoodfacts/search.ts and
# fatsecret-lane.ts — and a path list is blind ONE IMPORT HOP away from them:
# gather-candidates.ts imports detectGrainCookingContext() from filter-candidates.ts,
# a file on none of the four path lists, and calls it at ONE gather site
# (gatherCandidates) and one gate site (confidenceGate) [MEASURED: `grep -n
# detectGrainCookingContext src/lib/mapping/gather-candidates.ts` -> the import plus
# two call lines, whose enclosing declarations are those two functions; 2026-09-03].
# Only the gather site is on the frozen side; the gate site is code winner-diff runs
# live. Edit that one function and the pool moves while the gate exits 0 with a clean
# frozen-pool receipt — the llm-output-guards.ts shape (FROZEN_INPUT, 2026-08-15), one
# file over.
#
# THE MEMBERSHIP RULE, four clauses:
#   (1) the symbol is imported by one of the three producers [MEASURED: `grep -nE
#       "^import|^} from" src/lib/mapping/gather-candidates.ts
#       src/lib/openfoodfacts/search.ts src/lib/mapping/fatsecret-lane.ts`, minus every
#       specifier RETRIEVAL_PATHS or FROZEN_INPUT_PATHS already matches; 2026-09-02];
#   (2) the file is NOT itself on a path list, so its other symbols stay gateable;
#   (3) the symbol's code is what the gating host actually runs — its reach from the
#       producer is on the POOL side of the freeze, not inside a function the replay
#       executes live, and its value is not owned by an env line [REASONING per symbol,
#       from the call sites; the env half re-derived with `grep -cE "^NAME=" .env`];
#   (4) REFERENCE CLOSURE, added 2026-09-03 and the reason this list grew from 6 to 15.
#       symbol_region compares a declaration's OWN text, so a listed function that
#       reads a module-level table of the same file is guarded on half its behaviour:
#       the table moves, the function's region does not, and the gate exits 0. So every
#       top-level declaration of the same file that a listed region REFERENCES is
#       itself listed, to a fixpoint. MEASURED WITNESS: adding `'bulgur'` to
#       VOLUME_COOKED_GRAINS flips detectGrainCookingContext('1 cup bulgur','bulgur')
#       from preferDry to softCooked — the branch that appends the "cooked <name>" FDC
#       search in gatherCandidates() — while the six-entry list read UNCHANGED.
#       winner-diff.test.ts recomputes the closure from the tree and fails if it is not
#       a subset of this list, so a new reference cannot be added silently.
#
#   filter-candidates.ts:detectGrainCookingContext  .softCooked adds the "cooked <name>"
#                          FDC search and picks the OFF query in gatherCandidates().
#                          Its second site is inside confidenceGate(), which the replay
#                          runs — that observes the gate half, never the gather half.
#     + its tables, clause (4): FOODS_WITH_COOKING_STATE (is this a grain at all),
#       VOLUME_COOKED_GRAINS (which grains take the cooked basis), COOKED_VOLUME_UNIT_RE
#       (which units say "eaten portion"), GRAIN_DRY_SIGNAL_RE (which tokens pin dry).
#       All four decide softCooked; none is reachable from the function's own text.
#   count-label.ts:countedPieceNoun                 sets countedPieceQuery, which appends
#                          the searchOffCountLabeled() side-query to the OFF pool.
#     + its closure, clause (4): countedPieceNoun is a three-line wrapper — the whole
#       decision is pieceNounInName(), which reads LABEL_COUNT_PIECE_NOUNS through
#       singularizeUnit(). Listing only the wrapper guards the qty>=2 gate and nothing
#       else.
#   corrupt-mark.ts:isCorruptExclusionEnabled       decides `corruptReason: null` on the
#                          OFF Prisma fallback (the Typesense-down path). It reads
#                          CORRUPT_RECORD_EXCLUSION; no Mac .env sets it, so the code
#                          default is the live value HERE — see DELIBERATELY NOT LISTED
#                          for why that is a Mac-only measurement. Closure: empty.
#   units/density.ts:inferCategoryFromName, categoryDensity,
#   DRY_GRANULE_DENSITY_CATEGORIES                   servingGramsOf() in the FS lane turns
#                          an ml serving into grams, and derivePer100gFromServings()
#                          builds the candidate's per-100g basis from that — snapshot
#                          DATA both sides then replay. The serving stage also runs
#                          density.ts live, which observes that stage and not the lane.
#     + their tables, clause (4): CATEGORY_KEYWORDS is the whole of inferCategoryFromName
#       and CATEGORY_DENSITY_GML is the whole of categoryDensity — the functions are
#       lookups over them. DRY_GRANULE_DENSITY_CATEGORIES is already a table and has an
#       empty closure.
#
# DELIBERATELY NOT LISTED, each with its reason, so nobody re-derives and adds it:
#   declined-confidence.ts:RERANK_DECLINED_CONFIDENCE  imported by gather-candidates.ts,
#                          but its only use there is inside confidenceGate(), which
#                          winner-diff.ts requires LIVE from each tree (it requires the
#                          constant itself, too). The diff SEES a change to it; listing
#                          it would be the #311 false abort. winner-diff.test.ts pins
#                          both halves.
#   ./config (six FS constants)  env-value readers. THE ENV HALF OF THIS REASONING IS
#                          MAC-MEASURED ONLY (`grep -cE "^NAME=" .env` on this laptop,
#                          2026-09-02; the box was unreachable, "Host is down", and its
#                          .env is UNVERIFIED — .env is Syncthing-ignored in this repo,
#                          so machine values genuinely differ). Read every "is set" /
#                          "no .env sets it" here as "on the Mac". Known counter-example:
#                          `.env.example` ships CORRUPT_RECORD_EXCLUSION=1, so a fresh
#                          checkout that copies it does NOT run the code default; and
#                          per the mobile CLAUDE.md the Windows PC lacks
#                          FATSECRET_RETRIEVAL_ENABLED. On the Mac:
#                          FATSECRET_RETRIEVAL_ENABLED is set; LANE_TIMEOUT_MS truncates
#                          the lane nondeterministically (already retrieval noise); the
#                          credentials shape nothing. LANE_MAX_RESULTS is the one whose
#                          default is live — a one-token widening if re-decided, not
#                          added here on the brief's infrastructure call.
#   ./client               FatSecretClient is the FatSecret HTTP wrapper: a `class`, which
#                          symbol_region does not parse, and what it returns is the remote
#                          API's answer. FatSecretFoodSummary and FatSecretServing are
#                          TYPES from the same file, erased before anything runs.
#   ./deferred-hydration   registerBackgroundTask() is persistence bookkeeping after the
#                          hits exist.   ../db, ../logger   transport and logging.
#   ../search/*, *embedding*             already RETRIEVAL_PATHS by path.
#   ../parse/ingredient-line, ./normalization-rules   already FROZEN_INPUT_PATHS.
#
# THAT SECTION IS AN ALLOWLIST, NOT PROSE. winner-diff.test.ts re-derives clause (1) from
# the three importers and requires every named import landing on a file neither path list
# covers to be LISTED here or named in that test's NOT_LISTED map — 19 such imports on
# this tree, 6 listed and 13 excluded (measured 2026-09-03). Before that census existed
# the list was pinned only in the list -> reach direction, and dropping the four
# count-label.ts entries — the guard's entire measured firing population, commit da6d7a5 —
# failed nothing.
#
# STILL BLIND, and stated so nobody reads this guard as complete: TWO HOPS. Clause (1)
# is the symbols the three producers import DIRECTLY. A symbol that a listed file
# imports from a THIRD file is not checked, and neither is anything the producers reach
# through a file that happens to sit on a path list for an unrelated reason — today
# every two-hop import of a listed file lands on a path list by ACCIDENT, not by rule.
# The live example: client.ts's normalizeFoods() shapes every FatSecret candidate and is
# examined by nothing. Closing that needs an import-graph walk, i.e. a node process,
# which is exactly what this text-level guard is built to run before.
#
# WHY SYMBOLS AND NOT FILES: 8 of the last 20 commits touching src/lib/mapping,
# src/lib/units or src/lib/openfoodfacts edit a listed FILE and 0 of the 20 change a
# listed SYMBOL's region; over the last 100 such commits it is 15 and 1 (the one is
# da6d7a5, "narrow the count_label escape — qty >= 2 gate", which moved countedPieceNoun
# and pieceNounInName — a real pool-moving change and exactly what this guard is for).
# Re-derive: `git log --format=%h -20 -- src/lib/mapping src/lib/units
# src/lib/openfoodfacts`, then per commit `git diff-tree --no-commit-id --name-only -r
# <c> -- <the listed files>` for the first count, and `symbol_region` over
# `git show <c>^:<file>` vs `git show <c>:<file>` for the second. Measured 2026-09-03 on
# 56af853 over the FIFTEEN-entry list; the older figure (10 of 20) used a
# `-- src/lib/mapping` window that could not see src/lib/units/density.ts or
# src/lib/openfoodfacts at all.
#   TRAP found re-running it: e4a3eeb (2026-08-25) and ff5aa00 (08-19) were cited as
#   evidence that these tables move often. They do not, at symbol level — e4a3eeb is a
#   whole-file CRLF rewrite (3,183 insertions / 3,148 deletions on one file) that
#   symbol_region reads as SAME because it strips CR, and ff5aa00 changed count-label.ts
#   without touching any listed region. A raw `git show` diff is not a symbol census.
#
# ONE LINE EACH, on purpose: winner-diff.test.ts reads these assignments out of this
# file the way it reads the path lists out of winner-gate.sh.
ONE_HOP_SYMBOLS='src/lib/mapping/filter-candidates.ts:detectGrainCookingContext src/lib/mapping/filter-candidates.ts:FOODS_WITH_COOKING_STATE src/lib/mapping/filter-candidates.ts:VOLUME_COOKED_GRAINS src/lib/mapping/filter-candidates.ts:COOKED_VOLUME_UNIT_RE src/lib/mapping/filter-candidates.ts:GRAIN_DRY_SIGNAL_RE src/lib/mapping/count-label.ts:countedPieceNoun src/lib/mapping/count-label.ts:pieceNounInName src/lib/mapping/count-label.ts:singularizeUnit src/lib/mapping/count-label.ts:LABEL_COUNT_PIECE_NOUNS src/lib/mapping/corrupt-mark.ts:isCorruptExclusionEnabled src/lib/units/density.ts:inferCategoryFromName src/lib/units/density.ts:CATEGORY_KEYWORDS src/lib/units/density.ts:categoryDensity src/lib/units/density.ts:CATEGORY_DENSITY_GML src/lib/units/density.ts:DRY_GRANULE_DENSITY_CATEGORIES'
ONE_HOP_IMPORTERS='src/lib/mapping/gather-candidates.ts src/lib/openfoodfacts/search.ts src/lib/mapping/fatsecret-lane.ts'

# symbol_region <file|-> <symbol>
# Prints the source region of a top-level `[export ][async ]function NAME(` or
# `[export ]const NAME` declaration: the declaration line alone when it ends the
# statement (`;` or `}` on that line), otherwise through the first later line that is
# a closing bracket at column 0. Text-level on purpose — it runs before any node
# process exists. `-` reads stdin. CR is stripped so a CRLF checkout compares equal
# to its LF `git show`.
symbol_region() {
    awk -v sym="$2" '
        { sub(/\r$/, "") }
        !inside {
            if ($0 ~ ("^(export )?(async )?function " sym "[ (<]") || $0 ~ ("^(export )?const " sym "[ :=]")) {
                print
                if ($0 ~ /[;}][ \t]*$/) exit
                inside = 1
            }
            next
        }
        { print; if ($0 ~ /^(\}|\};|\]\);|\];|\);)[ \t]*$/) exit }
    ' "$1"
}

# one_hop_symbol_changed <base-ref> <file> <symbol>
# 0 (changed) when the symbol's region differs between `git show <base-ref>:<file>`
# and the WORKING file — the gate's BRANCH side is the working tree. A file absent on
# either side counts as changed. THE REF ARGUMENT IS LOAD-BEARING: winner-gate.sh calls
# this twice per hit, once at $BASE_REF's tip and once at the merge base, and the pair
# is what tells a branch's own edit from one it is merely behind. An implementation
# that ignored it and read HEAD would be silent on every COMMITTED edit — the normal
# state a branch is gated in. winner-diff.test.ts runs the real gate on a committed
# edit for exactly that reason.
one_hop_symbol_changed() {
    local base_ref="$1" file="$2" sym="$3" before after
    [[ -f "$file" ]] || return 0
    git cat-file -e "$base_ref:$file" 2>/dev/null || return 0
    before="$(git show "$base_ref:$file" | symbol_region - "$sym")"
    after="$(symbol_region "$file" "$sym")"
    [[ "$before" != "$after" ]]
}

# one_hop_importer <symbol> — which producer imports it, for the abort message.
# Derived from the tree at abort time, never restated. Always exits 0. EMPTY for a
# module-level table: a table is reached through a listed function, not imported.
one_hop_importer() {
    local hits
    hits="$(grep -lE "^import .*[^A-Za-z0-9_]$1[^A-Za-z0-9_]|^[ \t]*$1,?[ \t]*$" $ONE_HOP_IMPORTERS 2>/dev/null || true)"
    printf '%s' "$hits" | tr '\n' ' '
}

# one_hop_reach <file> <symbol> — the parenthetical the abort prints after a hit, so a
# reader is told WHY this symbol is guarded. A directly imported symbol names its
# producer; a clause-(4) table names the listed declarations of its own file that read
# it. Derived from the tree at abort time, never restated. Always exits 0.
one_hop_reach() {
    local file="$1" sym="$2" direct="" via="" e f s
    direct="$(one_hop_importer "$sym")"
    if [[ -n "${direct// /}" ]]; then
        printf 'imported by %s' "${direct% }"
        return 0
    fi
    # An absent file has no regions to read, so the loop below would report "nothing
    # listed" and send the reader hunting a closure that cannot exist. Name the real
    # cause instead: this is the rename/delete path the membership seat now lets through.
    if [[ ! -f "$file" ]]; then
        printf 'file ABSENT from the working tree — renamed or deleted'
        return 0
    fi
    for e in $ONE_HOP_SYMBOLS; do
        f="${e%%:*}"; s="${e#*:}"
        [[ "$f" == "$file" && "$s" != "$sym" ]] || continue
        if symbol_region "$f" "$s" 2>/dev/null \
            | grep -qE '(^|[^A-Za-z0-9_.])'"$sym"'([^A-Za-z0-9_]|$)'; then
            via="$via $s"
        fi
    done
    printf 'read by%s' "${via:- nothing listed — re-derive the closure}"
}
