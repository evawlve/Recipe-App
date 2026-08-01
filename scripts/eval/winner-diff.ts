/**
 * winner-diff.ts — FROZEN-POOL WINNER-DIFF HARNESS
 * ==========================================================================
 * The gate `sync-docs/mapping_investigation_playbook.md` demands before any
 * admission or ranking change may be called safe:
 *
 *   > Any change to admission requires a before/after diff of the pipeline's
 *   > WINNER over the affected population. Not a set-membership Jaccard on
 *   > `r.filtered` — that is the measurement that makes this bug invisible.
 *
 * A pool comparison is broken because FOUR downstream consumers are NON-MONOTONE
 * in candidate-pool size, so a change that only ADDS candidates can still flip the
 * answer ("admit-only by inspection is not a safety argument" — burned this project
 * three separate times):
 *   1. map-ingredient-with-fallback.ts:1660  `filtered.slice(0, 10)` truncates over
 *      GATHER order, not score order. A new admit EVICTS a candidate that reaches
 *      the reranker today.
 *   2. map-ingredient-with-fallback.ts:1598-1616  relaxed recovery fires ONLY when
 *      `filtered.length === 0`, and its output is a strict SUPERSET. Admitting one
 *      candidate SUPPRESSES the retry and swaps a superset for a subset.
 *   3. gather-candidates.ts:591-607  `basic_produce_bypass` returns `candidates[0]`
 *      with skipAiRerank — a new higher-score record wins with NO rerank at all.
 *   4. simple-rerank.ts:1883  brand macro-consensus median over siblings, gated
 *      `siblings.length >= 3` — a longer sibling list moves the median and flips
 *      the penalty.
 *
 * ==========================================================================
 * STRICTLY READ-ONLY  (this is a promise, and it is enforced in code)
 * ==========================================================================
 * This script NEVER writes to FoodMapping or any other table. A Prisma `$use`
 * middleware (`installWriteGuard`) intercepts every mutating operation
 * (create/createMany/update/updateMany/upsert/delete/deleteMany/executeRaw/
 * executeRawUnsafe) and NO-OPS it, tallying model+action into `suppressedWrites`,
 * which is printed. Nothing here calls warm-cache, saveValidatedMapping, or any
 * repoint/evict path. `snapshot` additionally ABORTS the mapper at gather, so the
 * save path is not merely guarded — it is never reached.
 *
 * The guard NO-OPs rather than THROWS on purpose. `getAiNormalizeCache`
 * (validated-mapping-helpers.ts:978) bumps `useCount` with an `update` INSIDE the
 * same try/catch that returns the cached row, so a throwing guard converts a genuine
 * cache HIT into a `null` MISS and silently deletes `aiNutritionEstimate` and
 * `isBrandedQuery` from the snapshot.
 *
 * ==========================================================================
 * MODES
 * ==========================================================================
 *   snapshot        Run the REAL mapper up to and including gatherCandidates,
 *                   freeze the gather output + every Step-3 input to disk, then
 *                   abort. Retrieval runs ONCE, so every later replay compares
 *                   selection logic against an IDENTICAL pool and retrieval
 *                   nondeterminism cannot contaminate the diff.
 *   replay          Re-run the Step-3 -> winner chain of the CURRENT tree against
 *                   a frozen snapshot. Deterministic: no network, no LLM, one
 *                   batched read.
 *   noise-floor     Replay the SAME variant on the SAME snapshot TWICE and assert
 *                   0 winner differences. Writes a receipt that `diff` requires.
 *   diff            Classify replay A vs replay B per query and report WINNER
 *                   changes (plus the screens).
 *   counterfactual  One replay, no B tree: for every confidenceGate early exit,
 *                   what would simpleRerank have picked on the identical pool?
 *   verify          The only mode that PROVES the transcription below is faithful:
 *                   runs the real mapper end to end and compares foodId.
 *   transcript      Print the real caller slice next to this file's transcription.
 *   hashes          Print the drift hashes.
 *   help
 *
 * ==========================================================================
 * WHAT THIS HARNESS STRUCTURALLY CANNOT SEE — do not soften these
 * ==========================================================================
 * (A) RETRIEVAL. The pool is frozen at gatherCandidates' output. Any change to
 *     gather-candidates.ts, query-builder.ts, Typesense querying/indexing, the
 *     FatSecret lane or embeddings INVALIDATES the diff entirely — both variants
 *     replay a pool neither would have produced. Re-snapshot per version for those,
 *     and accept that retrieval nondeterminism is then inside your signal.
 * (B) EVERYTHING AFTER WINNER SELECTION. The mapper is aborted at gather, so
 *     hydration, serving/gram resolution, AI backfill, the save-time plausibility
 *     gate, the brand-mismatch gate and the FoodMapping write never run. A
 *     WINNER-CHANGED here may be discarded by a save gate; a SAME here does NOT
 *     prove the cached row is identical.
 * (C) WARM BEHAVIOUR. `skipCache: true` is forced, so this measures COLD resolution
 *     only. A change that looks harmless cold still POISONS the cache the moment
 *     those keys are re-warmed.
 * (D) CASES THE CHANGE IS SUPPOSED TO CREATE. --from-events and --from-cache
 *     contain only queries ALREADY ASKED. A change whose whole point is to make a
 *     currently-failing or never-attempted query succeed shows SAME on 100% of
 *     rows, because the query that would prove it is not in the population. That
 *     blind spot has invalidated a gate before. Pair every diff with a hand-written
 *     positive case list asserting the RIGHT answer.
 * (E) POPULATION CONTAMINATION. cache-parity-sweep.ts posts `100g <token-sorted
 *     FoodMapping key>` into MappingEventLog, so roughly a third of the event log
 *     is our own warmer. Rows are tagged `origin` and the split is printed.
 * (F) SUPPRESSED WRITES CHANGE FUTURE RUNS, NOT THIS ONE. persistFatSecretHits,
 *     saveAiNormalizeCache and learnedSynonym upserts are no-ops here; in
 *     production those rows would exist for the NEXT query to hydrate from. It is
 *     also why SNAPSHOTTING IS NOT REPRODUCIBLE (an uncached query re-hits the
 *     LLM every snapshot run) — which is precisely why the snapshot is taken once
 *     and shared by both sides.
 *
 * ==========================================================================
 * USAGE — always from a backend repo root, with ts-node (never tsx)
 * ==========================================================================
 *   RUN='npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/eval/winner-diff.ts'
 *
 *   $RUN snapshot --from-events --limit 400 --out /tmp/wd-snap.json
 *   $RUN noise-floor --snapshot /tmp/wd-snap.json                    # MUST be 0
 *   $RUN replay --snapshot /tmp/wd-snap.json --out /tmp/wd-A.json --label BASE
 *   # copy the tree, edit the copy, run the same command from there:
 *   $RUN replay --snapshot /tmp/wd-snap.json --out /tmp/wd-B.json --label BRANCH
 *   $RUN diff --a /tmp/wd-A.json --b /tmp/wd-B.json --screens
 *
 *   Prefer scripts/eval/winner-gate.sh, which runs all of the above in one command.
 *
 * --with-serving  (add to BOTH replays AND the noise-floor run)
 *   Runs the real serving layer for every row that has a winner and records the
 *   grams / tier / kcal the user would be billed. Without it this harness stops at
 *   winner selection — limit (B) below — and a change can move the winner onto the
 *   CORRECT record while making the billed number worse. That is not hypothetical:
 *   PR #173 did exactly that (mac and cheese, 90.4 -> 39.5 kcal against a true
 *   ~400) and passed a green winner gate. Any change that could touch grams must
 *   be gated with this flag.
 *
 * NEVER switch variants with `git checkout <sha> -- <file>`. That is how
 * uncommitted work gets destroyed. Copy the tree and edit the copy.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

import {
    ReplayFile,
    ReplayRow,
    SelectionPath,
    WinnerInfo,
    GoldenCase,
    NoiseFloorLedger,
    NoiseFloorReceipt,
    PopulationLine,
    QueryOrigin,
    ScreenPair,
    ServingInfo,
    Verdict,
    VERDICTS,
    classifyOrigin,
    classifyServing,
    classifyVerdict,
    counterfactualSummary,
    emptyLedger,
    formatScreens,
    formatServingSummary,
    gateReasonHistogram,
    kcalDeltaPct,
    noiseGate,
    summariseServing,
    originSplit,
    parseGoldenSet,
    parseQueryFile,
    pathHistogram,
    rowHasMovement,
    runScreens,
    windowChurn,
    windowChurnIsMeaningless,
    runGoldenScreen,
    formatGoldenScreen,
} from './winner-diff-screens';

// ============================================================
// 0. env — load the machine .env, then FORCE production flags
//    (before ANY src/lib require: config.ts snapshots flags at module load)
// ============================================================

const REPO_ROOT = process.cwd();

function loadDotEnv(): string[] {
    const tried: string[] = [];
    const candidates = [
        process.env.WINNER_DIFF_ENV_FILE,
        path.join(REPO_ROOT, '.env'),
        path.join(REPO_ROOT, '.env.local'),
        '/Users/diego/Documents/Github/Recipe App/Recipe-App/.env',
    ].filter(Boolean) as string[];
    for (const f of candidates) {
        tried.push(f);
        if (!fs.existsSync(f)) continue;
        const txt = fs.readFileSync(f, 'utf8');
        for (const line of txt.split('\n')) {
            const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
            if (!m) continue;
            let v = m[2].trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
                v = v.slice(1, -1);
            }
            if (process.env[m[1]] === undefined) process.env[m[1]] = v;
        }
        return [f];
    }
    return tried;
}

const ENV_FILES = loadDotEnv();

/**
 * Production parity (box /home/owner/Recipe-App/.env). Dev .env files predate the
 * FatSecret lane; without the force the whole fs lane returns [] and the snapshot
 * pool is silently wrong — a diff over a pool production would never see.
 */
const FORCED_FLAGS: Record<string, string> = {
    FATSECRET_RETRIEVAL_ENABLED: '1',
    OFF_ENABLED: 'true',
    SEARCH_PROVIDER: 'typesense',
    SEMANTIC_SEARCH_ENABLED: 'true',
    EVAL_MODE: 'fatsecret',
    OLLAMA_ENABLED: 'false',
};
for (const [k, v] of Object.entries(FORCED_FLAGS)) process.env[k] = v;

// ============================================================
// 1. stdout muzzle (the Prisma client is constructed with log:['query',...])
// ============================================================

const REAL_STDOUT = process.stdout.write.bind(process.stdout);
const REAL_STDERR = process.stderr.write.bind(process.stderr);
let muzzled = false;
function muzzle(on: boolean) {
    if (process.argv.includes('--verbose')) return;
    if (on && !muzzled) {
        (process.stdout as any).write = () => true;
        (process.stderr as any).write = () => true;
        muzzled = true;
    } else if (!on && muzzled) {
        (process.stdout as any).write = REAL_STDOUT;
        (process.stderr as any).write = REAL_STDERR;
        muzzled = false;
    }
}
function say(s = '') { REAL_STDOUT(s + '\n'); }
function sayAll(lines: string[]) { for (const l of lines) say(l); }

// ============================================================
// 2. DRIFT GUARD
//    A change DETECTOR, not a correctness proof. It says "the source did not
//    move"; it says nothing about whether the transcription was ever right.
//    Only `verify` mode tests faithfulness.
//
//    LINE-ENDING SENSITIVE. The hash is computed over
//    fs.readFileSync(f,'utf8').split('\n') — reading the same file with a reader
//    that performs universal-newline translation (e.g. Python's open()) produces a
//    DIFFERENT hash and a false DRIFT. If you are about to "fix" a drift, first
//    reproduce the hash with this exact reader.
// ============================================================

const MAPPER_FILE = path.join(REPO_ROOT, 'src/lib/mapping/map-ingredient-with-fallback.ts');

const CALLER_START_ANCHOR = '// Step 3: Apply must-have token filter';
const CALLER_END_ANCHOR = "selectionReason = 'scored_by_confidence';";

function callerBlockSource(): { text: string; startLine: number; endLine: number; lines: string[] } {
    const src = fs.readFileSync(MAPPER_FILE, 'utf8').split('\n');
    const start = src.findIndex(l => l.includes(CALLER_START_ANCHOR));
    const end = src.findIndex(l => l.includes(CALLER_END_ANCHOR));
    if (start < 0 || end < 0 || end <= start) {
        throw new Error('drift-guard: could not locate the Step-3 caller block anchors in ' + MAPPER_FILE);
    }
    const lines = src.slice(start, end + 1);
    return { text: lines.join('\n'), startLine: start + 1, endLine: end + 1, lines };
}

/** The caller-local, NON-EXPORTED helpers copied verbatim into section 4. */
const COPIED_HELPERS = [
    'function candidateHasCountLabel(',
    'function requestBillsByServing(',
    'function candidateHasServingData(',
    'function isMatchableVolumeUnit(',
    'function servingLeadingCount(',
];
function copiedHelperSource(): string {
    const src = fs.readFileSync(MAPPER_FILE, 'utf8').split('\n');
    const out: string[] = [];
    for (const anchor of COPIED_HELPERS) {
        const i = src.findIndex(l => l.trimStart().startsWith(anchor));
        if (i < 0) throw new Error('drift-guard: helper not found: ' + anchor);
        let j = i;
        while (j < src.length && src[j] !== '}') j++;
        out.push(src.slice(i, j + 1).join('\n'));
    }
    return out.join('\n---\n');
}

function sha(s: string) { return createHash('sha256').update(s).digest('hex').slice(0, 16); }

/**
 * EVERY caller-block shape this file knows how to transcribe, mapped to the
 * `--variant` that reproduces it. A hash outside this table means the caller has
 * moved to a shape section 9 has never seen.
 *
 *   3a20888d65bd8cbd  master 874f786, lines 1485-1768. confidenceGate PRE-EMPTS
 *                     Step 4: `if (skipAiRerank && selected) { winner = selected }
 *                     else { ...rerank... }`.
 *   5190a9ae93dbf642  the gate demotion, lines 1485-1884. Step 4 always runs;
 *                     `gateSelection` is consulted only when simpleRerank named
 *                     nobody, ahead of the 0.80 raw-score grab. SUPERSEDED by
 *                     349af8359fd7b90b — kept so an older tree still resolves, but a
 *                     tree on this hash is missing both mitigations below.
 *   349af8359fd7b90b  the gate demotion PLUS the two review mitigations, lines
 *                     1485-1955. Same shape as 5190a9ae93dbf642 plus:
 *                     (A) `gateSelection` appended to `candidatesForRerank` when
 *                         absent, so the gate's pick competed even from past the
 *                         `filtered.slice(0,10)` gather-order cutoff.
 *                     (B) when the reranker re-selects the gate's own record,
 *                         `confidence` becomes `Math.max(rerank, gate)` — UNSCOPED,
 *                         i.e. on any gate exit reason.
 *                     SUPERSEDED by 4ea700da8becee0c: a second review measured both
 *                     and reverted (A) outright and scoped (B). Kept so an older tree
 *                     still resolves, but section 9 NO LONGER TRANSCRIBES THIS SHAPE.
 *   4ea700da8becee0c  CURRENT, lines 1485-1987. 349af835 with (A) REVERTED and (B)
 *                     SCOPED. Concretely:
 *                     (A) REVERTED — caller 1746-1778 is now a comment where the push
 *                         used to be. Measured against the project's own adjudication
 *                         of all 296 disagreements, the push restored 5 of the 17
 *                         past-index-10 gate picks, 2 of them adjudicated
 *                         rerank-BETTER, so the regression count did not improve — it
 *                         only moved which rows were wrong. With (B) it also took
 *                         `buffalo wild wings boneless wings` from 0.710 (below the
 *                         0.75 sub-threshold floor, so uncached) to 1.000, a
 *                         displacing upsert of an adjudicated-WRONG record; and it
 *                         flattered its own measurement, since a restored row scores
 *                         SAME and drops out of the screen population. The 17
 *                         deletions remain real and unfixed — they belong to
 *                         `slice(0,10)` over gather order, to be fixed there.
 *                     (B) KEPT but scoped to `gateResult.reason ===
 *                         'high_confidence_clear_winner'` (caller 1912-1918). The
 *                         gate's other two exits are not on the confidence scale at
 *                         all: `basic_produce_bypass` returns a CLAMPED RAW ENGINE
 *                         SCORE (saturates at 1.000 for any OFF candidate) and
 *                         `yeast_variant_preference` returns a hardcoded 0.95.
 *                         Unscoped, 27 of the 132 lifted rows were
 *                         basic_produce_bypass and 5 crossed the 0.85 save gate on a
 *                         saturated retrieval score.
 *                     Still gated on the gate having fired, so `--variant baseline`
 *                     remains byte-for-byte unaffected and pin 3a20888d65bd8cbd
 *                     stays valid.
 *                     NOTE, AND IT IS WHY `verify` GREW A SECOND AXIS: (B) moves no
 *                     foodId, and with (A) gone NOTHING that separates this caller
 *                     from the baseline moves a foodId on a row where the reranker
 *                     names someone. A foodId-only `verify` therefore could not fail
 *                     on this shape for ANY population — so `verify` now also
 *                     compares `confidence` on the rows whose foodId already agreed.
 *                     Measured: stubbing the scope out gives 27 CONF-UNEXPLAINED and
 *                     still 0 MISMATCH-UNEXPLAINED. See the RECEIPTS block in
 *                     section 9.
 *
 * WHY A TABLE AND NOT ONE PIN: it lets ONE tree replay BOTH shapes off ONE frozen
 * snapshot, which is what makes an A/B of a CALLER change possible at all without
 * copying trees or — never do this — `git checkout <sha> -- <file>`.
 *
 * THE CONSTRAINT THAT COMES WITH IT: a single-tree A/B via --variant is valid only
 * when the change is confined to the caller block. Everything else the replay uses
 * (simpleRerank, confidenceGate, the filters) is imported from THIS tree, so if the
 * change also touched an imported module, both "variants" run the new module and the
 * diff is confounded. `gitDirty` records the whole of src/lib/mapping so you can tell
 * — but it cannot tell you for you. Two trees, one snapshot, for those.
 *
 * IF A HASH IS NOT IN THIS TABLE: FIX THE TRANSCRIPTION in section 9 and add the new
 * hash with its variant. Do not just re-pin. Results from a drifted harness are not a
 * measurement of the pipeline.
 *
 * The hashes are LINE-ENDING SENSITIVE (see the section header). Reproduce with
 * `winner-diff hashes` before concluding anything drifted.
 */
