#!/usr/bin/env bash
#
# one-hop-guard.sh — sourced by winner-gate.sh. Not a program: it defines one list
# and three shell functions, and nothing here starts node, ts-node or a database.
#
# THE HOLE THIS CLOSES (2026-09-02). RETRIEVAL_PATHS names the three files that
# PRODUCE the frozen pool — gather-candidates.ts, openfoodfacts/search.ts and
# fatsecret-lane.ts — and a path list is blind ONE IMPORT HOP away from them:
# gather-candidates.ts imports detectGrainCookingContext() from filter-candidates.ts,
# a file on none of the four path lists, and calls it at two gather sites. Edit that
# one function and the pool moves while the gate exits 0 with a clean frozen-pool
# receipt — the llm-output-guards.ts shape (FROZEN_INPUT, 2026-08-15), one file over.
#
# THE MEMBERSHIP RULE, three clauses:
#   (1) the symbol is imported by one of the three producers [MEASURED: `grep -nE
#       "^import|^} from" src/lib/mapping/gather-candidates.ts
#       src/lib/openfoodfacts/search.ts src/lib/mapping/fatsecret-lane.ts`, minus every
#       specifier RETRIEVAL_PATHS or FROZEN_INPUT_PATHS already matches; 2026-09-02];
#   (2) the file is NOT itself on a path list, so its other symbols stay gateable;
#   (3) the symbol's code is what the gating host actually runs — its reach from the
#       producer is on the POOL side of the freeze, not inside a function the replay
#       executes live, and its value is not owned by an env line [REASONING per symbol,
#       from the call sites; the env half re-derived with `grep -cE "^NAME=" .env`].
#   filter-candidates.ts:detectGrainCookingContext  .softCooked adds the "cooked <name>"
#                          FDC search and picks the OFF query in gatherCandidates().
#                          Its second site is inside confidenceGate(), which the replay
#                          runs — that observes the gate half, never the gather half.
#   count-label.ts:countedPieceNoun                 sets countedPieceQuery, which appends
#                          the searchOffCountLabeled() side-query to the OFF pool.
#   corrupt-mark.ts:isCorruptExclusionEnabled       decides `corruptReason: null` on the
#                          OFF Prisma fallback (the Typesense-down path). It reads
#                          CORRUPT_RECORD_EXCLUSION, which no .env sets, so the code
#                          default IS the live value.
#   units/density.ts:inferCategoryFromName, categoryDensity,
#   DRY_GRANULE_DENSITY_CATEGORIES                   servingGramsOf() in the FS lane turns
#                          an ml serving into grams, and derivePer100gFromServings()
#                          builds the candidate's per-100g basis from that — snapshot
#                          DATA both sides then replay. The serving stage also runs
#                          density.ts live, which observes that stage and not the lane.
#
# DELIBERATELY NOT LISTED, each with its reason, so nobody re-derives and adds it:
#   declined-confidence.ts:RERANK_DECLINED_CONFIDENCE  imported by gather-candidates.ts,
#                          but its only use there is inside confidenceGate(), which
#                          winner-diff.ts requires LIVE from each tree (it requires the
#                          constant itself, too). The diff SEES a change to it; listing
#                          it would be the #311 false abort. winner-diff.test.ts pins
#                          both halves.
#   ./config (six FS constants)  env-value readers. FATSECRET_RETRIEVAL_ENABLED is set
#                          in every gating .env; LANE_TIMEOUT_MS truncates the lane
#                          nondeterministically (already retrieval noise); the credentials
#                          shape nothing. LANE_MAX_RESULTS is the one whose default is
#                          live (unset in .env, 2026-09-02) — a one-token widening if
#                          re-decided, not added here on the brief's infrastructure call.
#   ./client               the FatSecret HTTP wrapper: a `class`, which symbol_region does
#                          not parse, and what it returns is the remote API's answer.
#   ./deferred-hydration   registerBackgroundTask() is persistence bookkeeping after the
#                          hits exist.   ../db, ../logger   transport and logging.
#   ../search/*, *embedding*             already RETRIEVAL_PATHS by path.
#   ../parse/ingredient-line, ./normalization-rules   already FROZEN_INPUT_PATHS.
#
# WHY SYMBOLS AND NOT FILES: 10 of the last 20 commits touching src/lib/mapping edit
# filter-candidates.ts and 0 of the 20 edit a listed symbol (re-derive: the two loops
# in the PR that added this file; measured 2026-09-02 on d57d832).
#
# ONE LINE EACH, on purpose: winner-diff.test.ts reads these assignments out of this
# file the way it reads the path lists out of winner-gate.sh.
ONE_HOP_SYMBOLS='src/lib/mapping/filter-candidates.ts:detectGrainCookingContext src/lib/mapping/count-label.ts:countedPieceNoun src/lib/mapping/corrupt-mark.ts:isCorruptExclusionEnabled src/lib/units/density.ts:inferCategoryFromName src/lib/units/density.ts:categoryDensity src/lib/units/density.ts:DRY_GRANULE_DENSITY_CATEGORIES'
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
# either side counts as changed.
one_hop_symbol_changed() {
    local base_ref="$1" file="$2" sym="$3" before after
    [[ -f "$file" ]] || return 0
    git cat-file -e "$base_ref:$file" 2>/dev/null || return 0
    before="$(git show "$base_ref:$file" | symbol_region - "$sym")"
    after="$(symbol_region "$file" "$sym")"
    [[ "$before" != "$after" ]]
}

# one_hop_importer <symbol> — which producer imports it, for the abort message.
# Derived from the tree at abort time, never restated. Always exits 0.
one_hop_importer() {
    local hits
    hits="$(grep -lE "^import .*[^A-Za-z0-9_]$1[^A-Za-z0-9_]|^[ \t]*$1,?[ \t]*$" $ONE_HOP_IMPORTERS 2>/dev/null || true)"
    printf '%s' "$hits" | tr '\n' ' '
}