const KNOWN_CALLERS: Record<string, SelectionVariant> = {
    // The pre-demotion shape. Still transcribed exactly, still the A-side of every
    // A/B of the demotion; nothing in either mitigation round touched it.
    '3a20888d65bd8cbd': 'baseline',
    // SUPERSEDED (shape 1 of 3 in the gate-backstop family). The demotion with NO
    // mitigations. Left in the table because it is a real shape a tree can still be
    // on, but it is the shape the first adversarial review found defective, and
    // section 9 no longer reproduces it.
    '5190a9ae93dbf642': 'gate-backstop',
    // SUPERSEDED (shape 2 of 3). The demotion + Mitigation A (gate pick appended to
    // the rerank window) + Mitigation B UNSCOPED. Pinned 2026-07-26 and abandoned the
    // same day: the second review measured A against the 296-row adjudication and
    // found it bought no regression reduction while turning one adjudicated-wrong
    // record into a CACHED one, and found B's other two gate exits return numbers
    // that are not confidences. Section 9 no longer reproduces this shape either.
    '349af8359fd7b90b': 'gate-backstop',
    // CURRENT — the shape section 9 actually transcribes. A reverted, B scoped to
    // `high_confidence_clear_winner`. Pinned only AFTER re-reading the caller and
    // re-running `transcript` + `verify` against it, and only after the verify was
    // shown capable of going RED on THIS shape (stub the B scope -> mismatches).
    // Receipts are in the section 9 RECEIPTS block; they are measurements, not
    // inherited from the 349af835 pin.
    '4ea700da8becee0c': 'gate-backstop',
    // CURRENT. Behaviourally IDENTICAL to 4ea700da — the only edits were comments,
    // correcting three false claims a review found in them (simpleRerank's confidence
    // range, "the gate handed back candidates[0]", and attributing every gate
    // confidence to assessConfidence). Proven comment-only by stripping comments and
    // blank lines from the whole file and diffing: 4,474 code lines on both sides,
    // identical. (Compare the WHOLE file, not the caller window — the window moves
    // when comments are added, and a windowed diff reports phantom tail hunks.)
    //
    // Re-pinned rather than left drifting because the guard hashes the block TEXT, so
    // it cannot tell a comment from a statement. That is the right conservative
    // default; the cost is that a documentation fix needs a re-pin plus a proof like
    // the one above. Do not skip the proof — "it was only comments" is exactly the
    // claim a hash exists to check.
    '3fc2ca073ff0f047': 'gate-backstop',
};
const PINNED_HELPERS_HASH = 'af86765a0a67abd6';

/**
 * The ONE caller hash section 9 actually transcribes.
 *
 * KNOWN_CALLERS maps hash -> variant NAME, and three distinct hashes now map to
 * 'gate-backstop'. Comparing NAMES to decide "does the replay mirror this tree?"
 * therefore green-lights two shapes the transcription no longer reproduces — the
 * drift guard's own failure mode, reintroduced one level up.
 *
 * This is not hypothetical in a repo Syncthing-mirrored across three machines whose
 * git histories routinely diverge. A tree still on 5190a9ae (the demotion with no
 * mitigations) would be told "MATCHES this tree's caller", and the replay would
 * apply Mitigation B on 141 rows that tree does not contain — reporting confidence
 * 1.000 where the tree actually ships <= 0.98. Since confidence is the
 * cache-admission signal, the resulting coverage delta is wrong in the FLATTERING
 * direction, which is the direction nobody double-checks.
 *
 * So fit is decided by hash. A superseded pin still suppresses the DRIFT banner
 * (that shape is genuinely known, and naming it is more useful than "unrecognised"),
 * but it can no longer claim the replay mirrors it.
 */
const TRANSCRIBED_CALLER = '3fc2ca073ff0f047';

interface DriftResult {
    caller: string;
    helpers: string;
    drifted: boolean;
    /** which --variant faithfully reproduces THIS tree's caller, if we recognise it */
    treeVariant: SelectionVariant | null;
}

function checkDrift(allowDrift: boolean): DriftResult {
    const cb = callerBlockSource();
    const callerHash = sha(cb.text);
    const helpersHash = sha(copiedHelperSource());
    const treeVariant = KNOWN_CALLERS[callerHash] ?? null;
    const drifted = treeVariant === null || PINNED_HELPERS_HASH !== helpersHash;
    if (drifted) {
        say('');
        say('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        say('!! DRIFT: this tree\'s caller block is a shape the harness has never seen.');
        say('!!   caller  actual=' + callerHash + '   known: ' +
            Object.entries(KNOWN_CALLERS).map(([h, v]) => `${h}=${v}`).join(', '));
        say('!!   helpers pinned=' + PINNED_HELPERS_HASH + '  actual=' + helpersHash);
        say('!! Re-transcribe replaySelection() from ' + MAPPER_FILE);
        say('!! lines ' + cb.startLine + '-' + cb.endLine + ', run `winner-diff verify`, THEN add the');
        say('!! new hash to KNOWN_CALLERS with the variant it corresponds to.');
        say('!! (Check the hash was not produced by a newline-translating reader first.)');
        say('!! Results from a drifted harness are NOT a measurement of the pipeline.');
        say('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        say('');
        if (!allowDrift) {
            throw new Error('drift-guard tripped; pass --allow-drift only after re-reading the caller.');
        }
    }
    return { caller: callerHash, helpers: helpersHash, drifted, treeVariant };
}

/**
 * Say out loud when the replayed variant is a MODEL of a caller this tree does not
 * contain. That is a legitimate and useful thing to do — it is how one tree produces
 * both sides of a caller-change A/B — but it is not the same claim as "I ran this
 * tree's code", and conflating the two is how a diff of nothing gets reported as a
 * diff of something.
 */
function announceVariantFit(drift: DriftResult, variant: SelectionVariant) {
    if (drift.treeVariant === null) {
        say(`variant=${variant}: this tree's caller is UNRECOGNISED, so nothing here is verified against it.`);
        return;
    }
    if (drift.treeVariant === variant && drift.caller !== TRANSCRIBED_CALLER) {
        // Right variant NAME, wrong SHAPE. The most dangerous case in this function:
        // without this branch it printed "MATCHES" and the caller believed the replay
        // was mirroring code that is not in the tree.
        say(`variant=${variant}: SUPERSEDED SHAPE. This tree's caller is ${drift.caller}, which is a`);
        say(`  recognised '${variant}' shape but NOT the one section 9 transcribes (${TRANSCRIBED_CALLER}).`);
        say('  The replay models the CURRENT transcription, not this tree. Any diff you take here is a');
        say('  measurement of the harness against a shape the tree does not contain — re-transcribe, or');
        say('  move the tree to the current shape, before quoting a number.');
        return;
    }
    if (drift.treeVariant === variant) {
        say(`variant=${variant}: MATCHES this tree's caller (${drift.caller}) — the replay mirrors the code actually present.`);
    } else {
        say(`variant=${variant}: MODELLED. This tree's caller is '${drift.treeVariant}' (${drift.caller}).`);
        say(`  The replay transcribes the '${variant}' shape while importing THIS tree's`);
        say('  simpleRerank/confidenceGate/filters. Valid for an A/B only while the change');
        say('  under test is confined to the caller block — check gitDirty if unsure.');
    }
}

// ============================================================
// 3. Real modules — required (not imported) so the FORCED_FLAGS above are already
//    in process.env when config.ts snapshots them.
// ============================================================

import type { ParsedIngredient } from '../../src/lib/parse/ingredient-line';
import type { UnifiedCandidate, GatherOptions } from '../../src/lib/mapping/gather-candidates';
import type { MappingTelemetry } from '../../src/lib/mapping/map-ingredient-with-fallback';

const dbMod = require('../../src/lib/db');
const prisma = dbMod.prisma;

const gatherMod = require('../../src/lib/mapping/gather-candidates');
const filterMod = require('../../src/lib/mapping/filter-candidates');
const rerankMod = require('../../src/lib/mapping/simple-rerank');
const mapperMod = require('../../src/lib/mapping/map-ingredient-with-fallback');
const countLabelMod = require('../../src/lib/mapping/count-label');
const plausibilityMod = require('../../src/lib/mapping/macro-plausibility');
const aiNormalizeMod = require('../../src/lib/mapping/ai-normalize');
const vmHelpersMod = require('../../src/lib/mapping/validated-mapping-helpers');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createAiNutritionBudget } = require('../../src/lib/mapping/ai-nutrition-backfill');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AI_NUTRITION_MAX_PER_BATCH } = require('../../src/lib/mapping/config');

// Everything below is IMPORTED FROM THE REAL MODULES, never reimplemented. A probe
// that reimplements the caller's argument list is a different function.
const { confidenceGate } = gatherMod;
const { filterCandidatesByTokens, hasCoreTokenMismatch, hasNullOrInvalidMacros, detectGrainCookingContext } = filterMod;
const { simpleRerank, toRerankCandidate, stripPrepModifiers } = rerankMod;
const {
    computeFloorHitIds, dropDenylistedCandidates, makeSortedFilteredComparator, candidateHasVolumeServing,
} = mapperMod;
/**
 * The whole serving layer behind one exported entry point. Used by the optional
 * --with-serving stage; it is the SAME function the route calls, not a transcription.
 */
const { hydrateAndSelectServing } = mapperMod;
const { countedPieceNoun, extractLabelServingUnit, GENERIC_PIECE_WORDS, servingLabelCountsPiece } = countLabelMod;
const { assessMacroPlausibility } = plausibilityMod;

// ============================================================
// 4. VERBATIM COPIES of caller-local helpers (drift-guarded above)
//    Source: map-ingredient-with-fallback.ts :4446, :4477, :4488, :4524, :4537
//    They are not exported, so they cannot be imported. Any edit to them upstream
//    moves PINNED_HELPERS_HASH and this harness refuses to run.
// ============================================================

function copy_servingLeadingCount(description: string): number {
    const frac = description.match(/^\s*(\d+)\s*\/\s*(\d+)/);
    if (frac) {
        const denom = parseFloat(frac[2]);
        return denom > 0 ? parseFloat(frac[1]) / denom : 1;
    }
    const m = description.match(/^\s*(\d+(?:\.\d+)?)/);
    if (!m) return 1;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) && n > 0 ? n : 1;
}

function copy_candidateHasCountLabel(candidate: UnifiedCandidate, pieceNoun: string): boolean {
    if (candidate.source === 'fatsecret') {
        return !!candidate.servings?.some((s: any) => {
            if (!(typeof s.grams === 'number' && s.grams > 0)) return false;
            const labelWord = extractLabelServingUnit(s.description);
            if (labelWord !== pieceNoun && !(labelWord && GENERIC_PIECE_WORDS.has(labelWord))) return false;
            const count = copy_servingLeadingCount(s.description);
            const perPiece = s.grams / (count > 0 ? count : 1);
            return perPiece >= 0.2 && perPiece <= 500;
        });
    }
    if (candidate.source !== 'openfoodfacts') return false;
    const raw = candidate.rawData as { servingSize?: string | null; servingGrams?: number | null } | undefined;
    return servingLabelCountsPiece(raw?.servingSize, raw?.servingGrams, pieceNoun);
}

const COPY_EXPLICIT_MEASURE_UNIT_RE = /^(g|gram|grams|oz|ounce|ounces|lb|lbs|pound|pounds|kg|kilogram|kilograms|cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons|ml|milliliter|milliliters|l|liter|liters|floz|fl\s*oz|fluid\s*ounces?|pint|pints|quart|quarts|gallon|gallons)$/i;
function copy_requestBillsByServing(parsed: ParsedIngredient | null): boolean {
    return !(parsed?.unit && COPY_EXPLICIT_MEASURE_UNIT_RE.test(parsed.unit.trim()));
}

function copy_candidateHasServingData(candidate: UnifiedCandidate): boolean {
    if (candidate.source === 'openfoodfacts') {
        const raw = candidate.rawData as { servingGrams?: number | null } | undefined;
        return typeof raw?.servingGrams === 'number' && raw.servingGrams > 0;
    }
    if (candidate.source === 'fdc') {
        return !!candidate.servings?.some((s: any) => typeof s.grams === 'number' && s.grams > 0);
    }
    if (candidate.source === 'fatsecret') {
        return !!candidate.servings?.some((s: any) => typeof s.grams === 'number' && s.grams > 0);
    }
    return false;
}

const COPY_VOLUME_UNIT_STEMS: Record<string, string[]> = {
    cup: ['cup'], cups: ['cup'],
    tbsp: ['tbsp', 'tablespoon'], tablespoon: ['tbsp', 'tablespoon'], tablespoons: ['tbsp', 'tablespoon'],
    tsp: ['tsp', 'teaspoon'], teaspoon: ['tsp', 'teaspoon'], teaspoons: ['tsp', 'teaspoon'],
    floz: ['fl oz', 'fluid ounce'], 'fl oz': ['fl oz', 'fluid ounce'],
};
function copy_isMatchableVolumeUnit(unit: string): boolean {
    return COPY_VOLUME_UNIT_STEMS[unit.toLowerCase().trim()] != null;
}

// ============================================================
// 5. WRITE GUARD  (see the READ-ONLY promise in the header)
// ============================================================

const MUTATING = new Set([
    'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany',
    'upsert', 'delete', 'deleteMany', 'executeRaw', 'executeRawUnsafe',
]);

let suppressedWrites: Record<string, number> = {};
let guardInstalled = false;

function installWriteGuard() {
    if (guardInstalled) return;
    guardInstalled = true;
    prisma.$use(async (params: any, next: any) => {
        if (MUTATING.has(params.action)) {
            const key = `${params.model ?? 'raw'}.${params.action}`;
            suppressedWrites[key] = (suppressedWrites[key] ?? 0) + 1;
            // NO-OP, never throw — see the header note on getAiNormalizeCache.
            return null;
        }
        return next(params);
    });
}

function totalSuppressed(entries: Array<{ suppressedWrites: Record<string, number> }>): Record<string, number> {
    const t: Record<string, number> = {};
    for (const e of entries) for (const [k, v] of Object.entries(e.suppressedWrites)) t[k] = (t[k] ?? 0) + v;
    return t;
}

// ============================================================
// 6. Snapshot types
// ============================================================

interface AiEstimate {
    caloriesPer100g: number;
    proteinPer100g: number;
    carbsPer100g: number;
    fatPer100g: number;
    confidence: number;
}

interface SnapshotEntry {
    query: string;
    origin: QueryOrigin;
    goldenId?: string;
    ok: boolean;
    error?: string;
    /** arg 1 the mapper handed gatherCandidates */
    gatherRawLine: string;
    /** gatherRawLine.trim() — what filterCandidatesByTokens receives as options.rawLine */
    trimmed: string;
    parsed: ParsedIngredient | null;
    normalizedName: string;
    isBrandedQuery: boolean;
    targetBrand?: string;
    aiSynonyms: string[];
    aiCanonicalBase?: string;
    /** captured PRE-Step-4 only; the FDC fallback is version-dependent and re-derived per replay */
    aiNutritionEstimate?: AiEstimate;
    aiEstimateSource: 'llm_normalize' | 'normalize_cache' | 'none';
    candidates: UnifiedCandidate[];
    suppressedWrites: Record<string, number>;
    elapsedMs: number;
}

interface SnapshotFile {
    kind: 'winner-diff/snapshot';
    version: 1;
    takenAt: string;
    repoRoot: string;
    gitHead: string;
    gitDirty: string;
    /** how the population was built, verbatim, so a reader can rebuild it */
    population: string;
    envFiles: string[];
    forcedFlags: Record<string, string>;
    callerHash: string;
    helpersHash: string;
    entries: SnapshotEntry[];
}

// ============================================================
// 7. SNAPSHOT
// ============================================================

class GatherCaptured extends Error {
    constructor(public payload: any) { super('WINNER_DIFF_GATHER_CAPTURED'); }
}

interface GatherCapture {
    gatherRawLine: string;
    parsed: ParsedIngredient | null;
    normalizedName: string;
    isBrandedQuery: boolean;
    targetBrand?: string;
    aiSynonyms: string[];
    candidates: UnifiedCandidate[];
}

/**
 * Intercept gatherCandidates. `mode` decides what happens after the capture:
 *   'abort'    throw a sentinel so the mapper stops at Step 3 (snapshot mode) —
 *              nothing downstream runs, so no save path is even reachable.
 *   'continue' return the real result and let the mapper finish (verify mode).
 *
 * It deliberately IGNORES the QUICK gather (`options.skipOff === true`, mapper
 * :1160) and captures only the FULL gather (:1479) that feeds Step 3.
 */
function installGatherInterceptor(mode: 'abort' | 'continue', sink: { capture: GatherCapture | null }) {
    const realGather = gatherMod.gatherCandidates;
    gatherMod.gatherCandidates = async function (
        rawLine: string, parsed: ParsedIngredient | null, normalizedName: string, options: GatherOptions = {},
    ) {
        const result = await realGather(rawLine, parsed, normalizedName, options);
        if ((options as any).skipOff === true) return result;
        sink.capture = {
            gatherRawLine: rawLine,
            parsed: parsed ? JSON.parse(JSON.stringify(parsed)) : null,
            normalizedName,
            isBrandedQuery: !!(options as any).isBrandedQuery,
            targetBrand: (options as any).targetBrand,
            aiSynonyms: (options as any).aiSynonyms ?? [],
            candidates: JSON.parse(JSON.stringify(result)),
        };
        if (mode === 'abort') throw new GatherCaptured(sink.capture);
        return result;
    };
    return () => { gatherMod.gatherCandidates = realGather; };
}

/**
 * Read the capture back out of the sink.
 *
 * Why a function and not `const c = sink.capture`: the interceptor assigns the sink
 * from a closure TypeScript's control-flow analysis cannot see, so after the
 * `sink.capture = null` reset at the top of the loop it narrows the property to
 * `null` and every field access below becomes `never`. A function call result is
 * not narrowed.
 */
function takeCapture(sink: { capture: GatherCapture | null }): GatherCapture | null {
    return sink.capture;
}

interface AiSink { llm: any; cache: any }

function installAiInterceptors(sink: AiSink) {
    const realAiNormalize = aiNormalizeMod.aiNormalizeIngredient;
    const realGetCache = vmHelpersMod.getAiNormalizeCache;
    aiNormalizeMod.aiNormalizeIngredient = async function (...args: any[]) {
        const r = await realAiNormalize(...args);
        sink.llm = r;
        return r;
    };
    vmHelpersMod.getAiNormalizeCache = async function (...args: any[]) {
        const r = await realGetCache(...args);
        sink.cache = r;
        return r;
    };
    return () => {
        aiNormalizeMod.aiNormalizeIngredient = realAiNormalize;
        vmHelpersMod.getAiNormalizeCache = realGetCache;
    };
}

/** Reproduce the caller's if/else at mapper :1180 vs :1209 exactly. */
function resolveAiEstimate(sink: AiSink): Pick<SnapshotEntry, 'aiCanonicalBase' | 'aiNutritionEstimate' | 'aiEstimateSource'> {
    if (sink.llm && sink.llm.status === 'success') {
        return {
            aiCanonicalBase: sink.llm.canonicalBase,
            aiNutritionEstimate: sink.llm.nutritionEstimate,
            aiEstimateSource: 'llm_normalize',
        };
    }
    if (sink.cache?.nutritionEstimate) {
        return {
            aiCanonicalBase: sink.cache.canonicalBase,
            aiNutritionEstimate: sink.cache.nutritionEstimate,
            aiEstimateSource: 'normalize_cache',
        };
    }
    return { aiEstimateSource: 'none' };
}

async function runSnapshot(pop: PopulationLine[], outPath: string, population: string, debug: boolean, resume: boolean) {
    installWriteGuard();

    const ndjsonPath = outPath + '.ndjson';
    const done = new Set<string>();
    const entries: SnapshotEntry[] = [];

    // --resume: the 4,165-query snapshot that produced the confidenceGate read cost
    // ~2.5h of LLM + FatSecret API. A dropped SSH session must not be a restart.
    if (resume && fs.existsSync(ndjsonPath)) {
        for (const line of fs.readFileSync(ndjsonPath, 'utf8').split('\n')) {
            if (!line.trim()) continue;
            try {
                const e = JSON.parse(line) as SnapshotEntry;
                if (done.has(e.query)) continue;
                done.add(e.query);
                entries.push(e);
            } catch { /* truncated tail line from a killed run — ignore */ }
        }
        say(`--resume: ${done.size} entries recovered from ${ndjsonPath}`);
    } else if (fs.existsSync(ndjsonPath)) {
        fs.unlinkSync(ndjsonPath);
    }

    const sink = { capture: null as GatherCapture | null };
    const aiSink: AiSink = { llm: null, cache: null };
    const restoreGather = installGatherInterceptor('abort', sink);
    const restoreAi = installAiInterceptors(aiSink);

    const todo = pop.filter(p => !done.has(p.query));
    // ONE budget for the whole sweep, shared by every query (see warm-names.ts).
    const nutritionBudget = createAiNutritionBudget(AI_NUTRITION_MAX_PER_BATCH);
    for (let i = 0; i < todo.length; i++) {
        const p = todo[i];
        sink.capture = null; aiSink.llm = null; aiSink.cache = null;
        suppressedWrites = {};
        const t0 = Date.now();
        let err: string | undefined;
        muzzle(true);
        try {
            await mapperMod.mapIngredientWithFallback(p.query, {
                skipCache: true,          // force COLD: bypass the FoodMapping short-circuit
                debug,
                allowLiveFallback: true,
                skipOnLock: true,
                aiNutritionBudget: nutritionBudget,
            });
            err = 'mapper returned without reaching the full gatherCandidates call';
        } catch (e: any) {
            if (!(e instanceof GatherCaptured) && e?.message !== 'WINNER_DIFF_GATHER_CAPTURED') {
                err = e?.message ?? String(e);
            }
        }
        muzzle(false);

        const c = takeCapture(sink);
        const entry: SnapshotEntry = {
            query: p.query,
            origin: p.origin,
            goldenId: p.goldenId,
            ok: c != null && !err,
            error: err,
            gatherRawLine: c?.gatherRawLine ?? p.query,
            trimmed: (c?.gatherRawLine ?? p.query).trim(),
            parsed: c?.parsed ?? null,
            normalizedName: c?.normalizedName ?? '',
            isBrandedQuery: c?.isBrandedQuery ?? false,
            targetBrand: c?.targetBrand,
            aiSynonyms: c?.aiSynonyms ?? [],
            ...resolveAiEstimate(aiSink),
            candidates: c?.candidates ?? [],
            suppressedWrites: { ...suppressedWrites },
            elapsedMs: Date.now() - t0,
        };
        entries.push(entry);
        fs.appendFileSync(ndjsonPath, JSON.stringify(entry) + '\n');
        say(`  [${i + 1}/${todo.length}] ${p.query}  ->  pool=${c?.candidates?.length ?? 0}` +
            ` norm="${c?.normalizedName ?? ''}"` + (err ? `  ERROR: ${err}` : ''));
    }

    restoreGather();
    restoreAi();

    const drift = checkDrift(true);
    const snap: SnapshotFile = {
        kind: 'winner-diff/snapshot',
        version: 1,
        takenAt: new Date().toISOString(),
        repoRoot: REPO_ROOT,
        gitHead: gitHead(),
        gitDirty: gitDirtyHash(),
        population,
        envFiles: ENV_FILES,
        forcedFlags: FORCED_FLAGS,
        callerHash: drift.caller,
        helpersHash: drift.helpers,
        entries,
    };
    writeJsonAtomic(outPath, snap);

    const tw = totalSuppressed(entries);
    say('');
    say(`snapshot written: ${outPath}   (incremental log: ${ndjsonPath})`);
    say(`  population: ${population}`);
    say(`  queries: ${entries.length}   ok: ${entries.filter(e => e.ok).length}   failed: ${entries.filter(e => !e.ok).length}`);
    const split = originSplit(entries.map(e => e.query));
    say(`  origin: user ${split.user}   warmer-shaped ${split.warmer} (${split.warmerPct.toFixed(1)}%)  ` +
        '<- "100g <token-sorted key>" lines written by cache-parity-sweep, not user traffic');
    say('  SUPPRESSED WRITES (these would have hit the DB in production; none were performed):');
    for (const [k, v] of Object.entries(tw).sort((a, b) => b[1] - a[1])) say(`    ${k}: ${v}`);
    if (!Object.keys(tw).length) say('    (none)');
}

// ============================================================
// 8. Replay variants
// ============================================================

/**
 * Which selection shape the replay transcribes.
 *
 *   baseline       caller 3a20888d65bd8cbd (master 874f786, lines 1485-1768):
 *                  confidenceGate PRE-EMPTS Step 4 when it fires.
 *   gate-backstop  caller 4ea700da8becee0c (lines 1485-1987), and the two earlier
 *                  shapes it supersedes: Step 4 ALWAYS runs; `gateSelection` is used
 *                  ONLY when simpleRerank named nobody, ahead of the raw
 *                  `sortedFiltered[0].score >= 0.80` grab, plus a confidence lift on
 *                  agreement that is scoped to the gate's `high_confidence_clear_winner`
 *                  exit.
 *
 * A HAZARD TO KNOW ABOUT: `gate-backstop` names a FAMILY of three pinned hashes, and
 * the transcription reproduces only the CURRENT one (4ea700da). announceVariantFit
 * resolves the tree's hash to a variant NAME and then compares NAMES, so a tree
 * sitting on 5190a9ae or 349af835 is told `MATCHES this tree's caller` when in fact
 * the transcription models a later shape. The hash it prints alongside is the thing
 * to read. The superseded pins are kept because a tree CAN still be on them (and
 * the record of what each shape was is the point of the table) — but only
 * 4ea700da8becee0c is transcribed, so only in that tree does `verify` prove anything.
 *
 * Both are real caller shapes (see KNOWN_CALLERS), so a tree containing EITHER can
 * replay BOTH off one frozen snapshot — which is the only way to A/B a change to the
 * caller itself without copying trees or `git checkout -- <file>`.
 *
 * `winner-diff verify` can only prove the variant that MATCHES the tree it runs in;
 * for the other one it would be comparing the transcription against code that is not
 * there. Run verify in each tree for the variant that tree contains. Every mode prints
 * whether the requested variant matches the tree (see announceVariantFit).
 */
export type SelectionVariant = 'baseline' | 'gate-backstop';
const VARIANTS: SelectionVariant[] = ['baseline', 'gate-backstop'];

// ============================================================
// 9. THE TRANSCRIPTION
//
// >>> TRANSCRIPTION BEGIN
// Mirrors src/lib/mapping/map-ingredient-with-fallback.ts between the anchors
// `// Step 3: Apply must-have token filter` .. `selectionReason =
// 'scored_by_confidence';`, statement for statement.
//
// TWO CALLER SHAPES ARE TRANSCRIBED HERE (see KNOWN_CALLERS):
//   --variant baseline       caller 3a20888d65bd8cbd, lines 1485-1768
//   --variant gate-backstop  caller 4ea700da8becee0c, lines 1485-1987
// Steps 3 through 3e and the sort are IDENTICAL in both (the demotion diff starts
// at the caller's line 1641, immediately after `confidenceGate(...)`), so the line
// numbers below are the BASELINE's. In the gate-backstop caller everything from
// the gate onward is shifted by the ~220 lines of comment the demotion and the two
// review rounds added; the statements are the same, plus the `gateSelection`
// backstop, the scoped confidence lift and two logger calls (the loggers have no
// effect on selection). References to gate-backstop-ONLY statements use THIS
// tree's line numbers and say so.
//
// `winner-diff transcript` prints the real caller and this block side by side, and
// `winner-diff verify` is the only thing that PROVES the copy right.
//
// HISTORY OF THIS TRANSCRIPTION, because it has now been wrong twice by being
// RIGHT ABOUT AN OLDER CALLER:
//   5190a9ae93dbf642  demotion, no mitigations.
//   349af8359fd7b90b  demotion + Mitigation A (gate pick appended to the rerank
//                     window) + Mitigation B UNSCOPED (max(rerank, gate) on any
//                     agreement).
//   4ea700da8becee0c  CURRENT. A REVERTED (see the deleted-A note in runStep4);
//                     B KEPT but scoped to gateResult.reason ===
//                     'high_confidence_clear_winner'.
// Both changes were transcribed on 2026-07-26 by reading the caller, not by
// editing the previous transcription's numbers.
//
// ---------------------------------------------------------------------------
// RECEIPTS — CURRENT (4ea700da8becee0c / A-reverted, B-scoped), 2026-07-26,
// variant gate-backstop, tree 184f45f2. Re-measured; NOTHING carried over from
// the 349af835 pin.
//
// POPULATION (65 queries, built from the frozen-pool replays zzv-repB-mit /
// zzv-repC-nomit restricted to rows Mitigation A never moved, so they behave in
// this tree as they did in both):
//   27  gate fires basic_produce_bypass AND the reranker re-selects the gate pick
//       -> B is SUPPRESSED here by the scope
//   18  gate fires high_confidence_clear_winner AND the reranker re-selects it
//       -> B is ACTIVE here
//   10  gate fires, no lift
//   10  gate does not fire (controls)
//   As RUN, the gate fired on 55 of the 65 (33 basic_produce_bypass /
//   22 high_confidence_clear_winner) — live retrieval reclassified a few.
//
// RESULT:  65 MATCH / 0 MISMATCH-EXPLAINED / 0 MISMATCH-UNEXPLAINED / 0 NO-GATHER
//          65 CONF-MATCH / 0 CONF-REWRITTEN / 0 CONF-UNEXPLAINED
//
// SENSITIVITY — and this one changed how the mode works, so read it.
// Stub 1, the B SCOPE removed (`backstop.reason === '...'` -> `true`, i.e. the
// abandoned 349af835 behaviour), identical population, identical caller:
//     MISMATCH-UNEXPLAINED  0        <- the foodId axis SAW NOTHING
//     CONF-UNEXPLAINED      27       <- every basic_produce_bypass agreement row,
//                                       real 0.762..0.980 vs replay 1.000
// Stub 2, B removed entirely (`-> false`):
//     MISMATCH-UNEXPLAINED  0        <- again nothing
//     CONF-UNEXPLAINED      18       <- every high_confidence_clear_winner
//                                       agreement row, real 1.000 vs replay 0.95/0.98
// Both stubs were applied to a COPY-and-restore discipline and the restore proven
// byte-identical by shasum (93d2b7a2cef1c92c).
//
// BASELINE INVARIANCE — MEASURED, not argued from "it is gated on `backstop`".
// A 65-query frozen snapshot was built from the same population and replayed under
// BOTH variants by BOTH the pre-edit file (A + unscoped B) and this one, then
// compared row by row on winner id + confidence + path + rerank-window size:
//   --variant baseline       65 / 65 IDENTICAL, 0 winners moved, 0 confidences moved
//   --variant gate-backstop  37 identical, 0 winners moved, 27 confidences moved
//                            (every one basic_produce_bypass, 1.000 -> the real
//                            rerank confidence: the B scope), plus 1 rerank-window
//                            change, `1 bottle premier protein caramel shake` 11 ->
//                            10, which is Mitigation A's append disappearing.
// The gate-backstop population was deliberately restricted to rows A never moved, so
// "0 winners moved" there is expected and is NOT evidence that A was inert — over
// the full 4,165-row corpus A moved 5.
//
// THE LESSON THE STUBS TAUGHT: before this pin, `verify` compared foodId ONLY.
// With Mitigation A reverted, NOTHING that distinguishes the gate-backstop caller
// from the baseline moves a foodId on a row where the reranker names someone — so
// a foodId-only verify was structurally incapable of failing on the one mitigation
// that remains, for EVERY possible population. It would have printed a green
// receipt over a transcription of the wrong caller. That is why the confidence
// axis was added rather than the population extended: the earlier receipt's
// sensitivity (6 MISMATCH-UNEXPLAINED under a stub) was a property of Mitigation
// A, and it left the file the moment A did.
// ---------------------------------------------------------------------------
//
//   caller 1485-1493  Step 3   filterCandidatesByTokens                 -> pool.afterTokenFilter
//   caller 1494-1539  Step 3b  hasCoreTokenMismatch + brand rescue      -> pool.afterCoreToken
//   caller 1541-1557  Step 3c  zero/invalid macros + all-drop restore   -> pool.afterZeroMacro
//   caller 1559-1592  Step 3d  assessMacroPlausibility (drop/penalise)  -> pool.afterPlausibility
//   caller 1594-1596  Step 3e  dropDenylistedCandidates                 -> pool.afterDenylist
//   caller 1598-1616  NON-MONOTONE #2 relaxed recovery (length===0)     -> relaxedRecovery
//   caller 1626-1628  BASIC_PRODUCE (caller-local 11-string list)       -> isBasicProduce
//   caller 1637-1640  computeFloorHitIds + makeSortedFilteredComparator -> sortedFiltered
//   caller 1642       confidenceGate(searchQuery, sortedFiltered, trimmed)
//   caller 1644-1647  NON-MONOTONE #3 gate pre-emption                  -> path=confidence_gate_early_exit
//   caller 1657       countedPieceNoun(parsed)
//   caller 1660-1668  NON-MONOTONE #1 filtered.slice(0,10) over GATHER order + count-label
//                     extension to a hard cap of 13                     -> pool.rerankWindow
//   caller 1669-1696  ai_generated nutrition read (pre-enriched in bulk before replay)
//   caller 1703-1722  FDC fallback for aiNutritionEstimate (version-dependent: re-derived)
//   caller 1724-1733  requestBillsByServing + grainVolumeUnit
//   caller 1734-1745  toRerankCandidate({... countLabelMatch, servingLabelMatch})
//   caller 1750-1751  rerankQuery + simpleRerank (NON-MONOTONE #4 lives inside:
//                     simple-rerank.ts:1883 `siblings.length >= 3`)
//   caller 1753-1760  re-resolve the winner out of `filtered` by id     -> path=rerank
//   caller 1762-1768  MIN_FALLBACK_CONFIDENCE = 0.80 on sortedFiltered[0].score
//
// gate-backstop ONLY (no counterpart in the baseline caller; line numbers verified
// by grep in THIS tree at caller hash 4ea700da8becee0c, not inferred from the diff):
//   caller 1724       `gateSelection = gateResult.skipAiRerank ? gateResult.selected : undefined`
//   caller 1746-1778  where MITIGATION A USED TO BE. The caller reverted the
//                     `candidatesForRerank.push(gateSelection)` and left a 33-line
//                     comment ("NOT DONE HERE, DELIBERATELY") in its place, so the
//                     rerank window is now filtered.slice(0,10) + the countedNoun
//                     extension in BOTH variants and `pool.rerankWindow` no longer
//                     differs between them. The 17 past-index-10 gate picks are still
//                     silently deleted; that is a slice(0,10) defect, not this
//                     harness's to model. See the deleted-A note in runStep4.
//   caller 1869-1918  MITIGATION B — on winner.id === gateSelection.id AND
//                     `gateResult.reason === 'high_confidence_clear_winner'` (the
//                     reason scope is caller 1915),
//                     `confidence = Math.max(confidence, gateResult.confidence)`.
//                     Changes no winner id; visible only in the confidence field.
//   caller 1952-1981  `if (!winner) { if (gateSelection) { winner = gateSelection;
//                     selectionReason = 'confidence_gate_backstop' } else if (...0.80...) }`
//                     — note the gate branch SKIPS the 0.80 floor entirely
//   caller 1922-1951  `mapping.confidence_gate_overridden` logging: observation only,
//                     deliberately NOT transcribed (it cannot change a winner)
//
// TWO CALLER-LOCAL LISTS THAT LOOK ALIKE AND ARE NOT:
//   BASIC_PRODUCE          (caller :1627) an 11-string literal matched by
//                          normalizedName.includes(p). Drives only the SORT.
//   BASIC_PRODUCE_PATTERNS (confidenceGate, gather-candidates.ts :578) a regex list,
//                          additionally `&& !/\b(canned|cooked|dried)\b/`. Drives the
//                          BYPASS. Transcribing one for the other silently changes
//                          which rows early-exit.
// ============================================================

function replaySelection(e: SnapshotEntry, debug: boolean, variant: SelectionVariant): ReplayRow {
    const notes: string[] = [];
    const row: ReplayRow = {
        query: e.query,
        origin: e.origin,
        goldenId: e.goldenId,
        path: 'no_winner_no_candidates',
        relaxedRecovery: false,
        pool: {
            gather: e.candidates.length, afterTokenFilter: 0, afterCoreToken: 0,
            afterZeroMacro: 0, afterPlausibility: 0, afterDenylist: 0, admitted: 0, rerankWindow: 0,
        },
        rerankWindowIds: [],
        admittedIds: [],
        rerankRan: false,
        gate: { skipAiRerank: false, reason: '(not reached)', confidence: 0 },
        winner: null,
        notes,
    };

    if (!e.ok) { row.path = 'snapshot_failed'; row.error = e.error; return row; }

    // MANDATORY fresh deep copy: Step 3d rebuilds objects and the caller's Step 4
    // MUTATES `candidate.nutrition` in place. Without this the second replay of the
    // same snapshot is not the first, and the noise floor stops meaning anything.
    const allCandidates: UnifiedCandidate[] = JSON.parse(JSON.stringify(e.candidates));
    const trimmed = e.trimmed;
    const normalizedName = e.normalizedName;
    const parsed = e.parsed;
    const isBrandedQuery = e.isBrandedQuery;
    const matchedBrand = e.targetBrand;
    const aiCanonicalBase = e.aiCanonicalBase;

    if (allCandidates.length === 0) { row.path = 'no_winner_no_candidates'; return row; }

    let winner: UnifiedCandidate | null = null;
    let confidence = 0;
    let selectionReason = '';

    // ---- caller 1485-1493: Step 3, must-have token filter ------------------
    const filterResult = filterCandidatesByTokens(allCandidates, normalizedName, { debug, rawLine: trimmed });
    let filtered: UnifiedCandidate[] = filterResult.filtered;
    row.pool.afterTokenFilter = filtered.length;

    // ---- caller 1494-1539: Step 3b, core token validation + brand rescue ---
    const rescueBrand = matchedBrand?.toLowerCase().trim();
    filtered = filtered.filter((c: UnifiedCandidate) => {
        const mismatch = hasCoreTokenMismatch(normalizedName, c.name, c.brandName);
        if (!mismatch) return true;
        if (rescueBrand && (
            c.brandName?.toLowerCase().includes(rescueBrand) ||
            new RegExp(`\\b${rescueBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(c.name.toLowerCase())
        )) return true;
        return false;
    });
    row.pool.afterCoreToken = filtered.length;

    // ---- caller 1541-1557: Step 3c, zero/invalid macros (all-drop restore) -
    const macroValid = filtered.filter((c: UnifiedCandidate) =>
        !c.nutrition?.per100g || !hasNullOrInvalidMacros(c.nutrition, c.name));
    if (macroValid.length > 0 && macroValid.length < filtered.length) filtered = macroValid;
    row.pool.afterZeroMacro = filtered.length;

    // ---- caller 1559-1592: Step 3d, macro plausibility --------------------
    const plausibilityChecked = filtered.map((c: UnifiedCandidate) => {
        if (!c.nutrition?.per100g) return c;
        const assessment = assessMacroPlausibility(normalizedName, c.name, c.nutrition);
        if (assessment.plausible) return c;
        if (assessment.impossible) return null;
        return { ...c, score: c.score * assessment.penalty };
    });
    const plausibleCandidates = plausibilityChecked.filter((c: any): c is UnifiedCandidate => c !== null);
    if (plausibleCandidates.length > 0) filtered = plausibleCandidates;
    row.pool.afterPlausibility = filtered.length;

    // ---- caller 1594-1596: Step 3e, denylist ------------------------------
    filtered = dropDenylistedCandidates(filtered, trimmed);
    row.pool.afterDenylist = filtered.length;

    // ---- caller 1598-1616: NON-MONOTONE #2, relaxed recovery --------------
    // Fires ONLY when strict is EMPTY. Relaxed keeps just the LAST must-have token,
    // so its output is a strict SUPERSET — admitting one candidate above therefore
    // SUPPRESSES this retry and swaps a superset for a subset.
    // Faithful to the caller: the relaxed output is NOT re-run through 3b-3e.
    if (filtered.length === 0) {
        const relaxed = filterCandidatesByTokens(allCandidates, normalizedName, { debug, rawLine: trimmed, relaxed: true });
        if (relaxed.filtered.length > 0) {
            filtered = relaxed.filtered;
            row.relaxedRecovery = true;
            notes.push(`relaxed_recovery admitted ${filtered.length} (strict was empty; 3b-3e NOT re-applied)`);
        }
    }

    row.pool.admitted = filtered.length;
    row.admittedIds = filtered.map((c: UnifiedCandidate) => c.id);

    // caller 1623: `if (filtered.length > 0)` — everything below is inside it.
    if (filtered.length === 0) { row.path = 'no_winner_all_filtered'; return row; }

    // ---- caller 1626-1628: searchQuery + the caller-local BASIC_PRODUCE list
    const searchQuery = parsed?.name || normalizedName;
    const BASIC_PRODUCE = ['potato', 'potatoes', 'lentil', 'lentils', 'beans', 'chickpea', 'chickpeas', 'spinach', 'broccoli', 'carrot', 'carrots'];
    const isBasicProduce = BASIC_PRODUCE.some(p => normalizedName.toLowerCase().includes(p));

    // ---- caller 1637-1640: floor-hit partition + the sort -----------------
    const floorHitIds = computeFloorHitIds(normalizedName, filtered);
    const sortedFiltered = [...filtered].sort(makeSortedFilteredComparator(normalizedName, isBasicProduce, floorHitIds));

    // ---- caller 1642: Step 3a, the confidence gate ------------------------
    const gateResult = confidenceGate(searchQuery, sortedFiltered, trimmed);
    row.gate = {
        skipAiRerank: !!gateResult.skipAiRerank,
        reason: gateResult.reason ?? '',
        confidence: gateResult.confidence ?? 0,
    };

    /**
     * caller 1649-1778 — the ENTIRE else-branch of the gate, extracted into a closure
     * so it can ALSO be run as the counterfactual when the gate pre-empts. Identical
     * statements in identical order; the only change is that the caller's assignments
     * to `winner` / `confidence` / `selectionReason` became locals that are returned.
     *
     * NOTE THE SCOPE: the `MIN_FALLBACK_CONFIDENCE = 0.80` fallback (caller 1762-1778)
     * is INSIDE this else-branch, so when the gate fires today the 0.80 floor never
     * runs either. Putting it inside this closure is what makes `counter` answer the
     * question the demotion decision actually needs — "what would the caller have
     * returned here?" — rather than the narrower "what would simpleRerank alone have
     * returned?". Getting that wrong would understate `rerankDeclined`.
     *
     * `aiNutritionEstimate` is a per-invocation local (the caller assigns to an
     * outer-scope variable, but the caller only ever runs Step 4 once — keeping it
     * local means the counterfactual cannot leak the FDC fallback into anything).
     *
     * `backstop` is non-null ONLY in the modelled `gate-backstop` variant.
     */
    const runStep4 = (
        backstop: { selected: UnifiedCandidate; confidence: number; reason: string } | null,
    ): NonNullable<ReplayRow['counter']> => {
        const s4notes: string[] = [];
        let s4winner: UnifiedCandidate | null = null;
        let s4confidence = 0;
        let s4reason = '';
        let s4path: SelectionPath = 'no_winner_rerank_declined';
        let aiNutritionEstimate = e.aiNutritionEstimate ? { ...e.aiNutritionEstimate } : undefined;

        // caller 1657
        const countedNoun = countedPieceNoun(parsed);

        // caller 1660-1668: NON-MONOTONE #1 — slice over GATHER order, not score
        // order; the count-label extension pulls from filtered.slice(10) to a hard
        // cap of 13. In BOTH variants this is now the ONLY way a candidate with
        // indexInFiltered >= 10 can reach the reranker.
        const candidatesForRerank: UnifiedCandidate[] = filtered.slice(0, 10);
        if (countedNoun) {
            for (const c of filtered.slice(10)) {
                if (candidatesForRerank.length >= 13) break;
                if (copy_candidateHasCountLabel(c, countedNoun)) candidatesForRerank.push(c);
            }
        }

        // ---- MITIGATION A: DELETED FROM THIS TRANSCRIPTION, 2026-07-26 --------
        // A `candidatesForRerank.push(backstop.selected)` used to sit HERE, mirroring
        // a caller that appended `gateSelection` to the rerank window so the gate's
        // pick competed even from past the `filtered.slice(0, 10)` cutoff. THE CALLER
        // REVERTED IT (caller 1746-1778 is now a ~33-line comment in its place saying
        // "NOT DONE HERE, DELIBERATELY"), so the transcription drops it too. Keeping
        // it would have made this file model a shape no tree contains.
        //
        // Why the caller reverted it, recorded here so nobody re-adds it on the same
        // reasoning that put it in: scored against the project's own adjudication of
        // all 296 disagreements it restored 5 of the 17 past-index-10 rows, 2 of them
        // adjudicated rerank-BETTER, so the regression count did not move — it only
        // changed which rows were wrong. Combined with Mitigation B it took
        // `buffalo wild wings boneless wings` from 0.710 (below the 0.75
        // sub-threshold floor, therefore not cached at all) to 1.000 — a displacing
        // upsert of an adjudicated-WRONG record. And it flattered its own
        // measurement: a restored row scores SAME in a baseline-vs-change diff and so
        // drops out of the screen population entirely.
        //
        // The 17 silent deletions are REAL and still unfixed. They are a defect of
        // `slice(0, 10)` over gather order, to be fixed where that lives with its own
        // gate — not special-cased for the gate pick. Consequence for this harness:
        // on those rows a gate-backstop replay shows the reranker deciding without
        // the gate's record present, which is what the caller does.
        //
        // `backstop` therefore now affects EXACTLY TWO things: the confidence lift
        // below (scoped), and the no-winner backstop further down.

        // caller 1669-1696: the ai_generated nutrition read. Batched into
        // preEnrichAiGenerated() before the replay loop so this stays synchronous
        // and therefore trivially deterministic.
        const missingNutr = candidatesForRerank.filter(c => c.source === 'ai_generated' && !c.nutrition);
        if (missingNutr.length > 0) {
            s4notes.push(`${missingNutr.length} ai_generated candidate(s) still lack nutrition after the batched pre-enrich read`);
        }

        // caller 1703-1722: FDC fallback for the tiebreaker. Derived from
        // candidatesForRerank, hence VERSION-DEPENDENT — re-derived per replay,
        // never baked into the snapshot.
        if (!aiNutritionEstimate) {
            const fdcRef = candidatesForRerank.find(c =>
                c.source === 'fdc' && c.nutrition?.per100g && (c.nutrition.kcal > 0 || c.nutrition.protein > 0));
            if (fdcRef && fdcRef.nutrition) {
                aiNutritionEstimate = {
                    caloriesPer100g: fdcRef.nutrition.kcal,
                    proteinPer100g: fdcRef.nutrition.protein,
                    carbsPer100g: fdcRef.nutrition.carbs,
                    fatPer100g: fdcRef.nutrition.fat,
                    confidence: 0.6,
                };
                s4notes.push(`aiNutritionEstimate synthesised from FDC candidate "${fdcRef.name}" (${fdcRef.id})`);
            }
        }

        // caller 1724-1733
        const billsByServing = copy_requestBillsByServing(parsed);
        const grainVolumeUnit = !billsByServing && parsed?.unit
            && copy_isMatchableVolumeUnit(parsed.unit)
            && detectGrainCookingContext(trimmed, normalizedName).softCooked === true
            ? parsed.unit : null;

        // caller 1734-1745
        const rerankCandidates = candidatesForRerank.map(c => toRerankCandidate({
            id: c.id,
            name: c.name,
            brandName: c.brandName,
            foodType: c.foodType,
            score: c.score,
            source: c.source,
            nutrition: c.nutrition,
            countLabelMatch: countedNoun ? copy_candidateHasCountLabel(c, countedNoun) : undefined,
            servingLabelMatch: billsByServing ? copy_candidateHasServingData(c)
                : grainVolumeUnit ? candidateHasVolumeServing(c, grainVolumeUnit) : undefined,
        }));

        // caller 1750-1751. NON-MONOTONE #4 lives inside simpleRerank.
        const rerankQuery = aiCanonicalBase || stripPrepModifiers(searchQuery);
        const rerankResult = simpleRerank(
            rerankQuery, rerankCandidates, aiNutritionEstimate, trimmed,
            isBrandedQuery, matchedBrand ?? undefined, countedNoun != null,
        );

        // caller 1753-1760
        if (rerankResult && rerankResult.winner) {
            const selected = filtered.find((c: UnifiedCandidate) => c.id === rerankResult.winner!.id);
            if (selected) {
                s4winner = selected;
                s4confidence = rerankResult.confidence;
                s4reason = rerankResult.reason;
                s4path = 'rerank';

                // ---- MITIGATION B, gate-backstop variant only (caller 1869-1918) --
                // AGREEMENT KEEPS THE HIGHER CONFIDENCE. The demotion is about WHICH
                // RECORD wins, but `confidence` is also the cache-admission signal
                // (`admitToCache = confidence >= 0.85 || subThreshold`), and the two
                // stages report on different scales: the gate exits at >= 0.85 by
                // construction, simpleRerank starts at min(0.5 + score*0.5, 0.95) and
                // then adds up to +0.1 for `exact_match`, capped at 0.98
                // (simple-rerank.ts:2077, :2086), with a 0.70 floor
                // (MIN_RERANK_CONFIDENCE, :2169). CORRECTED 2026-07-26: this comment
                // used to say the rerank scale TOPS OUT at 0.95, which is wrong. 0.98
                // is reachable and is the single most common stored value — 1,370 of
                // 3,246 FoodMapping rows sit at exactly 0.98 (measured 2026-07-26).
                // That false ceiling was the stated premise for this mitigation. The
                // mitigation is still right (0.85 vs the rerank scale is the real gap),
                // but do not re-derive anything from the old number.
                // Taking the rerank number unconditionally therefore
                // DEMOTED lines whose answer did not change at all — 37 of the 441
                // gate lines fall under the save gate, 9 with an UNCHANGED winner, 2
                // of those under SUB_THRESHOLD_SAVE_FLOOR (0.75) so they stop being
                // cached; and the ones that survive via `insertOnly` can then never be
                // REFRESHED, which is what the parity sweep and the nightly flywheel
                // rely on.
                //
                // TWO scopes, both transcribed from the caller, both load-bearing.
                //
                // (1) AGREEMENT. On disagreement the gate's confidence describes a
                // candidate that was just rejected, so carrying it over would be
                // laundering.
                //
                // (2) `high_confidence_clear_winner` ONLY — ADDED 2026-07-26 when the
                // caller scoped it (caller 1912-1918). "The gate exits at >= 0.85 by
                // construction" is true of exactly ONE of the gate's three exits.
                // `basic_produce_bypass` (gather-candidates.ts:605) returns
                // `Math.max(0, Math.min(1, top1.score))` — a CLAMPED RAW ENGINE SCORE,
                // which for any OFF candidate saturates at exactly 1.000 and says
                // nothing about match quality; `yeast_variant_preference` (:634)
                // returns a hardcoded 0.95. Only `high_confidence_clear_winner` (:706)
                // carries assessConfidence's actual match score. Measured on the 132
                // rows the unscoped lift touched: 27 were basic_produce_bypass, every
                // one at exactly 1.000, and 5 crossed the 0.85 save gate on it.
                //
                // `backstop.reason` is `gateResult.reason || 'confidence_gate'`, so
                // this check is EXACTLY the caller's `gateResult.reason ===
                // 'high_confidence_clear_winner'`: the default only substitutes for a
                // falsy reason, and both a falsy reason and 'confidence_gate' fail the
                // comparison the same way the caller's does.
                //
                // Note this changes NO winner id — it is invisible to a foodId-only
                // diff and to `verify`, which compares foodId. Confidence is carried on
                // WinnerInfo, so a `diff` reading the confidence field is the only
                // screen that can see it.
                if (
                    backstop
                    && s4winner.id === backstop.selected.id
                    && backstop.reason === 'high_confidence_clear_winner'
                ) {
                    s4confidence = Math.max(s4confidence, backstop.confidence);
                }
            }
        }

        // ---- gate-backstop variant only -------------------------------------
        // The gate demoted from pre-emption to backstop: `gateSelection` is consulted
        // only when simpleRerank named nobody, and it takes precedence over the raw
        // sortedFiltered[0].score >= 0.80 grab below (which is therefore skipped
        // entirely on these rows — mirror of the caller's
        // `if (!winner) { if (gateSelection) ... else if (sortedFiltered.length) ... }`).
        //
        // selectionReason is the BARE CONSTANT 'confidence_gate_backstop', matching the
        // caller exactly: the under_gate funnel class is
        // `selectionReason.split(':')[0]` through normalizeClassId, which strips digits
        // and parentheses, so echoing the gate's own reason string here would silently
        // put a different class in the telemetry than production emits.
        if (!s4winner && backstop) {
            s4winner = backstop.selected;
            s4confidence = backstop.confidence;
            s4reason = 'confidence_gate_backstop';
            s4path = 'confidence_gate_backstop';
            s4notes.push(`gate BACKSTOP (gate reason: ${backstop.reason}) — rerank declined, gate pick used ahead of the 0.80 score floor`);
        }

        // caller 1762-1778: fall back to the top scorer ONLY above the floor.
        if (!s4winner && sortedFiltered.length > 0) {
            const MIN_FALLBACK_CONFIDENCE = 0.80;
            if (sortedFiltered[0].score >= MIN_FALLBACK_CONFIDENCE) {
                s4winner = sortedFiltered[0];
                s4confidence = sortedFiltered[0].score;
                s4reason = 'scored_by_confidence';
                s4path = 'scored_by_confidence';
            } else {
                s4path = 'no_winner_rerank_declined';
                s4notes.push(`top scorer "${sortedFiltered[0].name}" score ${sortedFiltered[0].score.toFixed(3)} < ${MIN_FALLBACK_CONFIDENCE} floor`);
            }
        }

        const windowIds = candidatesForRerank.map(c => c.id);
        return {
            path: s4path,
            rerankWindow: candidatesForRerank.length,
            rerankWindowIds: windowIds,
            rerankReason: rerankResult?.reason,
            winner: s4winner ? mkWinner(s4winner, s4confidence, s4reason, filtered, true, windowIds) : null,
            notes: s4notes,
        };
    };

    if (variant === 'baseline' && gateResult.skipAiRerank && gateResult.selected) {
        // ---- caller 1644-1647: NON-MONOTONE #3 --------------------------------
        // basic_produce_bypass / high_confidence_clear_winner / yeast_variant_preference
        // return candidates[0] of the SORTED list, and the reranker never runs.
        winner = gateResult.selected as UnifiedCandidate;
        confidence = gateResult.confidence;
        selectionReason = gateResult.reason || 'confidence_gate';
        row.path = 'confidence_gate_early_exit';
        notes.push(`gate early-exit (${selectionReason}) — the reranker never ran`);

        // Record the winner BEFORE running the counterfactual, so nothing the
        // counterfactual touches can be read back into the primary result.
        row.winner = mkWinner(winner, confidence, selectionReason, filtered, false, []);

        // ---- COUNTERFACTUAL LENS (an ADDITION, not part of the caller) --------
        // Same pool, same process, same `filtered` array: what would the gate's
        // else-branch have returned? Timed, because the gate is defended as a
        // latency optimisation and the cost it avoids should be a measured number.
        //
        // READ BEFORE QUOTING A COUNTERFACTUAL NUMBER: this passes `null`, so it
        // models the BASELINE caller's else-branch faithfully — and that is what it is
        // for. Since the Mitigation-A revert (caller 4ea700da) the rerank WINDOW is
        // built identically with and without `backstop`, so on the gate-firing rows
        // this lens now reproduces the current gate-backstop caller's SELECTION too:
        // the only things `backstop` still changes are the scoped confidence lift
        // (which moves no id) and the no-winner backstop (which this lens reports as
        // `rerankDeclined` rather than resolving). It was a LOWER BOUND while
        // Mitigation A was in the tree; it is not one now. What it still cannot show
        // is the 17 gate picks sitting past `filtered.slice(0,10)`: neither caller
        // shows those to the reranker, so a "disagreement" on such a row is a
        // truncation artefact, not an adjudication. For confidence-field effects,
        // diff two replays (baseline vs gate-backstop) instead.
        const t0 = process.hrtime.bigint();
        row.counter = runStep4(null);
        row.counterMicros = Number(process.hrtime.bigint() - t0) / 1000;
        return row;
    }

    // Step 4 runs. In `baseline` this is the gate's else-branch; in `gate-backstop`
    // it is unconditional and carries the gate pick down as a backstop.
    const backstop = variant === 'gate-backstop' && gateResult.skipAiRerank && gateResult.selected
        ? { selected: gateResult.selected as UnifiedCandidate, confidence: gateResult.confidence ?? 0, reason: gateResult.reason || 'confidence_gate' }
        : null;
    const s4 = runStep4(backstop);
    row.rerankRan = true;
    row.path = s4.path;
    row.pool.rerankWindow = s4.rerankWindow;
    row.rerankWindowIds = s4.rerankWindowIds;
    row.rerankReason = s4.rerankReason;
    for (const n of s4.notes) notes.push(n);

    if (s4.winner) {
        winner = filtered.find((c: UnifiedCandidate) => c.id === s4.winner!.foodId) ?? null;
        confidence = s4.winner.confidence;
        selectionReason = s4.winner.selectionReason;
    }

    if (winner) {
        row.winner = mkWinner(winner, confidence, selectionReason, filtered, row.rerankRan, row.rerankWindowIds);
    }
    return row;
}
// <<< TRANSCRIPTION END

/** Winner record including the FULL macro panel — identity plus one number is not enough. */
function mkWinner(
    w: UnifiedCandidate, confidence: number, selectionReason: string,
    filtered: UnifiedCandidate[], rerankRan: boolean, windowIds: string[],
): WinnerInfo {
    const idx = filtered.findIndex((c: UnifiedCandidate) => c.id === w.id);
    const n: any = w.nutrition;
    return {
        foodId: w.id,
        foodName: w.name,
        brandName: w.brandName ?? null,
        source: w.source,
        kcalPer100g: n?.per100g ? n.kcal : null,
        panel: n ? {
            kcal: n.kcal ?? 0, protein: n.protein ?? 0, carbs: n.carbs ?? 0,
            fat: n.fat ?? 0, per100g: !!n.per100g,
        } : null,
        confidence,
        selectionReason,
        indexInFiltered: idx,
        inTop10: idx >= 0 && idx < 10,
        inRerankWindow: rerankRan && windowIds.includes(w.id),
    };
}

/**
 * The one async step inside the caller's Step 4 (mapper :1669-1696), hoisted into a
 * single batched read so replaySelection stays synchronous and therefore trivially
 * deterministic. This is a SELECT; the write guard leaves reads alone.
 */
async function preEnrichAiGenerated(entries: SnapshotEntry[]): Promise<number> {
    const ids = new Set<string>();
    for (const e of entries) {
        for (const c of e.candidates) if (c.source === 'ai_generated' && !c.nutrition) ids.add(c.id);
    }
    if (ids.size === 0) return 0;
    const rows = await prisma.aiGeneratedFood.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, caloriesPer100g: true, proteinPer100g: true, carbsPer100g: true, fatPer100g: true },
    });
    const byId = new Map<string, any>(rows.map((r: any) => [r.id, r]));
    let n = 0;
    for (const e of entries) {
        for (const c of e.candidates) {
            if (c.source === 'ai_generated' && !c.nutrition && byId.has(c.id)) {
                const r = byId.get(c.id);
                c.nutrition = {
                    kcal: r.caloriesPer100g, protein: r.proteinPer100g,
                    carbs: r.carbsPer100g, fat: r.fatPer100g, per100g: true,
                };
                n++;
            }
        }
    }
    return n;
}

// ============================================================
// 9b. THE SERVING STAGE  (optional; closes blind spot (B))
// ============================================================

/**
 * Tiers whose grams came from a model rather than from data. They do not replay
 * deterministically, so they are flagged and reported in their own bucket rather
 * than counted as movement the change under test caused.
 */
const AI_SERVING_TIER_RE = /(^|_)ai(_|$)|estimate/i;

/**
 * Run the REAL serving layer for every row that has a winner, and record what the
 * user would be billed.
 *
 * WHY THIS IS A SEPARATE PASS. `replaySelection` is synchronous and pure over the
 * frozen pool; serving resolution is async and reads the DB (sibling medians,
 * package quantities, OffServing rows). Keeping it after the fact preserves that
 * property — the selection half of a replay is still reproducible with no I/O.
 *
 * WHY THE WRITE GUARD IS ENOUGH. `hydrateOffCandidate` is cache-first: for records
 * already in OffFood — which is every record Typesense can return, since it indexes
 * our own Postgres — it is a pure read. Its upserts only fire for a record we do
 * not have, and the guard no-ops those without throwing.
 *
 * The honest limit: this measures the serving stage under REPLAY, where the cache
 * is bypassed. It still cannot see the save gates or what a warm read would serve.
 */
async function resolveServings(snap: SnapshotFile, rows: ReplayRow[]): Promise<void> {
    const byQuery = new Map(snap.entries.map(e => [e.query, e]));

    for (const row of rows) {
        const e = byQuery.get(row.query);
        if (!e || !row.winner) { row.serving = null; continue; }

        // The winner is recorded as an id; the builder needs the candidate OBJECT.
        // Deep-copy it: buildOffResult mutates candidate.nutrition in place, and a
        // mutated pool would make the second replay of a noise-floor pair differ
        // from the first for reasons that have nothing to do with the code.
        const src = e.candidates.find(c => c.id === row.winner!.foodId);
        if (!src) {
            row.serving = { grams: null, servingTier: null, servingDescription: null, totalKcal: null, aiTouched: false, error: 'winner not found in frozen pool' };
            continue;
        }
        const cand: UnifiedCandidate = JSON.parse(JSON.stringify(src));

        try {
            const r = await hydrateAndSelectServing(cand, e.parsed, row.winner.confidence, e.gatherRawLine);
            if (!r) { row.serving = null; continue; }
            const tier: string | null = r.servingTier ?? null;
            row.serving = {
                grams: typeof r.grams === 'number' ? r.grams : null,
                servingTier: tier,
                servingDescription: r.servingDescription ?? null,
                // `kcal` on FatsecretMappedIngredient is the TOTAL for the resolved
                // grams, not a per-100g figure — it is verbatim what route.ts:296
                // records as MappingEventLog.totalKcal, i.e. the number on screen.
                totalKcal: typeof r.kcal === 'number' ? r.kcal : null,
                aiTouched: tier != null && AI_SERVING_TIER_RE.test(tier),
            };
        } catch (err: any) {
            row.serving = {
                grams: null, servingTier: null, servingDescription: null, totalKcal: null,
                aiTouched: false, error: err?.message ?? String(err),
            };
        }
    }
}

// ============================================================
// 10. REPLAY mode
// ============================================================

async function buildReplay(
    snap: SnapshotFile, label: string, variant: SelectionVariant, debug: boolean, allowDrift: boolean,
    withServing = false, snapshotPath?: string,
): Promise<{ file: ReplayFile; enriched: number }> {
    const drift = checkDrift(allowDrift);
    announceVariantFit(drift, variant);

    if (snap.callerHash !== drift.caller) {
        say('');
        say('NOTE: the caller-block hash differs from the tree the SNAPSHOT was taken on');
        say(`      (snapshot=${snap.callerHash}  now=${drift.caller}).`);
        say('      Harmless for a caller-only change: the snapshot froze the GATHER output,');
        say('      which the caller block does not influence. It is NOT harmless if the tree');
        say('      also changed retrieval — then re-snapshot, and read limit (A) in the header.');
        say('');
    }

    installWriteGuard();
    muzzle(true);
    const enriched = await preEnrichAiGenerated(snap.entries);
    const rows: ReplayRow[] = [];
    for (const e of snap.entries) {
        try {
            rows.push(replaySelection(e, debug, variant));
        } catch (err: any) {
            rows.push({
                query: e.query, origin: e.origin, goldenId: e.goldenId, path: 'replay_error', relaxedRecovery: false,
                pool: { gather: e.candidates.length, afterTokenFilter: -1, afterCoreToken: -1, afterZeroMacro: -1, afterPlausibility: -1, afterDenylist: -1, admitted: -1, rerankWindow: -1 },
                rerankWindowIds: [], admittedIds: [], rerankRan: false,
                gate: { skipAiRerank: false, reason: 'error', confidence: 0 },
                winner: null, notes: [], error: err?.stack ?? err?.message ?? String(err),
            });
        }
    }

    if (withServing) {
        await resolveServings(snap, rows);
    }
    muzzle(false);

    const file: ReplayFile = {
        kind: 'winner-diff/replay',
        version: 1,
        label,
        variant,
        withServing,
        ranAt: new Date().toISOString(),
        gitHead: gitHead(),
        gitDirty: gitDirtyHash(),
        snapshotTakenAt: snap.takenAt,
        snapshotPopulation: snap.population,
        ...(snapshotPath ? { snapshotPath } : {}),
        callerHash: drift.caller,
        helpersHash: drift.helpers,
        rows,
    };
    return { file, enriched };
}

function printReplaySummary(f: ReplayFile, enriched: number, verbose: boolean) {
    say('');
    say(`=== REPLAY [${f.label}]  variant=${f.variant}  head=${f.gitHead} dirty=${f.gitDirty}  caller=${f.callerHash} helpers=${f.helpersHash}`);
    say(`    snapshot taken ${f.snapshotTakenAt}   population: ${f.snapshotPopulation}`);
    say(`    rows ${f.rows.length};  ai_generated candidates enriched by the batched read: ${enriched}`);
    say('');
    say('  PATH HISTOGRAM');
    for (const [k, v] of pathHistogram(f.rows)) {
        say(`    ${k.padEnd(34)} ${String(v).padStart(5)}  (${((100 * v) / f.rows.length).toFixed(1)}%)`);
    }
    const g = gateReasonHistogram(f.rows);
    say('');
    say('  GATE REASONS — split by whether the gate ACTUALLY FIRED (skipAiRerank).');
    say('    A flat histogram mixes the two and reads 6x too high: `margin_too_small` is');
    say('    the gate DECLINING, not firing.');
    say(`    FIRING (pre-empted the reranker): ${g.firingTotal}`);
    for (const [k, v] of g.firing) say(`        ${k.padEnd(38)} ${String(v).padStart(5)}`);
    say(`    NON-FIRING (Step 4 ran anyway):   ${g.nonFiringTotal}`);
    for (const [k, v] of g.nonFiring) say(`        ${k.padEnd(38)} ${String(v).padStart(5)}`);
    const relaxed = f.rows.filter(r => r.relaxedRecovery).length;
    const outsideTop10 = f.rows.filter(r => r.winner && r.winner.indexInFiltered >= 10).length;
    say('');
    say(`  relaxed-recovery rows: ${relaxed}`);
    say(`  winners with indexInFiltered >= 10 (entered ONLY via the count-label window extension): ${outsideTop10}`);
    const os = originSplit(f.rows.map(r => r.query));
    say(`  population origin: user ${os.user}   warmer-shaped ${os.warmer} (${os.warmerPct.toFixed(1)}%)`);

    if (verbose) {
        say('');
        for (const r of f.rows) {
            const p = r.pool;
            say(`  ${r.query}`);
            say(`      pool  gather=${p.gather} -> token=${p.afterTokenFilter} -> core=${p.afterCoreToken} -> zeromacro=${p.afterZeroMacro} -> plaus=${p.afterPlausibility} -> denylist=${p.afterDenylist} -> ADMITTED=${p.admitted}  rerankWindow=${p.rerankWindow}`);
            say(`      path  ${r.path}${r.relaxedRecovery ? '  (+relaxed_recovery)' : ''}   gate=${r.gate.reason}${r.gate.skipAiRerank ? ' SKIP_RERANK' : ''}${r.rerankReason ? '   rerank=' + r.rerankReason : ''}`);
            say(`      win   ${fmtWinner(r.winner)}`);
            if (r.counter) {
                const agree = (r.winner?.foodId ?? null) === (r.counter.winner?.foodId ?? null);
                say(`      CF    ${agree ? 'AGREE' : 'DISAGREE'}  rerank-would-have-picked: ${fmtWinner(r.counter.winner)}`);
            }
            for (const n of r.notes) say(`      note  ${n}`);
            if (r.error) say(`      ERR   ${r.error}`);
        }
    }
}

function fmtWinner(w: WinnerInfo | null): string {
    if (!w) return '(no winner)';
    const brand = w.brandName ? ` [${w.brandName}]` : '';
    const p = w.panel;
    const pan = p
        ? `${p.kcal.toFixed(0)}kcal ${p.protein.toFixed(1)}P ${p.carbs.toFixed(1)}C ${p.fat.toFixed(1)}F${p.per100g ? '/100g' : ' (NOT per100g)'}`
        : 'no-nutrition';
    return `${w.source}:${w.foodId} "${w.foodName}"${brand}  ${pan}  conf=${w.confidence.toFixed(3)} reason=${w.selectionReason} idx=${w.indexInFiltered}`;
}

function fmtServing(s: ServingInfo | null | undefined): string {
    if (s === undefined) return '(stage not run)';
    if (s === null) return '(no serving)';
    if (s.error) return `(ERROR: ${s.error})`;
    const g = s.grams == null ? '?g' : `${s.grams.toFixed(1)}g`;
    const k = s.totalKcal == null ? '?kcal' : `${s.totalKcal.toFixed(0)}kcal`;
    return `${g} ${k} ${s.servingTier ?? '-'}${s.aiTouched ? ' (AI)' : ''}`;
}

// ============================================================
// 11. NOISE FLOOR
// ============================================================

function receiptPath(snapPath: string): string {
    return snapPath.replace(/\.json$/, '') + '.noise-floor.json';
}

function readLedger(p: string): NoiseFloorLedger | null {
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')) as NoiseFloorLedger; } catch { return null; }
}

/**
 * Replay the SAME variant on the SAME snapshot TWICE and assert 0 winner changes.
 *
 * Two different numbers must never be confused:
 *   replayNoise     same snapshot + same tree. MUST be 0. This is what we measure.
 *   retrievalNoise  DIFFERENT snapshots + same tree. Genuinely non-zero and NOT a
 *                   bug — Typesense/FatSecret return different pools minutes apart.
 * A scratch log once labelled a cross-snapshot run "the harness NOISE FLOOR. Expect
 * 0 changed rows" and reported 2 changes; both statements cannot be true, and the
 * label was the wrong one.
 */
async function runNoiseFloor(
    snapPath: string, variant: SelectionVariant, debug: boolean, allowDrift: boolean, withServing = false,
) {
    const snap: SnapshotFile = readSnapshot(snapPath);
    const a = await buildReplay(snap, 'noise-1', variant, debug, allowDrift, withServing);
    const b = await buildReplay(snap, 'noise-2', variant, debug, allowDrift, withServing);

    const byQ = new Map(b.file.rows.map(r => [r.query, r]));
    let winnerDiffs = 0;
    let pathDiffs = 0;
    let servingDiffs = 0;
    const offenders: string[] = [];
    for (const ra of a.file.rows) {
        const rb = byQ.get(ra.query);
        if (!rb) { winnerDiffs++; offenders.push(`${ra.query}: MISSING in the second replay`); continue; }
        const wa = ra.winner?.foodId ?? null;
        const wb = rb.winner?.foodId ?? null;
        if (wa !== wb) { winnerDiffs++; offenders.push(`${ra.query}: winner ${wa} -> ${wb}`); }
        if (ra.path !== rb.path) { pathDiffs++; offenders.push(`${ra.query}: path ${ra.path} -> ${rb.path}`); }
        if (withServing) {
            // AI-estimated tiers are nondeterministic BY DESIGN; counting them here
            // would make the floor permanently non-zero and the gate unusable. They
            // are excluded from the floor and reported as UNJUDGED in every diff, so
            // the exclusion can never be mistaken for clearance.
            const v = classifyServing(ra, rb);
            if (v !== 'SERVING-SAME' && v !== 'AI-NONDETERMINISTIC' && v !== 'UNJUDGED') {
                servingDiffs++;
                offenders.push(`${ra.query}: serving ${ra.serving?.grams ?? '-'}g/${ra.serving?.servingTier ?? '-'} -> ${rb.serving?.grams ?? '-'}g/${rb.serving?.servingTier ?? '-'}`);
            }
        }
    }

    const receipt: NoiseFloorReceipt = {
        kind: 'winner-diff/noise-floor',
        version: 1,
        ranAt: new Date().toISOString(),
        snapshotTakenAt: snap.takenAt,
        gitHead: a.file.gitHead,
        gitDirty: a.file.gitDirty,
        variant,
        rows: a.file.rows.length,
        winnerDiffs,
        pathDiffs,
        ...(withServing ? { withServing: true, servingDiffs } : {}),
    };

    const rp = receiptPath(snapPath);
    const ledger = readLedger(rp) ?? emptyLedger();
    ledger.receipts = ledger.receipts
        .filter(r => !(r.snapshotTakenAt === receipt.snapshotTakenAt && r.gitDirty === receipt.gitDirty && r.variant === receipt.variant))
        .concat(receipt);
    writeJsonAtomic(rp, ledger);

    say('');
    say('================================================================================');
    say('NOISE FLOOR  (replayNoise: same snapshot, same tree, same variant — MUST be 0)');
    say(`  snapshot ${snap.takenAt}   tree ${receipt.gitDirty}   variant ${variant}`);
    say(`  rows ${receipt.rows}   winner-diffs ${receipt.winnerDiffs}   path-diffs ${receipt.pathDiffs}`
        + (withServing ? `   serving-diffs ${servingDiffs}` : '   (serving stage NOT run)'));
    if (winnerDiffs === 0 && pathDiffs === 0 && servingDiffs === 0) {
        say('  RESULT: 0 — the replay is deterministic on this tree. A diff run may proceed.');
    } else {
        say('  RESULT: NON-ZERO. !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        say('  The replay is NOT deterministic on this tree, so any A/B number would be');
        say('  noise plus signal with no way to separate them. Do NOT report a diff. Fix');
        say('  the nondeterminism (shared mutable candidate objects are the usual cause —');
        say('  check the per-row JSON.parse(JSON.stringify(...)) deep copy) and re-run.');
        for (const o of offenders.slice(0, 40)) say(`    ${o}`);
        if (offenders.length > 40) say(`    ... and ${offenders.length - 40} more`);
    }
    say(`  receipt written: ${rp}`);
    say('  NOTE: this is NOT retrievalNoise. Snapshotting the same population twice and');
    say('        diffing those replays measures Typesense/FatSecret nondeterminism, which');
    say('        is a different, genuinely non-zero number.');
    say('================================================================================');

    if (winnerDiffs !== 0 || pathDiffs !== 0 || servingDiffs !== 0) process.exitCode = 1;
}

// ============================================================
// 12. DIFF
// ============================================================

function runDiff(aPath: string, bPath: string, opts: {
    screens: boolean; crossSnapshot: boolean; top: number; jsonOut?: string; goldenPath?: string;
}) {
    const A: ReplayFile = JSON.parse(fs.readFileSync(aPath, 'utf8'));
    const B: ReplayFile = JSON.parse(fs.readFileSync(bPath, 'utf8'));

    // The noise floor is a PRECONDITION, not a footnote. Without it the number
    // below has no denominator.
    const ledgerPath = receiptPath(guessSnapshotPath(A, aPath));
    const ledger = readLedger(ledgerPath);
    const gate = noiseGate(ledger, A, B, { crossSnapshot: opts.crossSnapshot });

    say('');
    say('================================================================================');
    say(`WINNER DIFF   A=[${A.label}] ${A.variant} ${A.gitHead}/${A.gitDirty}   B=[${B.label}] ${B.variant} ${B.gitHead}/${B.gitDirty}`);
    say(`snapshot: A ${A.snapshotTakenAt}   B ${B.snapshotTakenAt}`);
    say(`population: ${A.snapshotPopulation}`);
    say('================================================================================');

    if (!gate.ok) {
        say('');
        say('REFUSING TO REPORT — the noise floor is not established:');
        for (const p of gate.problems) say(`  * ${p}`);
        say('');
        say(`  (looked for receipts in ${ledgerPath})`);
        process.exitCode = 2;
        return;
    }
    say(`noise floor: A ${gate.receiptA!.winnerDiffs}/${gate.receiptA!.rows} winner diffs, ` +
        `B ${gate.receiptB!.winnerDiffs}/${gate.receiptB!.rows} — both 0, so the numbers below are signal.`);
    if (A.snapshotTakenAt !== B.snapshotTakenAt) {
        say('');
        say('*** RETRIEVAL-NOISE-CONTAMINATED: A and B replayed DIFFERENT snapshots. Some of');
        say('*** the changes below are Typesense/FatSecret returning a different pool, not');
        say('*** your code. Do not quote this as a clean winner diff.');
    }
    if (A.gitDirty === B.gitDirty && A.variant === B.variant) {
        say('NOTE: identical tree AND identical variant — this run is itself a noise-floor check.');
    }

    const byQ = new Map(B.rows.map(r => [r.query, r]));
    const counts: Record<Verdict, number> = {
        'SAME': 0, 'WINNER-CHANGED': 0, 'NOWINNER->WINNER': 0, 'WINNER->NOWINNER': 0, 'PATH-CHANGED': 0, 'ERROR': 0,
    };
    let movement = 0;
    const pairs: ScreenPair[] = [];
    const changedRows: Array<{ a: ReplayRow; b: ReplayRow; verdict: Verdict }> = [];

    for (const a of A.rows) {
        const b = byQ.get(a.query);
        if (!b) { say(`  ${a.query}: MISSING IN B`); counts.ERROR++; continue; }
        const verdict = classifyVerdict(a, b);
        counts[verdict]++;
        pairs.push({ query: a.query, a: a.winner, b: b.winner });
        if (!rowHasMovement(a, b)) continue;
        movement++;
        changedRows.push({ a, b, verdict });
    }

    for (const { a, b, verdict } of changedRows.slice(0, opts.top)) {
        const churn = windowChurn(a, b);
        const poolDelta = b.pool.admitted - a.pool.admitted;
        say('');
        say(`  [${verdict}] ${a.query}${a.goldenId ? `   (golden ${a.goldenId})` : ''}${a.origin === 'warmer' ? '   (warmer-shaped line)' : ''}`);
        say(`     pool admitted ${a.pool.admitted} -> ${b.pool.admitted} (${poolDelta >= 0 ? '+' : ''}${poolDelta})   ` +
            `token ${a.pool.afterTokenFilter}->${b.pool.afterTokenFilter}   relaxed ${a.relaxedRecovery}->${b.relaxedRecovery}`);
        if (windowChurnIsMeaningless(a, b)) {
            say(`     rerank window ${a.pool.rerankWindow} -> ${b.pool.rerankWindow}   !! rerank ${a.rerankRan ? 'RAN -> SKIPPED' : 'SKIPPED -> RAN'} ` +
                '— the window was never BUILT on one side, so there is no eviction to report');
        } else {
            say(`     rerank window ${a.pool.rerankWindow} -> ${b.pool.rerankWindow}   ` +
                `EVICTED ${churn.evicted.length} ${churn.evicted.slice(0, 6).join(',')}   ADDED ${churn.added.length} ${churn.added.slice(0, 6).join(',')}`);
        }
        say(`     path  ${a.path} -> ${b.path}    gate ${a.gate.reason} -> ${b.gate.reason}`);
        say(`     A win ${fmtWinner(a.winner)}`);
        say(`     B win ${fmtWinner(b.winner)}`);
        const d = kcalDeltaPct(a.winner, b.winner);
        if (d != null && a.winner && b.winner && a.winner.foodId !== b.winner.foodId) {
            say(`     kcal/100g ${a.winner.panel!.kcal} -> ${b.winner.panel!.kcal}  (${d >= 0 ? '+' : ''}${d.toFixed(1)}%)`);
        }
        // The BILLED number, printed next to the winner change that caused it. A
        // winner can move to the correct record and still bill worse — that is not
        // a hypothetical, it is what PR #173 shipped.
        if (A.withServing && B.withServing) {
            say(`     BILLED ${fmtServing(a.serving)}  ->  ${fmtServing(b.serving)}   [${classifyServing(a, b)}]`);
        }
    }
    if (changedRows.length > opts.top) {
        say('');
        say(`  ... ${changedRows.length - opts.top} more moved rows suppressed (--top ${opts.top})`);
    }

    say('');
    say('--------------------------------------------------------------------------------');
    say('VERDICT COUNTS');
    for (const k of VERDICTS) say(`  ${k.padEnd(18)} ${counts[k]}`);
    say(`  rows with ANY movement (winner, pool or rerank window): ${movement} / ${A.rows.length}`);
    say('--------------------------------------------------------------------------------');

    // The serving section is printed for EVERY run, including the ones where the
    // stage did not run. When it did not, it says so in one line instead of being
    // absent — an absent section reads as "nothing to report", which is the exact
    // misreading that let a winner-only gate clear a worse billed number.
    if (A.withServing && B.withServing) {
        sayAll(formatServingSummary(summariseServing(A.rows, B.rows), opts.top));
    } else {
        say('');
        say('=== SERVING DIFF — NOT RUN ===');
        say('  Neither replay carried the serving stage, so this run says NOTHING about');
        say('  what the user is billed. A winner can move onto the CORRECT record and the');
        say('  billed number can still get worse (PR #173: mac and cheese, 90.4 -> 39.5 kcal');
        say('  against a true ~400, because the 28g anchor never moved).');
        say('  Re-run both replays with --with-serving to gate the billed number.');
    }

    if (opts.screens) sayAll(formatScreens(runScreens(pairs, A.label, B.label), opts.top));

    if (opts.goldenPath) {
        // runGoldenScreen, NOT the old reportGoldenBands. The old one compared the
        // two sides' verdicts and printed "no golden case changed verdict" when they
        // matched — which silently swallowed every case whose only assertion is a
        // band the replay cannot evaluate, because UNKNOWN == UNKNOWN. That is the
        // majority of the golden set, and it is the exact blindness this screen was
        // written to remove; leaving the old call site in place would have shipped
        // the fix as dead code.
        const goldenCases = parseGoldenSet(
            JSON.parse(fs.readFileSync(opts.goldenPath, 'utf8')),
            { includeMultiItem: true },
        );
        sayAll(formatGoldenScreen(runGoldenScreen(goldenCases, A.rows, B.rows), opts.top));
    }

    say('');
    say('REMINDER — a SAME verdict does NOT clear the change. This gate is blind to:');
    say('  (a) retrieval effects (the gather output is frozen);');
    if (A.withServing && B.withServing) {
        say('  (b) PARTLY CLOSED this run — hydration and serving resolution DID run and are');
        say('      reported in the SERVING DIFF above. Still unseen: AI backfill determinism,');
        say('      the save-time plausibility and brand-mismatch gates, and the write itself.');
    } else {
        say('  (b) everything after winner selection — hydration, serving resolution, AI');
        say('      backfill, the save-time plausibility and brand-mismatch gates, the write.');
        say('      Re-run with --with-serving to close the serving half of this.');
    }
    say('  (c) warm-key behaviour (skipCache is forced, so this is COLD resolution);');
    say('  (d) any case the change is supposed to CREATE — a --from-events or --from-cache');
    say('      population contains only queries that were already asked. Pair this with a');
    say('      hand-written positive case list that asserts the RIGHT answer.');
    say('');

    if (opts.jsonOut) {
        writeJsonAtomic(opts.jsonOut, {
            kind: 'winner-diff/diff', version: 1, ranAt: new Date().toISOString(),
            a: { label: A.label, variant: A.variant, gitHead: A.gitHead, gitDirty: A.gitDirty },
            b: { label: B.label, variant: B.variant, gitHead: B.gitHead, gitDirty: B.gitDirty },
            snapshotTakenAt: A.snapshotTakenAt, population: A.snapshotPopulation,
            noiseFloor: { a: gate.receiptA, b: gate.receiptB },
            counts, movement, rows: A.rows.length,
            screens: runScreens(pairs, A.label, B.label),
            changed: changedRows.map(({ a, b, verdict }) => ({ query: a.query, verdict, a, b })),
        });
        say(`diff json written: ${opts.jsonOut}`);
    }
}

/** Where the snapshot that produced this replay lives, for the receipt lookup. */
/**
 * Where the receipt ledger for this replay lives.
 *
 * A replay now RECORDS the snapshot it was replayed from, so in the normal case
 * there is nothing to guess. The guessing below is the pre-2026-07-27 fallback and
 * it had a bug worth remembering: it only resolved when the directory held EXACTLY
 * ONE .noise-floor.json. A gate run with both a cold and a regression population
 * writes two, so it silently fell through to "snapshot.json" — a file that never
 * exists — and `diff` refused to report with a message pointing at a path nothing
 * had ever written. That failure looks exactly like a missing noise floor, which
 * is the one message in this harness you least want to be spurious.
 */
function guessSnapshotPath(f: ReplayFile, replayPath: string): string {
    const explicit = argStr('snapshot');
    if (explicit) return explicit;
    if (f.snapshotPath && fs.existsSync(receiptPath(f.snapshotPath))) return f.snapshotPath;
    const dir = path.dirname(replayPath);
    const guesses = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith('.noise-floor.json')) : [];
    if (guesses.length === 1) return path.join(dir, guesses[0].replace(/\.noise-floor\.json$/, '.json'));
    return path.join(dir, 'snapshot.json');
}

// ============================================================
// 13. COUNTERFACTUAL — one replay, no B tree
// ============================================================

function runCounterfactual(replayPath: string, top: number) {
    const f: ReplayFile = JSON.parse(fs.readFileSync(replayPath, 'utf8'));
    if (f.variant !== 'baseline') {
        say(`NOTE: variant=${f.variant}. The counterfactual lens only populates on 'baseline',`);
        say('      where the gate pre-empts Step 4. Nothing to report.');
    }
    const s = counterfactualSummary(f.rows);
    say('');
    say('================================================================================');
    say(`CONFIDENCE-GATE COUNTERFACTUAL   [${f.label}] variant=${f.variant} tree=${f.gitDirty}`);
    say(`snapshot ${f.snapshotTakenAt}   population: ${f.snapshotPopulation}`);
    say('================================================================================');
    say(`EARLY-EXIT POPULATION: ${s.earlyExit} of ${s.rows} rows (${s.earlyExitPct.toFixed(1)}%)`);
    if (s.earlyExit === 0) { say('  (the gate never fired on this population)'); return; }
    say(`   gate winner == rerank winner (AGREE):    ${String(s.agree).padStart(5)}  (${((100 * s.agree) / s.earlyExit).toFixed(1)}%)`);
    say(`   gate winner != rerank winner (DISAGREE): ${String(s.disagree).padStart(5)}  (${((100 * s.disagree) / s.earlyExit).toFixed(1)}%)`);
    say(`   rerank would have DECLINED (no winner):  ${String(s.rerankDeclined).padStart(5)}  (${((100 * s.rerankDeclined) / s.earlyExit).toFixed(1)}%)`);
    say('   ^ the declined row is load-bearing for any "demote the gate to a backstop"');
    say('     proposal: at 0 the reranker never abstains where the gate fires, so the');
    say('     demotion cannot manufacture a no-winner fall-through into AI backfill.');
    say('');
    say('exit reason -> disagreement rate');
    for (const [k, v] of s.byReason) say(`   ${k.padEnd(34)} ${String(v.disagree).padStart(4)}/${String(v.total).padStart(4)}`);
    if (s.medianCounterMicros != null) {
        say('');
        say(`median wall time of the Step 4 the gate skipped: ${s.medianCounterMicros.toFixed(0)} us`);
        say('   (simpleRerank is pure and synchronous — `grep -c "await " simple-rerank.ts`');
        say('    is 0 — so this is the entire cost the gate avoids. Measure it; do not');
        say('    assert it. CORRECTED 2026-07-26: this line used to claim "there is no LLM');
        say('    in src/lib/mapping", which is false. ai-rerank.ts IS a full');
        say('    OpenAI-compatible client, and map-ingredient-with-fallback.ts awaits');
        say('    aiSimplifyIngredient in the same file that carried the denial. The true');
        say('    claim is narrower: nothing on the gate/rerank path awaits an LLM.)');
    }
    sayAll(formatScreens(runScreens(s.pairs, 'GATE', 'RERANK'), top));
    say('');
    say('LIMIT: `counter` is a COUNTERFACTUAL, not an outcome. It shows what simpleRerank');
    say('WOULD have returned on the frozen pool. It never shows which pick is CORRECT.');
    say('Two of the three mechanical screens were a wash on the original read (kcal');
    say('direction 117/114, Atwater 6/4); only class drift was asymmetric (53/2).');
}

// ============================================================
// 14. VERIFY — the only mode that proves the transcription faithful
// ============================================================

/**
 * Run the REAL mapper end to end with the gather interceptor in record-and-continue
 * mode, then replay the captured pool through replaySelection() and compare the
 * selection on TWO axes: foodId, and (on rows where foodId agreed) confidence.
 *
 * Buckets:
 *   MATCH                the transcription reproduced the real pipeline's foodId
 *   MISMATCH-EXPLAINED   the mapper's own telemetry shows a POST-SELECTION override
 *                        (save-gate rejection, AI backfill, no_match). Selection
 *                        agreed; something after Step 4 changed the answer.
 *   MISMATCH-UNEXPLAINED a transcription bug. MUST BE 0.
 *   NO-GATHER            the full gather never ran (fast path / cache / early error);
 *                        there is nothing to compare.
 *
 * WHY CONFIDENCE IS COMPARED AT ALL (added 2026-07-26, and it is not decoration).
 * Until the Mitigation-A revert, the gate-backstop caller differed from the baseline
 * in a way that MOVED RECORDS, so a foodId-only verify could go red on it and was
 * demonstrated to (stubbing the mitigations produced 6 MISMATCH-UNEXPLAINED). After
 * the revert the ONLY things `backstop` still changes on a row where the reranker
 * names someone are the confidence lift and its scope — and neither moves a foodId.
 * A foodId-only verify is therefore STRUCTURALLY INCAPABLE of failing on Mitigation
 * B, for every possible population: it is not that the population is too small, it
 * is that the comparison does not look at the field. That is exactly the shape of
 * "a green receipt from a test that cannot fail", so the comparison was widened
 * rather than the population.
 *
 * The confidence axis is deliberately restricted to rows that already MATCHED on
 * foodId: two different records have two incomparable confidences, and comparing
 * them would manufacture noise on precisely the rows that are already reported.
 *
 * CONF-DIVERGED is NOT automatically a transcription bug — the mapper can legally
 * rewrite `confidence` after Step 4 (the AI-simplify fallback, the dietary fallback
 * and the AI-generated path all assign their own), so a diverged row on a
 * non-`rerank`/`confidence_gate_*` funnel stage is expected. Rows where the mapper
 * returned the Step 4 record untouched are the ones that must agree, and those are
 * counted separately as CONF-UNEXPLAINED, which MUST BE 0.
 */
/** Absolute tolerance for the confidence comparison — float noise only, not slack. */
const CONF_EPSILON = 1e-6;
async function runVerify(pop: PopulationLine[], variant: SelectionVariant, debug: boolean, allowDrift: boolean, outPath?: string) {
    const drift = checkDrift(allowDrift);
    announceVariantFit(drift, variant);
    if (drift.treeVariant !== variant) {
        say('');
        say('REFUSING: `verify` compares the transcription against the REAL mapper running in');
        say('this tree. Verifying a variant the tree does not contain would compare the copy');
        say(`against code that is not here. Run this in a tree whose caller is '${variant}',`);
        say(`or verify --variant ${drift.treeVariant ?? '<the tree\'s shape>'} instead.`);
        process.exitCode = 2;
        return;
    }
    installWriteGuard();

    const sink = { capture: null as GatherCapture | null };
    const aiSink: AiSink = { llm: null, cache: null };
    const restoreGather = installGatherInterceptor('continue', sink);
    const restoreAi = installAiInterceptors(aiSink);

    const results: any[] = [];
    let match = 0;
    let explained = 0;
    let unexplained = 0;
    let noGather = 0;
    let confMatch = 0;
    let confRewritten = 0;
    let confUnexplained = 0;
    const confDiverged: any[] = [];
    // ONE budget for the whole sweep, shared by every query (see warm-names.ts).
    const servingNutritionBudget = createAiNutritionBudget(AI_NUTRITION_MAX_PER_BATCH);

    for (let i = 0; i < pop.length; i++) {
        const p = pop[i];
        sink.capture = null; aiSink.llm = null; aiSink.cache = null;
        suppressedWrites = {};
        const telemetry: MappingTelemetry = {};
        let real: any = null;
        let err: string | undefined;
        muzzle(true);
        try {
            real = await mapperMod.mapIngredientWithFallback(p.query, {
                skipCache: true, debug, allowLiveFallback: true, skipOnLock: true, telemetry,
                aiNutritionBudget: servingNutritionBudget,
            });
        } catch (e: any) {
            err = e?.message ?? String(e);
        }
        muzzle(false);

        const c = takeCapture(sink);
        if (!c) {
            noGather++;
            results.push({ query: p.query, bucket: 'NO-GATHER', funnelStage: telemetry.funnelStage, error: err });
            say(`  [${i + 1}/${pop.length}] NO-GATHER   ${p.query}   (funnel=${telemetry.funnelStage ?? '?'})`);
            continue;
        }

        const entry: SnapshotEntry = {
            query: p.query, origin: p.origin, goldenId: p.goldenId, ok: true,
            gatherRawLine: c.gatherRawLine, trimmed: c.gatherRawLine.trim(),
            parsed: c.parsed, normalizedName: c.normalizedName,
            isBrandedQuery: c.isBrandedQuery, targetBrand: c.targetBrand, aiSynonyms: c.aiSynonyms,
            ...resolveAiEstimate(aiSink),
            candidates: c.candidates, suppressedWrites: { ...suppressedWrites }, elapsedMs: 0,
        };
        await preEnrichAiGenerated([entry]);
        const row = replaySelection(entry, debug, variant);

        const realId: string | null = real && typeof real === 'object' && 'foodId' in real ? String(real.foodId) : null;
        const replayId = row.winner?.foodId ?? null;

        let bucket: string;
        if (realId === replayId) { bucket = 'MATCH'; match++; }
        else {
            // A post-selection override is the only benign explanation.
            const stage = telemetry.funnelStage;
            const postSelection =
                stage === 'save_rejected' || stage === 'no_match' || stage === 'error' ||
                stage === 'all_filtered' || stage === 'no_candidates' || stage === 'fast_path' ||
                stage === 'cache_hit' ||
                // AI backfill invented a record that was never in the pool
                (realId != null && !entry.candidates.some(x => x.id === realId));
            if (postSelection) { bucket = 'MISMATCH-EXPLAINED'; explained++; }
            else { bucket = 'MISMATCH-UNEXPLAINED'; unexplained++; }
        }

        // ---- CONFIDENCE AXIS (only meaningful where the record already agreed) ----
        const realConf: number | null =
            real && typeof real === 'object' && typeof (real as any).confidence === 'number'
                ? (real as any).confidence : null;
        const replayConf: number | null = row.winner?.confidence ?? null;
        let confBucket: string | null = null;
        if (bucket === 'MATCH' && realConf != null && replayConf != null) {
            if (Math.abs(realConf - replayConf) <= CONF_EPSILON) { confBucket = 'CONF-MATCH'; confMatch++; }
            else {
                // The mapper legally reassigns `confidence` on the paths that build
                // their own result (AI simplify, dietary fallback, ai_generated).
                // Those are not transcription bugs. The rows that MUST agree are the
                // ones where Step 4's own winner was carried to the return: the
                // replay resolved through a Step 4 path AND the funnel stage is one of
                // the three that a Step 4 winner can end on.
                const step4Path = row.path === 'rerank' || row.path === 'confidence_gate_backstop'
                    || row.path === 'confidence_gate_early_exit' || row.path === 'scored_by_confidence';
                const step4Stage = telemetry.funnelStage === 'saved'
                    || telemetry.funnelStage === 'under_gate' || telemetry.funnelStage === 'save_rejected';
                if (step4Path && step4Stage) { confBucket = 'CONF-UNEXPLAINED'; confUnexplained++; }
                else { confBucket = 'CONF-REWRITTEN'; confRewritten++; }
                confDiverged.push({
                    query: p.query, realConf, replayConf, funnelStage: telemetry.funnelStage ?? null,
                    gateReason: row.gate.reason, gateFired: row.gate.skipAiRerank,
                    path: row.path, confBucket,
                });
            }
        }

        results.push({
            query: p.query, bucket, realId, replayId,
            realName: real?.foodName ?? null, replayName: row.winner?.foodName ?? null,
            realSource: real?.source ?? null, funnelStage: telemetry.funnelStage,
            dropReason: telemetry.dropReason, path: row.path, gate: row.gate, error: err,
            realConf, replayConf, confBucket,
        });
        say(`  [${i + 1}/${pop.length}] ${bucket.padEnd(20)} ${(confBucket && confBucket !== 'CONF-MATCH' ? confBucket : '').padEnd(17)} ${p.query}` +
            (bucket === 'MATCH' ? '' : `   real=${realId} (${real?.foodName ?? '-'})  replay=${replayId} (${row.winner?.foodName ?? '-'})  funnel=${telemetry.funnelStage ?? '?'}`) +
            (confBucket && confBucket !== 'CONF-MATCH' ? `   conf real=${realConf?.toFixed(3)} replay=${replayConf?.toFixed(3)} funnel=${telemetry.funnelStage ?? '?'}` : ''));
    }

    restoreGather();
    restoreAi();

    say('');
    say('================================================================================');
    say(`TRANSCRIPTION VERIFY   variant=${variant}   tree=${gitDirtyHash()}`);
    say(`  MATCH                 ${match}`);
    say(`  MISMATCH-EXPLAINED    ${explained}   (post-selection override: save gate / AI backfill / no_match)`);
    say(`  MISMATCH-UNEXPLAINED  ${unexplained}   <- MUST BE 0`);
    say(`  NO-GATHER             ${noGather}   (fast path or cache; nothing to compare)`);
    say('  --- confidence axis, over the MATCH rows only ---');
    say(`  CONF-MATCH            ${confMatch}`);
    say(`  CONF-REWRITTEN        ${confRewritten}   (mapper reassigned confidence after Step 4)`);
    say(`  CONF-UNEXPLAINED      ${confUnexplained}   <- MUST BE 0`);
    say('================================================================================');
    for (const d of confDiverged) {
        say(`  ${d.confBucket.padEnd(17)} ${d.query}  real=${d.realConf?.toFixed(3)} replay=${d.replayConf?.toFixed(3)}` +
            `  funnel=${d.funnelStage ?? '?'}  path=${d.path}  gate=${d.gateFired ? d.gateReason : 'off'}`);
    }
    if (unexplained > 0) {
        say('The transcription in section 9 does NOT reproduce the real pipeline. Every');
        say('number this harness produces is suspect until that is 0.');
        process.exitCode = 1;
    }
    if (confUnexplained > 0) {
        say('The transcription agrees on the RECORD but not on the CONFIDENCE the caller');
        say('assigned it, on a row the mapper carried straight out of Step 4. That is the');
        say('same class of bug as a moved winner — `confidence` is the cache-admission');
        say('signal — and it is what the confidence axis exists to catch.');
        process.exitCode = 1;
    }
    if (outPath) {
        writeJsonAtomic(outPath, {
            kind: 'winner-diff/verify', version: 2, ranAt: new Date().toISOString(),
            gitHead: gitHead(), gitDirty: gitDirtyHash(), variant,
            callerHash: checkDrift(true).caller,
            counts: { match, explained, unexplained, noGather, confMatch, confRewritten, confUnexplained },
            rows: results,
        });
        say(`verify receipt written: ${outPath}`);
    }
}

// ============================================================
// 15. TRANSCRIPT — eyeball the copy against the original in one command
// ============================================================

function runTranscript() {
    const cb = callerBlockSource();
    const self = fs.readFileSync(__filename.replace(/\.js$/, '.ts'), 'utf8').split('\n');
    const s = self.findIndex(l => l.includes('>>> TRANSCRIPTION BEGIN'));
    const eIdx = self.findIndex(l => l.includes('<<< TRANSCRIPTION END'));

    say('');
    say('================================================================================');
    say(`REAL CALLER — ${MAPPER_FILE} lines ${cb.startLine}-${cb.endLine}`);
    say(`  (hash ${sha(cb.text)} = variant '${KNOWN_CALLERS[sha(cb.text)] ?? 'UNRECOGNISED'}')`);
    say('================================================================================');
    cb.lines.forEach((l, i) => say(String(cb.startLine + i).padStart(6) + '  ' + l));
    say('');
    say('================================================================================');
    say('HARNESS TRANSCRIPTION — winner-diff.ts (between the TRANSCRIPTION anchors)');
    say('================================================================================');
    if (s < 0 || eIdx < 0) { say('  (anchors not found — is this file compiled/minified?)'); return; }
    self.slice(s, eIdx + 1).forEach((l, i) => say(String(s + 1 + i).padStart(6) + '  ' + l));
    say('');
    say('Diff these BY EYE. The drift hash only proves the left-hand side did not move;');
    say('`winner-diff verify` is the only mode that proves the right-hand side is right.');
}

// ============================================================
// 16. POPULATIONS
// ============================================================

async function buildPopulation(): Promise<{ lines: PopulationLine[]; description: string }> {
    const limit = argInt('limit') ?? 200;

    if (has('--from-file')) {
        const f = argStr('from-file');
        if (!f) throw new Error('--from-file needs a path');
        const lines = parseQueryFile(fs.readFileSync(f, 'utf8')).slice(0, limit);
        return {
            lines: lines.map(q => ({ query: q, origin: classifyOrigin(q) })),
            description: `--from-file ${f} (limit ${limit})`,
        };
    }

    if (has('--golden')) {
        const gp = argStr('golden-set') ?? path.join(REPO_ROOT, 'scripts/eval/golden-set.json');
        const includeMultiItem = has('--include-multi-item');
        const cases: GoldenCase[] = parseGoldenSet(JSON.parse(fs.readFileSync(gp, 'utf8')), { includeMultiItem })
            .slice(0, limit);
        return {
            lines: cases.map(c => ({ query: c.rawText, origin: 'user' as QueryOrigin, goldenId: c.id })),
            description: `--golden ${gp} (nlp cases${includeMultiItem ? ' incl. multi-item `text` lines' : ', single-item only'}, limit ${limit})`,
        };
    }

    if (has('--from-cache')) {
        const order = argStr('order') ?? 'used';
        const decorate = argStr('decorate');
        let rows: Array<{ normalizedForm: string; usedCount: number }>;
        if (order === 'random') {
            rows = await prisma.$queryRawUnsafe(
                'SELECT "normalizedForm", "usedCount" FROM "FoodMapping" ORDER BY random() LIMIT $1', limit);
        } else {
            rows = await prisma.foodMapping.findMany({
                select: { normalizedForm: true, usedCount: true },
                orderBy: order === 'recent' ? { lastUsedAt: 'desc' } : { usedCount: 'desc' },
                take: limit,
            });
        }
        const lines = rows.map(r => {
            const q = decorate ? decorate.replace('{key}', r.normalizedForm) : r.normalizedForm;
            return { query: q, origin: classifyOrigin(q), count: r.usedCount };
        });
        return { lines, description: `--from-cache order=${order} limit=${limit}${decorate ? ` decorate="${decorate}"` : ''}` };
    }

    // default: --from-events
    const sinceRaw = argStr('since') ?? '30d';
    const minCount = argInt('min-count') ?? 1;
    const days = parseInt(sinceRaw.replace(/[^0-9]/g, ''), 10) || 30;
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    // KNOWN LIMITATION: --min-count is applied AFTER the DB `take`, so a large
    // --min-count can return fewer than --limit rows even when enough qualifying
    // lines exist. The 3x over-fetch covers the common cases. If you need it exact,
    // move the predicate into a groupBy `having` — do not silently accept a short
    // population, because a population smaller than you asked for is a denominator
    // you did not choose.
    const grouped = await prisma.mappingEventLog.groupBy({
        by: ['rawLine'],
        where: { createdAt: { gte: since } },
        _count: { rawLine: true },
        orderBy: { _count: { rawLine: 'desc' } },
        take: limit * 3,
    });
    const lines = grouped
        .filter((g: any) => g._count.rawLine >= minCount)
        .slice(0, limit)
        .map((g: any) => ({ query: g.rawLine as string, origin: classifyOrigin(g.rawLine), count: g._count.rawLine }));
    return { lines, description: `--from-events since=${days}d min-count=${minCount} limit=${limit}` };
}

function printPopulationCaveat(desc: string, lines: PopulationLine[]) {
    const split = originSplit(lines.map(l => l.query));
    say('');
    say(`POPULATION: ${desc}   -> ${lines.length} queries`);
    say(`  origin split: user ${split.user}   warmer-shaped ${split.warmer} (${split.warmerPct.toFixed(1)}%)`);
    if (desc.startsWith('--from-events') || desc.startsWith('--from-cache')) {
        say('  CAVEAT: this population contains ONLY queries that have ALREADY BEEN ASKED.');
        say('  It therefore CANNOT see any case the change is supposed to CREATE — such a');
        say('  change will show SAME on 100% of rows because the query that would prove it');
        say('  is not here. Pair the diff with a hand-written positive case list.');
    }
    if (desc.startsWith('--from-events')) {
        say('  CAVEAT: MappingEventLog also holds lines our own warmers wrote —');
        say('  cache-parity-sweep.ts posts "100g <token-sorted FoodMapping key>". Word order');
        say('  is signal here (deriveMustHaveTokens is order-sensitive), so those exercise');
        say('  different filters than sentences users type.');
    }
    if (desc.startsWith('--from-cache')) {
        say('  CAVEAT: FoodMapping.normalizedForm is token-SORTED and singularized. Feeding');
        say('  keys back through the mapper is a legitimate PARITY population, but it is not');
        say('  the user distribution.');
    }
}

// ============================================================
// 17. plumbing
// ============================================================

function writeJsonAtomic(p: string, obj: unknown) {
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, p);
}

function readSnapshot(p: string): SnapshotFile {
    const s = JSON.parse(fs.readFileSync(p, 'utf8')) as SnapshotFile;
    if (s.kind !== 'winner-diff/snapshot') throw new Error(`${p} is not a winner-diff snapshot (kind=${(s as any).kind})`);
    return s;
}

function gitHead(): string {
    if (process.env.WINNER_DIFF_TREE_ID) return process.env.WINNER_DIFF_TREE_ID;
    try { return require('child_process').execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
    catch { return 'nogit'; }
}

/**
 * Identity of the code actually under test. NOT `git diff` — A/B trees are routinely
 * plain copies with no .git at all, where `git rev-parse` reports the wrong thing or
 * nothing. Hashing src/lib/mapping/*.ts means two replays with the same value provably
 * ran the same mapping code, which is exactly the property the noise floor needs.
 */
/**
 * Directories whose contents decide what a replay produces. `gitDirtyHash` is the
 * harness's answer to "did the two sides run the same code", and a directory left
 * out of it is a change the gate cannot tell apart from no change at all.
 *
 * src/lib/servings and the serving estimator joined the list on 2026-07-27, with
 * the serving stage. Before that, a fix living entirely in bare-query-guard.ts
 * produced an IDENTICAL tree hash on both sides: the BASE noise-floor receipt
 * satisfied the BRANCH, and the diff header announced "identical tree AND
 * identical variant — this run is itself a noise-floor check" about a run that
 * was nothing of the sort.
 */
const HASHED_SOURCE_PATHS = [
    'src/lib/mapping',
    'src/lib/servings',
    // The bare-query lexicon getBareQueryDefault() lives here; it decides grams.
    'src/lib/ai/ambiguous-serving-estimator.ts',
];

function gitDirtyHash(): string {
    try {
        const parts: string[] = [];
        for (const rel of HASHED_SOURCE_PATHS) {
            const p = path.join(REPO_ROOT, rel);
            if (!fs.existsSync(p)) continue;
            if (fs.statSync(p).isDirectory()) {
                for (const f of fs.readdirSync(p).sort()) {
                    if (!f.endsWith('.ts')) continue;
                    parts.push(rel + '/' + f + ':' + sha(fs.readFileSync(path.join(p, f), 'utf8')));
                }
            } else {
                parts.push(rel + ':' + sha(fs.readFileSync(p, 'utf8')));
            }
        }
        return sha(parts.join('\n')).slice(0, 8);
    } catch { return 'unknown'; }
}

function has(flag: string): boolean { return process.argv.includes(flag); }

function argStr(name: string): string | undefined {
    const eq = process.argv.find(a => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(name.length + 3);
    const i = process.argv.indexOf('--' + name);
    if (i < 0) return undefined;
    const v = process.argv[i + 1];
    return v && !v.startsWith('--') ? v : undefined;
}

function argInt(name: string): number | undefined {
    const v = argStr(name);
    if (v === undefined) return undefined;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
}

function resolveVariant(): SelectionVariant {
    const v = (argStr('variant') ?? 'baseline') as SelectionVariant;
    if (!VARIANTS.includes(v)) throw new Error(`--variant must be one of ${VARIANTS.join(' | ')}`);
    return v;
}

const HELP = `
winner-diff — frozen-pool WINNER diff for admission / ranking changes.   READ-ONLY.

MODES
  snapshot        Freeze the real gathered+filtered candidate pool per query.
                  Runs retrieval + LLM ONCE; every later replay shares it, so
                  retrieval nondeterminism cannot contaminate the diff.
  replay          Run selection over a frozen snapshot. Deterministic.
  noise-floor     Replay the SAME variant on the SAME snapshot twice and assert
                  0 winner differences. Writes the receipt \`diff\` requires.
  diff            Compare replay A vs replay B. Reports WINNER changes — never a
                  pool-set Jaccard, which is the measurement that hides
                  non-monotone consumers.
  counterfactual  One replay, no B tree: for every confidenceGate early exit,
                  what would simpleRerank have picked on the identical pool?
  verify          Run the REAL mapper end to end and compare the transcription's
                  selection with it on TWO axes: foodId, and confidence on the rows
                  whose foodId agreed. The only proof the transcription is faithful.
                  MISMATCH-UNEXPLAINED and CONF-UNEXPLAINED must both be 0.
                  (Confidence is not decoration: it is the cache-admission signal,
                  and since the Mitigation-A revert it is the ONLY axis on which the
                  gate-backstop caller differs from the baseline when the reranker
                  names a winner.)
  transcript      Print the real caller and this file's transcription side by side.
  hashes          Print the drift hashes.

POPULATION FLAGS  (snapshot, verify)
  --from-events [--since 30d] [--min-count N] [--limit N]      MappingEventLog.rawLine
  --from-cache  [--order used|recent|random] [--decorate "100g {key}"] [--limit N]
  --from-file <path>                                           newline list, # comments
  --golden [--golden-set <path>] [--include-multi-item]        scripts/eval/golden-set.json

  READ THIS BEFORE QUOTING A RATE: --from-events and --from-cache contain ONLY
  queries that have ALREADY BEEN ASKED. They therefore CANNOT see any case the
  change is supposed to CREATE — such a change shows SAME on 100% of rows because
  the query that would prove it is not in the population. That blind spot has
  invalidated a gate before. Always pair the diff with a hand-written positive case
  list that asserts the RIGHT answer (never one that merely forbids a wrong one).

  --from-events additionally mixes user traffic with lines our own warmers wrote
  ("100g <token-sorted FoodMapping key>", ~31% of the log on the last measured
  population). Rows are tagged \`origin\` and the split is printed.

COMMON FLAGS
  --variant baseline|gate-backstop   which selection shape to transcribe
  --debug        pass debug:true into the real filter (FilterResult reasons log)
  --verbose      do not muzzle library stdout; replay also prints every row
  --allow-drift  run even though the caller block moved (re-transcribe first)
  --top N        max rows printed per section (default 30)
  --screens      diff: print the class-drift / Atwater / kcal-delta screens
  --cross-snapshot  diff: accept A and B from DIFFERENT snapshots. The report is
                    then labelled RETRIEVAL-NOISE-CONTAMINATED, because some of the
                    changes are Typesense/FatSecret returning a different pool, not
                    your code. That is retrievalNoise, a different number from the
                    replay noise floor, and it is genuinely non-zero.
  --resume       snapshot: continue an interrupted run from the .ndjson sidecar

TYPICAL SEQUENCE
  RUN='npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/eval/winner-diff.ts'
  $RUN snapshot --from-events --limit 400 --out /tmp/wd-snap.json
  $RUN noise-floor --snapshot /tmp/wd-snap.json
  $RUN replay --snapshot /tmp/wd-snap.json --out /tmp/wd-A.json --label BASE
  # copy the tree, edit the COPY, run the same replay from there (NEVER
  # \`git checkout -- <file>\`: that silently discards uncommitted work)
  $RUN diff --a /tmp/wd-A.json --b /tmp/wd-B.json --screens --snapshot /tmp/wd-snap.json

READ-ONLY GUARANTEE
  A Prisma \$use middleware no-ops every create/update/upsert/delete/executeRaw and
  tallies what it suppressed. \`snapshot\` also aborts the mapper at gather, so the
  save path is never reached. Nothing here calls warm-cache or saveValidatedMapping.
`;

async function main() {
    let mode = process.argv[2];
    if (has('--noise-floor') && mode !== 'noise-floor') mode = 'noise-floor';
    const debug = has('--debug');
    const allowDrift = has('--allow-drift');
    const verbose = has('--verbose');
    const top = argInt('top') ?? 30;
    // Opt-in because it costs a DB round trip per row and, on rows that reach an
    // AI estimator, a model call. Opt-in is NOT "optional": a replay without it
    // cannot adjudicate the number the user sees, and the diff now says so.
    const withServing = has('--with-serving');

    if (!mode || mode === 'help' || mode === '--help' || mode === '-h') { say(HELP); return; }

    say(`winner-diff  mode=${mode}  repo=${REPO_ROOT}`);
    say(`env: ${ENV_FILES.join(', ')}   forced: ${Object.entries(FORCED_FLAGS).map(([k, v]) => k + '=' + v).join(' ')}`);
    say('READ-ONLY: every DB mutation is intercepted and no-oped; nothing is written to FoodMapping.');

    if (mode === 'snapshot') {
        const out = argStr('out');
        if (!out) throw new Error('snapshot needs --out <file>');
        checkDrift(true);
        const { lines, description } = await buildPopulation();
        printPopulationCaveat(description, lines);
        say('');
        say(`snapshotting ${lines.length} queries — the LLM and the FatSecret API WILL be called; writes are suppressed.`);
        await runSnapshot(lines, out, description, debug, has('--resume'));

    } else if (mode === 'replay') {
        const snapPath = argStr('snapshot');
        const out = argStr('out');
        if (!snapPath || !out) throw new Error('replay needs --snapshot <file> --out <file> [--label X]');
        const snap = readSnapshot(snapPath);
        const { file, enriched } = await buildReplay(snap, argStr('label') ?? 'unlabelled', resolveVariant(), debug, allowDrift, withServing, path.resolve(snapPath));
        writeJsonAtomic(out, file);
        printReplaySummary(file, enriched, verbose);
        say('');
        say(`replay written: ${out}`);

    } else if (mode === 'noise-floor' || mode === 'noise') {
        const snapPath = argStr('snapshot');
        if (!snapPath) throw new Error('noise-floor needs --snapshot <file>');
        await runNoiseFloor(snapPath, resolveVariant(), debug, allowDrift, withServing);

    } else if (mode === 'diff') {
        const a = argStr('a');
        const b = argStr('b');
        if (!a || !b) throw new Error('diff needs --a <replayA.json> --b <replayB.json>');
        runDiff(a, b, {
            screens: has('--screens'),
            crossSnapshot: has('--cross-snapshot'),
            top,
            jsonOut: argStr('json'),
            goldenPath: has('--golden') ? (argStr('golden-set') ?? path.join(REPO_ROOT, 'scripts/eval/golden-set.json')) : undefined,
        });

    } else if (mode === 'counterfactual') {
        const r = argStr('replay');
        if (!r) throw new Error('counterfactual needs --replay <replay.json>');
        runCounterfactual(r, top);

    } else if (mode === 'verify') {
        const { lines, description } = await buildPopulation();
        printPopulationCaveat(description, lines);
        say('');
        say('verify runs the FULL mapper (LLM + API calls). Writes remain suppressed.');
        await runVerify(lines, resolveVariant(), debug, allowDrift, argStr('out'));

    } else if (mode === 'transcript') {
        runTranscript();

    } else if (mode === 'hashes') {
        const d = checkDrift(true);
        const cb = callerBlockSource();
        say(`caller=${d.caller}  helpers=${d.helpers}  callerLines=${cb.startLine}-${cb.endLine}  mappingDir=${gitDirtyHash()}`);
        say(`known callers: ${Object.entries(KNOWN_CALLERS).map(([h, v]) => `${h}=${v}`).join('  ')}`);
        say(`this tree is: ${d.treeVariant ?? 'UNRECOGNISED'}   helpers ${d.helpers === PINNED_HELPERS_HASH ? 'match' : 'DRIFTED'}`);

    } else {
        say(HELP);
        process.exitCode = 2;
    }
}

// Only run when invoked as a script. Importing this file (e.g. from a test) must
// not execute a full run — that is exactly how the abstention hole in run-eval.ts
// stayed invisible.
if (require.main === module) {
    main()
        .then(async () => { muzzle(true); try { await prisma.$disconnect(); } catch { /* noop */ } muzzle(false); process.exit(process.exitCode ?? 0); })
        .catch(async (e) => { muzzle(false); say('FATAL: ' + (e?.stack ?? e?.message ?? String(e))); try { await prisma.$disconnect(); } catch { /* noop */ } process.exit(1); });
}

export { replaySelection, mkWinner };
export type { SnapshotEntry, SnapshotFile };
