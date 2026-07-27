/**
 * triage-drops.ts — F3: the warm-and-triage driver.
 *
 * warm JSONL (or MappingEventLog) -> keep only the DROP stages -> probe each
 * distinct query -> merge into ONE dossier -> classify with F2 -> emit
 * `scripts/eval/results/triage-verdicts-<ts>.json` + a sibling `.md`.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT WRITES
 * ---------------------------------------------------------------------------
 * Its own two report files, and nothing else. It NEVER calls
 * mapIngredientWithFallback, so it cannot warm, overwrite, evict or repoint a
 * FoodMapping row, and it writes no MappingEventLog rows. The two probes it runs
 * (retrieval + filter trace) are search + pure token logic.
 *
 * Two side-effect edges, both closed by default:
 *   - The FatSecret lane background-upserts FatSecretFood/FatSecretServing and
 *     spends FS API quota. `FATSECRET_RETRIEVAL_ENABLED=false` is therefore forced
 *     BEFORE the probe modules load unless you pass `--fatsecret`.
 *   - full-pipeline-probe.ts / golden-diff-eval.ts / warm-names.ts DO write and DO
 *     cost LLM tokens. This driver never calls them; they are separate CLIs.
 * No probe here makes an LLM call, so cost scales as search QPS, not tokens.
 *
 * ---------------------------------------------------------------------------
 * WHY THE OUTPUT LOOKS LIKE THE 2026-07-21 FILE
 * ---------------------------------------------------------------------------
 * `screened` / `suspectCount` / `confirmedCount` / `byClass` / `confirmed` /
 * `dismissed` are kept byte-compatible in meaning with
 * scripts/eval/results/triage-verdicts-2026-07-21.json (the 296-defect multi-agent
 * run), including the COARSE `cls` vocabulary (identity / serving / nutrition /
 * ingest-gap / ranking-gap) so existing readers keep working. Everything new is
 * additive: `classId` + `fixKind` carry the precise F2 class, and `dossier` carries
 * the evidence.
 *
 * ---------------------------------------------------------------------------
 * TRUNCATION IS ALWAYS REPORTED
 * ---------------------------------------------------------------------------
 * A per-class cap (`--per-class-cap`, default 25) stops one loud class from eating
 * the whole run. Every dossier the cap drops, every duplicate event collapsed, every
 * non-drop-stage row skipped and every row `--limit` cut off is counted into `log[]`
 * and printed. Silent truncation reads as "covered everything" when it did not.
 *
 * The same rule applies to what the tool CANNOT see: `scope` states which F2 classes,
 * which coarse `byClass` buckets and which actions are unreachable here, because a
 * bucket that is empty by construction otherwise reads as "we looked and found none".
 *
 * And numeric flags are VALIDATED, not coerced (`parseIntFlag`): `--concurrency 0`
 * used to build zero probe workers and `--limit abc` an empty row set, each producing
 * a clean-looking report of a run that never happened.
 *
 * Run (from repo root):
 *   # cheap mode: classify only, no retrieval at all
 *   npx ts-node -r tsconfig-paths/register --transpile-only --compilerOptions \
 *     '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/eval/triage-drops.ts --in scripts/eval/results/warm-<ts>.json --no-probes
 *
 *   # full triage with probes
 *   ... scripts/eval/triage-drops.ts --in <warm.json> --concurrency 4
 *
 *   # from the live event log (SELECTs only)
 *   ... scripts/eval/triage-drops.ts --from-db --since 2026-07-18 --limit 5000
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FunnelStage } from '../../src/lib/mapping/funnel';
import {
    FAILURE_CLASSES,
    FUNNEL_CAVEATS,
    UNCLASSIFIED,
    classStages,
    classifyRow,
    makeFunnelRow,
    uncoveredTokens,
    type FailureClass,
    type FixKind,
    type FunnelQuality,
    type FunnelRow,
    type FunnelRowInput,
} from './failure-classes';
import { attachIncumbents, openPrisma, readFromDb, type PrismaLike } from './classify-drops';
import type { ProbeCandidate, RetrievalProbe } from '../debug-retrieval-probe';
import type { FilterTrace } from '../filter-trace-probe';

// ---------------------------------------------------------------------------
// Drop stages
// ---------------------------------------------------------------------------

/**
 * The stages this driver triages. `cache_hit` / `saved` / `fast_path` are NOT
 * drops — F2 can still flag them as poisoned conversions (finding 4), which is
 * `classify-drops.ts`'s job; this driver is about lines that did not land.
 *
 * The exclusion has a cost, and `scopeDisclosure()` states it in the report rather
 * than leaving it in this comment: the finding-4 quality classes span served stages,
 * so this run sees only their `under_gate` slice (served to the user, never cached)
 * and never their `cache_hit`/`saved` slice (already cached — the poisoned
 * conversion). Four classes are excluded outright.
 */
export const DROP_STAGES: FunnelStage[] = ['no_match', 'under_gate', 'save_rejected', 'all_filtered', 'no_candidates'];

const DROP_STAGE_SET = new Set<string>(DROP_STAGES);

export function isDropStage(stage: string | null | undefined): boolean {
    return stage != null && DROP_STAGE_SET.has(stage);
}

// ---------------------------------------------------------------------------
// Coarse class vocabulary (legacy `cls` / `byClass`)
// ---------------------------------------------------------------------------

/**
 * The 2026-07-21 triage vocabulary (identity 149 / serving 82 / nutrition 50 /
 * ingest-gap 13 / ranking-gap 2), plus three buckets that run had no name for:
 * `telemetry` (a reporting defect, not a mapping defect), `healthy` (finding 1 —
 * a by-design drop is not a defect) and `frontier` (residual / unclassified).
 */
export type CoarseClass =
    | 'identity' | 'serving' | 'nutrition' | 'ingest-gap' | 'ranking-gap'
    | 'telemetry' | 'healthy' | 'frontier';

/**
 * F2 class id -> coarse class. Explicit rather than derived from the id string:
 * a meta-test asserts every registry class appears here, so adding an F2 class
 * fails the suite until it is routed instead of silently landing in a default.
 */
export const COARSE_BY_CLASS_ID: Record<string, CoarseClass> = {
    // poisoned conversions
    'degenerate-macros-served': 'nutrition',
    'corrupt-panel-served': 'nutrition',
    'identity-cooked-vs-dry': 'identity',
    'identity-preparation-mismatch': 'identity',
    'composite-component-drift': 'identity',
    'identity-brand-substituted': 'identity',
    'identity-query-token-dropped': 'identity',
    'ai-estimated-backfill-served': 'ingest-gap',
    'serving-flat-100g-fallthrough': 'serving',
    // save gates that are working as designed
    'gate-cross-source-margin': 'healthy',
    'gate-sub-threshold-no-displace': 'healthy',
    'gate-serving-downgrade': 'healthy',
    'gate-bare-category-takeover': 'healthy',
    'gate-zero-macros': 'healthy',
    'fast-path-zero-calorie': 'healthy',
    'cache-hit-healthy': 'healthy',
    'saved-healthy': 'healthy',
    // save gates whose firing exposes a defect upstream of them
    'gate-human-row-conflated': 'telemetry',
    'gate-brand-mismatch-pick': 'identity',
    'gate-core-token-mismatch-pick': 'identity',
    'gate-produce-classifier-hijack': 'nutrition',
    'gate-lean-protein-floor-on-composite': 'nutrition',
    'gate-atwater-no-ethanol': 'nutrition',
    'gate-ai-estimate-disagreement': 'nutrition',
    // retrieval / ranking / corpus
    'venue-brand-blackout-tripwire': 'identity',
    'fast-path-water-substring-hijack': 'identity',
    'ingest-gap-no-candidates': 'ingest-gap',
    'no-match-total-abstention': 'ranking-gap',
    'under-gate-ranking-residual': 'ranking-gap',
    'all-filtered-over-rejection': 'ranking-gap',
    // residual buckets with no diagnosis yet
    'gate-macro-plausibility-residual': 'frontier',
    'save-rejected-residual': 'frontier',
};

export function coarseClassOf(classId: string): CoarseClass {
    return COARSE_BY_CLASS_ID[classId] ?? 'frontier';
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * `repoint` / `evict` / `mark-corrupt` are row-level data ops. `pipeline-fix` routes
 * to a code change. `ingest` routes to the ingest queue and NEVER to a fix-agent.
 * `triage` means the evidence does not support any action yet.
 *
 * A `repoint` hands `{seed, targetId}` to apply-repoints.ts, which WRITES FoodMapping
 * under validatedBy 'human-triage'. Its target vocabulary is NOT the candidate-id
 * vocabulary — see APPLY_REPOINTS_TARGET_RE, which is what `targetId` is constrained
 * to. Getting that wrong pins a wrong record against future warm waves.
 */
export type TriageAction = 'repoint' | 'evict' | 'mark-corrupt' | 'ingest' | 'pipeline-fix' | 'triage' | 'none';

/**
 * EXACTLY what apply-repoints.ts can consume as `target`, read off its own code
 * (scripts/eval/apply-repoints.ts:83-104):
 *
 *   if (r.target.startsWith('off_')) { barcode = target.slice(4); ...OffFood... }
 *   const fdcId = parseInt(r.target.slice(4), 10);   // EVERYTHING ELSE
 *
 * There is no third branch and no validation. `fs_12345` therefore does not error —
 * `'fs_12345'.slice(4)` is `'2345'`, so it looks up FdcFood 2345, an unrelated
 * record, and if that row has nutrition it UPSERTS the cache key onto it. That is a
 * silent wrong-record cache poisoning applied under validatedBy 'human-triage', i.e.
 * pinned against future warm waves — the same shape as the 2026-07-24 clobber
 * incident that had to be surgically reverted.
 *
 * So the vocabulary is off_<barcode> and fdc_<digits>, and NOTHING else. Candidate
 * ids from the probes span a wider space (`off_` / `fdc_` / `fs_`, and the served
 * `foodId` can also be `ai_`), so an fs_ candidate — reachable whenever `--fatsecret`
 * is passed — must be WITHHELD rather than reported as a target. Extend this regex
 * only together with a branch in apply-repoints.ts, never before it.
 */
export const APPLY_REPOINTS_TARGET_RE = /^(off_[A-Za-z0-9._-]+|fdc_\d+)$/;

/** Can apply-repoints.ts resolve this candidate id to the record it names? */
export function isApplyRepointsTarget(id: string | null | undefined): boolean {
    return typeof id === 'string' && APPLY_REPOINTS_TARGET_RE.test(id);
}

/** Per-class default action where fixKind alone is too coarse. */
const ACTION_BY_CLASS_ID: Record<string, TriageAction> = {
    'degenerate-macros-served': 'mark-corrupt',
    'corrupt-panel-served': 'mark-corrupt',
    // The AI expectation disagreeing with a panel split good/bad in the 07-21 run,
    // so it is a human read, not an automatic data op.
    'gate-ai-estimate-disagreement': 'triage',
};

function defaultActionFor(cls: FailureClass): TriageAction {
    const explicit = ACTION_BY_CLASS_ID[cls.id];
    if (explicit) return explicit;
    switch (cls.fixKind) {
        case 'ingest': return 'ingest';
        case 'data': return 'repoint';
        case 'pipeline': return 'pipeline-fix';
        case 'healthy': return 'none';
    }
}

// ---------------------------------------------------------------------------
// Scope: what this tool structurally cannot report
// ---------------------------------------------------------------------------

/**
 * Which parts of the advertised 2026-07-21 vocabulary this driver cannot fill.
 *
 * The report prints the full `byClass` vocabulary, so a bucket that is *unreachable
 * by construction* would read as "we looked and found none". This is computed from
 * DROP_STAGES x the registry, never hand-listed, so it cannot drift.
 */
export interface ScopeDisclosure {
    dropStages: FunnelStage[];
    /** Stages present in the registry that selectDrops filters out before classifying. */
    excludedStages: FunnelStage[];
    /** Classes that can NEVER fire here: every stage they declare is excluded. */
    outOfScopeClassIds: string[];
    /** Classes only PARTLY visible: some declared stages are excluded, some are not. */
    partialClassIds: string[];
    /** Coarse buckets with no reachable class at all — unpopulatable by construction. */
    outOfScopeCoarseClasses: CoarseClass[];
    /** Coarse buckets whose count is real but INCOMPLETE (a member class is partly/fully excluded). */
    partialCoarseClasses: CoarseClass[];
    /** Actions this driver can never emit, whatever the input. */
    unreachableActions: TriageAction[];
    /** Rendered into log[] and into the md, so the exclusion travels with the numbers. */
    notes: string[];
}

const ALL_ACTIONS: TriageAction[] = ['repoint', 'evict', 'mark-corrupt', 'ingest', 'pipeline-fix', 'triage', 'none'];

export function scopeDisclosure(): ScopeDisclosure {
    const inScope = (cls: FailureClass) => classStages(cls).some(s => isDropStage(s));
    const fullyVisible = (cls: FailureClass) => classStages(cls).every(s => isDropStage(s));

    const excludedStages = Array.from(new Set(
        FAILURE_CLASSES.flatMap(classStages).filter(s => !isDropStage(s)))).sort();
    const outOfScope = FAILURE_CLASSES.filter(c => !inScope(c));
    const partial = FAILURE_CLASSES.filter(c => inScope(c) && !fullyVisible(c));

    const coarseOf = (ids: string[]) => Array.from(new Set(ids.map(coarseClassOf)));
    const reachableCoarse = new Set(FAILURE_CLASSES.filter(inScope).map(c => coarseClassOf(c.id)));
    const outOfScopeCoarseClasses = coarseOf(outOfScope.map(c => c.id)).filter(c => !reachableCoarse.has(c)).sort();
    const partialCoarseClasses = coarseOf([...outOfScope, ...partial].map(c => c.id))
        .filter(c => !outOfScopeCoarseClasses.includes(c)).sort();

    // Actions the code can still emit for an in-scope class, plus the ones the
    // probe-override / healthy / residual / unclassified paths hard-code.
    const reachableActions = new Set<TriageAction>([
        ...FAILURE_CLASSES.filter(inScope).map(defaultActionFor),
        'repoint', 'ingest', 'pipeline-fix', 'triage', 'none',
    ]);
    const unreachableActions = ALL_ACTIONS.filter(a => !reachableActions.has(a));

    const notes: string[] = [];
    notes.push(`SCOPE: this driver triages ${DROP_STAGES.join('|')} ONLY. Rows at `
        + `${excludedStages.join('|')} are filtered out BEFORE classification, so anything below is absent `
        + 'BY CONSTRUCTION and must not be read as "we looked and found none". Poisoned conversions that were '
        + 'actually CACHED (finding 4) are classify-drops.ts territory — run that, not this.');
    if (outOfScope.length > 0) {
        notes.push(`SCOPE: ${outOfScope.length} F2 class(es) can NEVER fire here — `
            + outOfScope.map(c => `${c.id} (${classStages(c).join('|')})`).join(', ') + '.');
    }
    if (partial.length > 0) {
        notes.push(`SCOPE: ${partial.length} class(es) are only PARTLY visible — `
            + partial.map(c => `${c.id} (sees ${classStages(c).filter(isDropStage).join('|')}, `
                + `blind to ${classStages(c).filter(s => !isDropStage(s)).join('|')})`).join('; ')
            + '. Their counts are real but LOWER BOUNDS: the quality classes span served stages, so this run '
            + 'sees the under_gate slice (served, never cached) and never the cache_hit/saved slice (cached, '
            + 'i.e. the poisoned conversion).');
    }
    notes.push(outOfScopeCoarseClasses.length > 0
        ? `SCOPE: coarse byClass bucket(s) ${outOfScopeCoarseClasses.join(', ')} are UNPOPULATABLE here.`
        : 'SCOPE: every coarse byClass bucket has at least one reachable class, but '
            + `${partialCoarseClasses.join(', ')} draw on partly-excluded classes, so their counts are lower bounds.`);
    if (unreachableActions.length > 0) {
        notes.push(`SCOPE: action(s) ${unreachableActions.join(', ')} are never emitted by this driver `
            + '(no in-scope class defaults to them and no code path proposes them), so a 0 there says nothing '
            + 'about the underlying work.');
    }
    return {
        dropStages: [...DROP_STAGES],
        excludedStages,
        outOfScopeClassIds: outOfScope.map(c => c.id),
        partialClassIds: partial.map(c => c.id),
        outOfScopeCoarseClasses,
        partialCoarseClasses,
        unreachableActions,
        notes,
    };
}

// ---------------------------------------------------------------------------
// Dossier
// ---------------------------------------------------------------------------

/** The two read-only probes, as they land in the dossier. */
export interface DossierProbes {
    retrieval: RetrievalProbe | { error: string } | null;
    filterTrace: FilterTrace | { error: string } | null;
}

/** A candidate the probe says would have covered the query better than the pick. */
export interface BetterCandidate extends ProbeCandidate {
    /** Query tokens the served record dropped and this candidate carries. */
    coversUncovered: string[];
    /** Did it survive the pipeline's own filters, or only appear in gather? */
    survivedFilters: boolean;
}

/** What the probes established. Every field is `null` when `--no-probes`. */
export interface DossierEvidence {
    probed: boolean;
    /** The string the probes searched with — `normalizedForm ?? seed`, never the raw quantity line. */
    probeQuery: string | null;
    candidateCount: number | null;
    bySource: Record<string, number> | null;
    fatsecretCount: number | null;
    mustHaveTokens: string[] | null;
    survivors: number | null;
    removedByTokenFilter: number | null;
    droppedByCoreToken: number | null;
    /** Nothing exists in any lane -> dataset gap, not a ranking gap. */
    corpusGap: boolean;
    /** Candidates existed and every one was filtered out -> filter over-rejection. */
    filterWipeout: boolean;
    betterCandidate: BetterCandidate | null;
    probeErrors: string[];
    notes: string[];
}

export interface TriageVerdict {
    confirmed: boolean;
    cls: CoarseClass;
    action: TriageAction;
    /**
     * `off_<barcode>` or `fdc_<id>` — ALWAYS a value apply-repoints.ts can resolve
     * (APPLY_REPOINTS_TARGET_RE) — or null when no target was found OR the record the
     * probe found cannot be expressed in that vocabulary. Never an `fs_` id.
     */
    targetId: string | null;
    note: string;
    /** Secondary actions the evidence also supports (e.g. mark-corrupt alongside a repoint). */
    extraActions: TriageAction[];
    /** True when probe evidence overrode the row-only class (e.g. pipeline -> ingest). */
    reclassifiedByProbe: boolean;
    /**
     * The candidate id the probe DID find but which apply-repoints.ts cannot consume,
     * so `targetId` is null and the record is named in `note` instead. Counted in the
     * run log — a withheld target is a finding a human can still act on, and it must
     * not read as "the probe found nothing".
     */
    withheldTargetId: string | null;
}

export interface TriageDossier {
    seed: string;
    /** canonicalizeCacheKey(normalizedForm ?? seed) — the ONLY key that joins to FoodMapping. */
    cacheKey: string;
    normalizedForm: string | null;
    /** Distinct raw lines collapsed into this dossier by cache key. */
    variants: string[];
    /** Events collapsed into this dossier — the frequency signal the cap must not hide. */
    occurrences: number;
    funnelStage: FunnelStage | null;
    dropReason: string | null;
    dropClass: string;
    hadIncumbent: boolean | null;
    /** The pick that was rejected/served under the gate. */
    served: {
        foodId: string | null;
        foodName: string | null;
        brandName: string | null;
        source: string | null;
        grams: number | null;
        totalKcal: number | null;
        kcalPer100g: number | null;
        confidence: number | null;
        servingTier: string | null;
    };
    quality: FunnelQuality;
    classId: string;
    classTitle: string;
    fixKind: FixKind | 'unknown';
    residual: boolean;
    probes: DossierProbes | null;
    evidence: DossierEvidence;
    verdict: TriageVerdict;
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

/**
 * Any of the warm shapes we produce: warm-cache.ts (`seed`), warm-names.ts
 * (`query`), MappingEventLog exports (`rawLine`). Getting `query` wrong is not
 * cosmetic — a warm-names JSONL keyed only on `query` parses to ZERO rows if the
 * reader looks for `seed`/`rawLine` alone.
 */
export interface WarmRecordLike {
    seed?: string;
    rawLine?: string;
    query?: string;
    normalizedForm?: string | null;
    funnelStage?: string | null;
    dropReason?: string | null;
    matchConfidence?: number | null;
    confidence?: number | null;
    grams?: number | null;
    totalKcal?: number | null;
    per100g?: { kcal?: number; protein?: number; carbs?: number; fat?: number } | null;
    source?: string | null;
    foodId?: string | null;
    foodName?: string | null;
    brandName?: string | null;
    servingTier?: string | null;
}

export function recordToInput(r: WarmRecordLike): FunnelRowInput | null {
    const rawLine = r.seed ?? r.rawLine ?? r.query;
    if (!rawLine) return null;
    const p = r.per100g ?? {};
    return {
        rawLine,
        normalizedForm: r.normalizedForm ?? null,
        funnelStage: (r.funnelStage ?? null) as FunnelStage | null,
        dropReason: r.dropReason ?? null,
        confidence: r.matchConfidence ?? r.confidence ?? null,
        grams: r.grams ?? null,
        totalKcal: r.totalKcal ?? null,
        kcalPer100g: p.kcal ?? null,
        proteinPer100g: p.protein ?? null,
        carbsPer100g: p.carbs ?? null,
        fatPer100g: p.fat ?? null,
        source: r.source ?? null,
        foodId: r.foodId ?? null,
        foodName: r.foodName ?? null,
        brandName: r.brandName ?? null,
        servingTier: r.servingTier ?? null,
    };
}

/** Parse `{results:[...]}`, a bare JSON array, or JSONL — pretty-printed or not. */
export function parseInputText(text: string): WarmRecordLike[] {
    const trimmed = text.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) return JSON.parse(trimmed) as WarmRecordLike[];
    if (trimmed.startsWith('{')) {
        try {
            const parsed = JSON.parse(trimmed) as { results?: WarmRecordLike[] } | WarmRecordLike;
            const results = (parsed as { results?: WarmRecordLike[] }).results;
            if (Array.isArray(results)) return results;
            return [parsed as WarmRecordLike];
        } catch {
            // Not a single JSON document: fall through to JSONL.
        }
    }
    const out: WarmRecordLike[] = [];
    trimmed.split('\n').forEach((line, i) => {
        const l = line.trim();
        if (!l) return;
        try {
            out.push(JSON.parse(l) as WarmRecordLike);
        } catch (e) {
            throw new Error(`line ${i + 1} is not JSON: ${(e as Error).message}`);
        }
    });
    return out;
}

export function readInputRows(file: string): FunnelRow[] {
    const records = parseInputText(fs.readFileSync(file, 'utf8'));
    const rows: FunnelRow[] = [];
    for (const r of records) {
        const input = recordToInput(r);
        if (input) rows.push(makeFunnelRow(input));
    }
    return rows;
}

// ---------------------------------------------------------------------------
// Selection: drop stages -> dedupe -> per-class cap
// ---------------------------------------------------------------------------

export interface CapTruncation {
    classId: string;
    seen: number;
    kept: number;
    dropped: number;
}

export interface SelectionResult {
    /** One entry per distinct cache key, already capped. */
    selected: TriageDossier[];
    /** Every stage seen in the input (drops and non-drops). */
    stageCounts: Record<string, number>;
    /** Stage histogram of the drop rows only. */
    dropStageCounts: Record<string, number>;
    rowCount: number;
    dropRowCount: number;
    /** Distinct cache keys among the drop rows, before the cap. */
    distinctKeyCount: number;
    duplicateEventsCollapsed: number;
    truncation: CapTruncation[];
    droppedByCap: number;
    log: string[];
}

function servedOf(row: FunnelRow): TriageDossier['served'] {
    return {
        foodId: row.foodId,
        foodName: row.foodName,
        brandName: row.brandName,
        source: row.source,
        grams: row.grams,
        totalKcal: row.totalKcal,
        kcalPer100g: row.kcalPer100g,
        confidence: row.confidence,
        servingTier: row.servingTier,
    };
}

function emptyEvidence(): DossierEvidence {
    return {
        probed: false,
        probeQuery: null,
        candidateCount: null,
        bySource: null,
        fatsecretCount: null,
        mustHaveTokens: null,
        survivors: null,
        removedByTokenFilter: null,
        droppedByCoreToken: null,
        corpusGap: false,
        filterWipeout: false,
        betterCandidate: null,
        probeErrors: [],
        notes: [],
    };
}

/** The string the probes should search with: the mapper's own query, not the quantity line. */
export function probeQueryFor(row: FunnelRow): string {
    const nf = (row.normalizedForm ?? '').trim();
    return nf.length > 0 ? nf : row.rawLine;
}

/**
 * Filter to drop stages, collapse duplicate cache keys, then cap per F2 class.
 *
 * Order matters: dedupe BEFORE the cap so the cap counts distinct problems (one
 * key logged 400 times is one problem — the same reason classify-drops ranks by
 * distinct keys), and classify BEFORE the cap so the cap is per class rather than
 * "the first N of whatever came back".
 */
export function selectDrops(rows: FunnelRow[], opts: { perClassCap: number }): SelectionResult {
    const stageCounts: Record<string, number> = {};
    const dropStageCounts: Record<string, number> = {};
    const skippedByStage: Record<string, number> = {};
    const log: string[] = [];

    const drops: FunnelRow[] = [];
    for (const row of rows) {
        const stage = row.funnelStage ?? 'null';
        stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
        if (isDropStage(row.funnelStage)) {
            dropStageCounts[stage] = (dropStageCounts[stage] ?? 0) + 1;
            drops.push(row);
        } else {
            skippedByStage[stage] = (skippedByStage[stage] ?? 0) + 1;
        }
    }

    log.push(`input: ${rows.length} rows`);
    const skippedTotal = rows.length - drops.length;
    log.push(`stage filter: kept ${drops.length} drop-stage rows (${DROP_STAGES.join('|')}); `
        + `skipped ${skippedTotal}`
        + (skippedTotal > 0 ? ` (${fmtCounts(skippedByStage)})` : '')
        + ' — non-drop stages are classify-drops.ts territory, not triage.');
    if ((skippedByStage.null ?? 0) > 0) {
        log.push(`NOTE: ${skippedByStage.null} row(s) carried NO funnelStage (pre-F1 warm output or a `
            + "row the mapper never tagged) and were skipped. They are invisible here, not 'clean'.");
    }

    // --- dedupe by cache key ---
    const byKey = new Map<string, { row: FunnelRow; variants: string[]; occurrences: number }>();
    for (const row of drops) {
        const key = row.cacheKey || row.rawLine.toLowerCase();
        const hit = byKey.get(key);
        if (!hit) {
            byKey.set(key, { row, variants: [row.rawLine], occurrences: 1 });
            continue;
        }
        hit.occurrences++;
        if (!hit.variants.includes(row.rawLine)) hit.variants.push(row.rawLine);
    }
    const duplicateEventsCollapsed = drops.length - byKey.size;
    if (duplicateEventsCollapsed > 0) {
        log.push(`dedupe: ${drops.length} drop events collapsed to ${byKey.size} distinct canonical cache keys `
            + `(${duplicateEventsCollapsed} duplicate events not probed again; the count is kept as `
            + '`occurrences` on each dossier).');
    }

    // --- classify, then cap per class ---
    const perClassSeen = new Map<string, number>();
    const perClassKept = new Map<string, number>();
    const selected: TriageDossier[] = [];
    for (const { row, variants, occurrences } of byKey.values()) {
        const { classId, cls } = classifyRow(row);
        perClassSeen.set(classId, (perClassSeen.get(classId) ?? 0) + 1);
        const kept = perClassKept.get(classId) ?? 0;
        if (opts.perClassCap > 0 && kept >= opts.perClassCap) continue;
        perClassKept.set(classId, kept + 1);
        selected.push({
            seed: row.rawLine,
            cacheKey: row.cacheKey,
            normalizedForm: row.normalizedForm,
            variants,
            occurrences,
            funnelStage: row.funnelStage,
            dropReason: row.dropReason,
            dropClass: row.dropClass,
            hadIncumbent: row.hadIncumbent,
            served: servedOf(row),
            quality: row.quality,
            classId,
            classTitle: cls?.title ?? 'UNCLASSIFIED — a shape the registry has never seen',
            fixKind: cls?.fixKind ?? 'unknown',
            residual: cls?.residual ?? false,
            probes: null,
            evidence: emptyEvidence(),
            // Placeholder; decideVerdict runs after the probes so evidence can override.
            verdict: { confirmed: false, cls: 'frontier', action: 'triage', targetId: null, note: 'not yet decided', extraActions: [], reclassifiedByProbe: false, withheldTargetId: null },
        });
    }

    const truncation: CapTruncation[] = [];
    for (const [classId, seen] of perClassSeen) {
        const kept = perClassKept.get(classId) ?? 0;
        if (seen > kept) truncation.push({ classId, seen, kept, dropped: seen - kept });
    }
    truncation.sort((a, b) => b.dropped - a.dropped || a.classId.localeCompare(b.classId));
    const droppedByCap = truncation.reduce((n, t) => n + t.dropped, 0);
    if (droppedByCap > 0) {
        log.push(`PER-CLASS CAP ${opts.perClassCap}: DROPPED ${droppedByCap} dossier(s) — `
            + truncation.map(t => `${t.classId} kept ${t.kept}/${t.seen}`).join(', ')
            + '. This run does NOT cover those; raise --per-class-cap to see them.');
    } else {
        log.push(`per-class cap ${opts.perClassCap > 0 ? opts.perClassCap : '(none)'}: nothing dropped — `
            + 'every distinct key is in this report.');
    }

    return {
        selected,
        stageCounts,
        dropStageCounts,
        rowCount: rows.length,
        dropRowCount: drops.length,
        distinctKeyCount: byKey.size,
        duplicateEventsCollapsed,
        truncation,
        droppedByCap,
        log,
    };
}

function fmtCounts(counts: Record<string, number>): string {
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

/** Injected so tests never touch a network or a DB. */
export interface ProbeSet {
    retrieval?: (query: string) => Promise<RetrievalProbe>;
    filterTrace?: (query: string) => Promise<FilterTrace>;
}

/**
 * Load the real probes. Deliberately `require`d late: importing
 * debug-retrieval-probe pulls in gather-candidates, which constructs a Prisma
 * client and warms the ONNX embedder at module load.
 */
export function loadRealProbes(opts: { fatsecret: boolean }): ProbeSet {
    if (!opts.fatsecret) {
        // Read BEFORE the lane module loads (config.ts snapshots it into a const),
        // so this is the difference between a read-only run and one that upserts
        // FatSecretFood rows.
        process.env.FATSECRET_RETRIEVAL_ENABLED = 'false';
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const retrievalMod = require('../debug-retrieval-probe') as typeof import('../debug-retrieval-probe');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const filterMod = require('../filter-trace-probe') as typeof import('../filter-trace-probe');
    return {
        retrieval: (q: string) => retrievalMod.probeRetrieval(q, { skipFatSecretLaneCall: !opts.fatsecret }),
        filterTrace: (q: string) => filterMod.traceFilters(q),
    };
}

/**
 * Run the probes over the selected dossiers with a fixed-size worker pool.
 *
 * THROWS on an invalid concurrency rather than degrading. `Math.max(1, NaN)` is NaN,
 * so `Array.from({length: NaN})` built an EMPTY worker array: runProbes resolved
 * immediately, every dossier kept `probes: null`, and the report still said
 * mode='probes' with each note claiming '--no-probes'. A run that reads as fully
 * probed but proposed nothing is indistinguishable from "the corpus had nothing" —
 * so this is a hard failure, at entry, before any probe is called.
 */
export async function runProbes(
    dossiers: TriageDossier[],
    probes: ProbeSet,
    opts: { concurrency: number; onProgress?: (done: number, total: number) => void },
): Promise<void> {
    if (!Number.isInteger(opts.concurrency) || opts.concurrency < 1) {
        throw new Error(`runProbes: concurrency must be an integer >= 1, got ${JSON.stringify(opts.concurrency)}. `
            + 'A non-positive or NaN value builds zero workers and silently probes NOTHING.');
    }
    let idx = 0;
    let done = 0;
    const workers = Array.from({ length: opts.concurrency }, async () => {
        while (idx < dossiers.length) {
            const d = dossiers[idx++];
            const query = probeQueryFor({
                rawLine: d.seed,
                normalizedForm: d.normalizedForm,
            } as FunnelRow);
            const result: DossierProbes = { retrieval: null, filterTrace: null };
            if (probes.retrieval) {
                try {
                    result.retrieval = await probes.retrieval(query);
                } catch (e) {
                    result.retrieval = { error: (e as Error)?.message ?? String(e) };
                }
            }
            if (probes.filterTrace) {
                try {
                    result.filterTrace = await probes.filterTrace(query);
                } catch (e) {
                    result.filterTrace = { error: (e as Error)?.message ?? String(e) };
                }
            }
            d.probes = result;
            d.evidence = deriveEvidence(d, result, query);
            done++;
            opts.onProgress?.(done, dossiers.length);
        }
    });
    await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// Evidence + verdict (pure)
// ---------------------------------------------------------------------------

/**
 * Union of everything the two probes saw, filter-trace candidates first so their
 * `survivedFilters` flag is preserved and gather-only duplicates are not re-added.
 */
function candidatePool(probes: DossierProbes): (ProbeCandidate & { survivedFilters: boolean })[] {
    const out: (ProbeCandidate & { survivedFilters: boolean })[] = [];
    const trace = probes.filterTrace;
    if (trace && !('error' in trace) && Array.isArray(trace.candidates)) {
        for (const c of trace.candidates) {
            out.push({ id: c.id, source: c.source, name: c.name, brand: c.brand, score: c.score, survivedFilters: c.fate === 'KEPT' });
        }
    }
    const ret = probes.retrieval;
    if (ret && !('error' in ret)) {
        const seen = new Set(out.map(c => c.id));
        const push = (c: ProbeCandidate) => {
            if (c.id && seen.has(c.id)) return;
            if (c.id) seen.add(c.id);
            out.push({ ...c, survivedFilters: false });
        };
        if (ret.gather && !('error' in ret.gather)) ret.gather.top.forEach(push);
        if (ret.fatsecret && !('error' in ret.fatsecret)) ret.fatsecret.top.forEach(push);
    }
    return out;
}

/**
 * Turn raw probe output into the handful of facts a verdict needs.
 *
 * `betterCandidate` is only claimed when the served record actually DROPPED query
 * tokens and some candidate carries all of them — the same `uncoveredTokens`
 * function F2's identity detectors use, so the two cannot disagree.
 */
export function deriveEvidence(
    dossier: Pick<TriageDossier, 'seed' | 'quality' | 'served'>,
    probes: DossierProbes | null,
    probeQuery: string,
): DossierEvidence {
    const ev = emptyEvidence();
    if (!probes) {
        ev.notes.push('probes disabled (--no-probes): the class is row-only, no repoint target can be proposed.');
        return ev;
    }
    ev.probed = true;
    ev.probeQuery = probeQuery;

    const ret = probes.retrieval;
    if (ret && 'error' in ret) ev.probeErrors.push(`retrieval: ${ret.error}`);
    else if (ret) {
        if ('error' in ret.gather) ev.probeErrors.push(`gather: ${ret.gather.error}`);
        else {
            ev.candidateCount = ret.gather.total;
            ev.bySource = ret.gather.bySource;
        }
        if (ret.fatsecret && 'error' in ret.fatsecret) ev.probeErrors.push(`fatsecret: ${ret.fatsecret.error}`);
        else if (ret.fatsecret) ev.fatsecretCount = ret.fatsecret.count;
    }

    const trace = probes.filterTrace;
    if (trace && 'error' in trace) ev.probeErrors.push(`filterTrace: ${trace.error}`);
    else if (trace) {
        if (trace.error) ev.probeErrors.push(`filterTrace: ${trace.error}`);
        ev.mustHaveTokens = trace.mustHaveTokens;
        ev.survivors = trace.survivors;
        ev.removedByTokenFilter = trace.removedByTokenFilter;
        ev.droppedByCoreToken = trace.droppedByCoreToken;
        if (ev.candidateCount == null) ev.candidateCount = trace.gathered;
    }

    ev.corpusGap = ev.candidateCount === 0 && (ev.fatsecretCount ?? 0) === 0;
    ev.filterWipeout = (ev.candidateCount ?? 0) > 0 && ev.survivors === 0;

    const uncovered = dossier.quality.uncoveredQueryTokens;
    if (uncovered.length > 0 && (ev.candidateCount ?? 0) > 0) {
        const covering = candidatePool(probes)
            .filter(c => c.id != null && c.id !== dossier.served.foodId)
            .filter(c => uncoveredTokens(dossier.seed, c.name, c.brand).length === 0);
        // Prefer a candidate the pipeline's own filters kept; then the best score.
        covering.sort((a, b) =>
            Number(b.survivedFilters) - Number(a.survivedFilters) || (b.score ?? 0) - (a.score ?? 0));
        const best = covering[0];
        if (best) {
            ev.betterCandidate = { ...best, coversUncovered: uncovered };
        } else {
            ev.notes.push(`no candidate in the probed pool covers the dropped token(s) [${uncovered.join(', ')}] `
                + '— the better record is deeper in the pool or absent from the corpus.');
        }
    }
    return ev;
}

/**
 * Decide the actionable verdict. PURE — same dossier facts always give the same
 * verdict, which is what makes the report reviewable.
 *
 * `confirmed` means "the diagnosis is supported by the evidence in this dossier",
 * NOT "a human verified the fix". A `repoint` target is a PROPOSAL: it says a
 * record covering the dropped tokens exists and survived the filters. The 07-21
 * lesson stands — the durable fix for a `pipeline` class is the code change; the
 * repoint only fixes today's cache row.
 */
export function decideVerdict(args: {
    dossier: Pick<TriageDossier, 'seed' | 'classId' | 'dropReason' | 'hadIncumbent' | 'quality' | 'served' | 'occurrences'>;
    cls: FailureClass | null;
    evidence: DossierEvidence;
}): TriageVerdict {
    const { dossier, cls, evidence } = args;
    const extraActions: TriageAction[] = [];

    if (!cls) {
        return {
            confirmed: false, cls: 'frontier', action: 'triage', targetId: null, extraActions,
            reclassifiedByProbe: false, withheldTargetId: null,
            note: `No registry class matched (dropReason ${dossier.dropReason ?? 'none'}). This is the true `
                + 'frontier: characterize it and add an F2 class before acting.',
        };
    }

    if (cls.fixKind === 'healthy') {
        return {
            confirmed: false, cls: 'healthy', action: 'none', targetId: null, extraActions,
            reclassifiedByProbe: false, withheldTargetId: null,
            note: `${cls.title} — by design, not a defect. incumbent=${String(dossier.hadIncumbent)}. `
                + 'Counted so it stops looking like work.',
        };
    }

    if (cls.residual) {
        return {
            confirmed: false, cls: coarseClassOf(cls.id), action: 'triage', targetId: null, extraActions,
            reclassifiedByProbe: false, withheldTargetId: null,
            note: `${cls.title} (residual bucket, dropReason ${dossier.dropReason ?? 'none'}). No diagnosis yet `
                + '— promote a class from the recurring shapes before sending a fix-agent.',
        };
    }

    // --- probe evidence can override the row-only class ---
    if (evidence.probed && evidence.corpusGap && cls.fixKind !== 'ingest') {
        return {
            confirmed: true, cls: 'ingest-gap', action: 'ingest', targetId: null, extraActions,
            reclassifiedByProbe: true, withheldTargetId: null,
            note: `Row facts said ${cls.id}, but retrieval returned ZERO candidates in every lane for `
                + `"${evidence.probeQuery}" — this is a dataset gap, not a ranking gap. Route to the ingest `
                + 'queue, NEVER a fix-agent.',
        };
    }

    if (evidence.probed && evidence.filterWipeout) {
        return {
            confirmed: true, cls: 'ranking-gap', action: 'pipeline-fix', targetId: null, extraActions,
            reclassifiedByProbe: cls.id !== 'all-filtered-over-rejection', withheldTargetId: null,
            note: `${evidence.candidateCount} candidate(s) gathered and NONE survived the filters `
                + `(${evidence.removedByTokenFilter ?? '?'} removed by the token filter, `
                + `${evidence.droppedByCoreToken ?? '?'} by core-token mismatch; mustHave=`
                + `[${(evidence.mustHaveTokens ?? []).join(', ')}]). Filter over-rejection — fix the filter, `
                + `not the row. Row class was ${cls.id}.`,
        };
    }

    const baseAction = defaultActionFor(cls);
    const better = evidence.betterCandidate;
    // A candidate id apply-repoints.ts cannot resolve must never be reported as a
    // target: it would not error there, it would silently resolve to an unrelated
    // FdcFood and pin the key onto it. Withhold it, name it in the note, count it.
    const withheldTargetId = better?.id && !isApplyRepointsTarget(better.id) ? better.id : null;
    const describeCandidate = (c: BetterCandidate) =>
        `${c.id} ("${c.name}"${c.brand ? ` [${c.brand}]` : ''}, ${c.source}, score ${c.score ?? '?'}`
        + `${c.survivedFilters ? ', survived the filters' : ', gather-only'})`;

    if (better?.id && withheldTargetId == null) {
        if (baseAction === 'mark-corrupt') extraActions.push('mark-corrupt');
        if (cls.fixKind === 'pipeline') extraActions.push('pipeline-fix');
        return {
            confirmed: true, cls: coarseClassOf(cls.id), action: 'repoint', targetId: better.id, extraActions,
            reclassifiedByProbe: false, withheldTargetId: null,
            note: `${cls.title}. Probe found ${describeCandidate(better)} `
                + `covering the dropped token(s) [${better.coversUncovered.join(', ')}] that the served pick `
                + `("${dossier.served.foodName ?? 'none'}") misses. Repoint fixes today's cache row; the durable `
                + `fix for ${cls.fixKind === 'pipeline' ? 'this pipeline class is the ranking/filter change' : 'the class is the data op'}.`,
        };
    }

    let evidenceNote = evidence.probed
        ? `Probe: ${evidence.candidateCount ?? '?'} candidate(s), ${evidence.survivors ?? '?'} survivor(s)`
            + (evidence.notes.length ? `; ${evidence.notes.join(' ')}` : '.')
        : 'No probes were run (--no-probes), so this verdict rests on row facts alone.';

    if (better && withheldTargetId != null) {
        evidenceNote += ` REPOINT TARGET WITHHELD: the probe DID find ${describeCandidate(better)} covering the `
            + `dropped token(s) [${better.coversUncovered.join(', ')}], but apply-repoints.ts can only consume `
            + 'off_<barcode> / fdc_<id> targets — it parses anything else as an fdcId via target.slice(4), so '
            + `reporting "${withheldTargetId}" would silently repoint this key onto an unrelated FdcFood under `
            + 'validatedBy=human-triage. Act on this by hand, or add the branch to apply-repoints.ts first.';
    }

    // An ingest class claims "no record exists". When the probe found survivors that
    // claim is only true of the specific FORM asked for (n-cook-06: the corpus has
    // oats, just not COOKED oats). Say so rather than letting the class title stand
    // unchallenged next to contradicting evidence.
    if (cls.fixKind === 'ingest' && evidence.probed && (evidence.survivors ?? 0) > 0) {
        evidenceNote += ` CAUTION: the lane is NOT empty — ${evidence.survivors} candidate(s) survived the `
            + 'filters, so what is missing is the specific form/variant, not the food. Confirm that before '
            + 'queueing an ingest.';
    }

    return {
        confirmed: true,
        cls: coarseClassOf(cls.id),
        action: baseAction,
        targetId: null,
        extraActions,
        reclassifiedByProbe: false,
        withheldTargetId,
        note: `${cls.title}. ${describeRowEvidence(dossier)} ${evidenceNote}`,
    };
}

/** The row facts that made the class fire, so a reader can check the call. */
function describeRowEvidence(d: Pick<TriageDossier, 'quality' | 'served' | 'occurrences'>): string {
    const bits: string[] = [];
    if (d.quality.degenerateMacros) bits.push('all-zero macros');
    if (d.quality.flat100gServing) bits.push('flat 100 g serving');
    if (d.quality.aiEstimated) bits.push('ai_estimated source');
    if (d.quality.brandDisagreement) bits.push('brand shares no token with the query');
    if (d.quality.uncoveredQueryTokens.length) bits.push(`dropped token(s) [${d.quality.uncoveredQueryTokens.join(', ')}]`);
    const served = `served "${d.served.foodName ?? 'none'}"${d.served.brandName ? ` [${d.served.brandName}]` : ''} `
        + `${d.served.grams ?? '?'}g conf=${d.served.confidence ?? '?'}`;
    return `${served}${bits.length ? `; row flags: ${bits.join(', ')}` : ''}. `
        + (d.occurrences > 1 ? `Seen ${d.occurrences}x. ` : '');
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** Legacy row shape from triage-verdicts-2026-07-21.json, extended with the dossier. */
export interface VerdictRow {
    seed: string;
    confirmed: boolean;
    cls: CoarseClass;
    action: TriageAction;
    targetId: string | null;
    note: string;
    // --- extensions ---
    classId: string;
    fixKind: FixKind | 'unknown';
    dossier: TriageDossier;
}

export interface TriageReport {
    // ---- keys the 2026-07-21 readers expect, same meaning ----
    screened: string;
    suspectCount: number;
    confirmedCount: number;
    byClass: Record<string, number>;
    confirmed: VerdictRow[];
    dismissed: VerdictRow[];
    // ---- extensions ----
    at: string;
    inputLabel: string;
    mode: 'probes' | 'no-probes';
    concurrency: number;
    perClassCap: number;
    rowCount: number;
    dropRowCount: number;
    distinctKeyCount: number;
    dossierCount: number;
    stageCounts: Record<string, number>;
    dropStageCounts: Record<string, number>;
    byFailureClass: Record<string, number>;
    byFixKind: Record<string, number>;
    byAction: Record<string, number>;
    truncation: CapTruncation[];
    droppedByCap: number;
    reclassifiedByProbe: number;
    probeErrorCount: number;
    /** Repoint proposals suppressed because apply-repoints.ts cannot consume the target. */
    withheldTargetCount: number;
    /** What this tool structurally cannot report — so an empty bucket is not read as a clean one. */
    scope: ScopeDisclosure;
    log: string[];
    caveats: string[];
}

const CLASS_BY_ID = new Map(FAILURE_CLASSES.map(c => [c.id, c]));

/**
 * Decide every verdict and shape the report.
 *
 * `suspectCount` = dossiers whose class is not `healthy` (i.e. candidate defects).
 * `confirmedCount` = those whose verdict the evidence supports. Residual and
 * unclassified dossiers stay UNCONFIRMED on purpose: a catch-all bucket is not a
 * diagnosis, and counting it as one is how a frontier disappears.
 */
export function buildReport(
    selection: SelectionResult,
    opts: { inputLabel: string; mode: 'probes' | 'no-probes'; concurrency: number; perClassCap: number; extraLog?: string[] },
): TriageReport {
    const confirmed: VerdictRow[] = [];
    const dismissed: VerdictRow[] = [];
    const byClass: Record<string, number> = {};
    const byFailureClass: Record<string, number> = {};
    const byFixKind: Record<string, number> = {};
    const byAction: Record<string, number> = {};
    let suspectCount = 0;
    let reclassified = 0;
    let probeErrorCount = 0;
    const withheldTargets: string[] = [];

    for (const d of selection.selected) {
        const cls = d.classId === UNCLASSIFIED ? null : CLASS_BY_ID.get(d.classId) ?? null;
        d.verdict = decideVerdict({ dossier: d, cls, evidence: d.evidence });
        if (d.verdict.reclassifiedByProbe) reclassified++;
        if (d.verdict.withheldTargetId) withheldTargets.push(d.verdict.withheldTargetId);
        probeErrorCount += d.evidence.probeErrors.length;

        byFailureClass[d.classId] = (byFailureClass[d.classId] ?? 0) + 1;
        byFixKind[d.fixKind] = (byFixKind[d.fixKind] ?? 0) + 1;
        byAction[d.verdict.action] = (byAction[d.verdict.action] ?? 0) + 1;

        const row: VerdictRow = {
            seed: d.seed,
            confirmed: d.verdict.confirmed,
            cls: d.verdict.cls,
            action: d.verdict.action,
            targetId: d.verdict.targetId,
            note: d.verdict.note,
            classId: d.classId,
            fixKind: d.fixKind,
            dossier: d,
        };
        if (d.fixKind !== 'healthy') suspectCount++;
        if (d.verdict.confirmed) {
            confirmed.push(row);
            byClass[d.verdict.cls] = (byClass[d.verdict.cls] ?? 0) + 1;
        } else {
            dismissed.push(row);
        }
    }

    // Most-frequent first inside `confirmed`, so a reader starts at the loudest key.
    confirmed.sort((a, b) => b.dossier.occurrences - a.dossier.occurrences || a.seed.localeCompare(b.seed));

    const scope = scopeDisclosure();
    const log = [...selection.log, ...(opts.extraLog ?? [])];
    log.push(`verdicts: ${confirmed.length} confirmed / ${dismissed.length} dismissed `
        + `(${suspectCount} suspect = non-healthy class). `
        + `${reclassified} reclassified by probe evidence.`);
    if (probeErrorCount > 0) log.push(`probe errors: ${probeErrorCount} lane failure(s) recorded — `
        + 'those dossiers have partial evidence, do NOT read them as "nothing found".');
    if (withheldTargets.length > 0) {
        const prefixes = Array.from(new Set(withheldTargets.map(t => `${t.split('_')[0]}_`))).sort();
        log.push(`${withheldTargets.length} repoint suggestion(s) WITHHELD: ${prefixes.join('/')} targets are not `
            + 'expressible to apply-repoints.ts (it resolves anything non-off_ as an fdcId via slice(4), so the id '
            + 'would silently repoint the key onto an unrelated FdcFood). The record is named in the verdict note '
            + `for each — ${withheldTargets.join(', ')} — so this is a finding to act on by hand, NOT "no `
            + 'candidate found".');
    }
    for (const note of scope.notes) log.push(note);

    return {
        screened: `${selection.rowCount} rows (${selection.dropRowCount} drop-stage, `
            + `${selection.distinctKeyCount} distinct keys, ${selection.selected.length} triaged) — ${opts.inputLabel}`,
        suspectCount,
        confirmedCount: confirmed.length,
        byClass,
        confirmed,
        dismissed,
        at: new Date().toISOString(),
        inputLabel: opts.inputLabel,
        mode: opts.mode,
        concurrency: opts.concurrency,
        perClassCap: opts.perClassCap,
        rowCount: selection.rowCount,
        dropRowCount: selection.dropRowCount,
        distinctKeyCount: selection.distinctKeyCount,
        dossierCount: selection.selected.length,
        stageCounts: selection.stageCounts,
        dropStageCounts: selection.dropStageCounts,
        byFailureClass,
        byFixKind,
        byAction,
        truncation: selection.truncation,
        droppedByCap: selection.droppedByCap,
        reclassifiedByProbe: reclassified,
        probeErrorCount,
        withheldTargetCount: withheldTargets.length,
        scope,
        log,
        caveats: FUNNEL_CAVEATS.map(c => `${c.id}: ${c.note}`),
    };
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function mdEscape(s: string): string {
    return s.replace(/\|/g, '\\|');
}

export function renderMarkdown(report: TriageReport): string {
    const L: string[] = [];
    L.push(`# Drop triage — ${report.at}`);
    L.push('');
    L.push('> GENERATED by `scripts/eval/triage-drops.ts` (F3). Read-only run: the only files it wrote are');
    L.push('> this report and its `.json` sibling.');
    L.push('');
    L.push(`- input: \`${report.inputLabel}\``);
    L.push(`- mode: **${report.mode}**${report.mode === 'no-probes' ? ' — no retrieval calls, so no repoint targets' : ` (concurrency ${report.concurrency})`}`);
    L.push(`- screened: ${report.screened}`);
    L.push(`- suspects: **${report.suspectCount}** · confirmed: **${report.confirmedCount}** · dismissed: ${report.dismissed.length}`);
    L.push(`- per-class cap: ${report.perClassCap} · dropped by cap: **${report.droppedByCap}**`);
    L.push('');

    L.push('## Run log (everything this run dropped)');
    L.push('');
    for (const line of report.log) L.push(`- ${line}`);
    L.push('');

    if (report.truncation.length > 0) {
        L.push('### Truncated classes — NOT covered by this run');
        L.push('');
        L.push('| class | distinct keys seen | triaged | dropped |');
        L.push('| ----- | -----------------: | ------: | ------: |');
        for (const t of report.truncation) L.push(`| \`${t.classId}\` | ${t.seen} | ${t.kept} | ${t.dropped} |`);
        L.push('');
    }

    L.push('## Stages');
    L.push('');
    L.push(`- all rows: ${fmtCounts(report.stageCounts) || '(none)'}`);
    L.push(`- drop rows only: ${fmtCounts(report.dropStageCounts) || '(none)'}`);
    L.push('');

    L.push('## OUT OF SCOPE for this tool — absent by construction, NOT "looked and found none"');
    L.push('');
    for (const note of report.scope.notes) L.push(`- ${note}`);
    L.push('');
    L.push(`- drop stages triaged: ${report.scope.dropStages.map(s => `\`${s}\``).join(', ')}`);
    L.push(`- stages excluded before classification: ${report.scope.excludedStages.map(s => `\`${s}\``).join(', ') || '(none)'}`);
    L.push(`- classes that cannot fire here: ${report.scope.outOfScopeClassIds.map(c => `\`${c}\``).join(', ') || '(none)'}`);
    L.push(`- classes only partly visible: ${report.scope.partialClassIds.map(c => `\`${c}\``).join(', ') || '(none)'}`);
    L.push(`- coarse buckets unpopulatable: ${report.scope.outOfScopeCoarseClasses.join(', ') || '(none)'}`);
    L.push(`- coarse buckets that are LOWER BOUNDS: ${report.scope.partialCoarseClasses.join(', ') || '(none)'}`);
    L.push(`- actions never emitted: ${report.scope.unreachableActions.join(', ') || '(none)'}`);
    L.push('');

    L.push('## Confirmed, by coarse class (the 2026-07-21 vocabulary)');
    L.push('');
    L.push(`> Read with the scope section above: ${report.scope.outOfScopeCoarseClasses.length > 0
        ? `${report.scope.outOfScopeCoarseClasses.join(', ')} cannot appear at all, and `
        : ''}${report.scope.partialCoarseClasses.join(', ') || 'no bucket'} draw on partly-excluded classes.`);
    L.push('');
    L.push('| coarse class | confirmed |');
    L.push('| ------------ | --------: |');
    for (const [k, v] of Object.entries(report.byClass).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} |`);
    L.push('');
    if (report.withheldTargetCount > 0) {
        L.push(`**${report.withheldTargetCount} repoint target(s) withheld** — the probe found a covering record `
            + 'whose id apply-repoints.ts cannot resolve, so `targetId` is null and the record is named in the '
            + 'note. Act on those by hand.');
        L.push('');
    }

    L.push('## All triaged dossiers, by F2 class');
    L.push('');
    L.push('| F2 class | fixKind | dossiers |');
    L.push('| -------- | ------- | -------: |');
    for (const [k, v] of Object.entries(report.byFailureClass).sort((a, b) => b[1] - a[1])) {
        L.push(`| \`${k}\` | ${CLASS_BY_ID.get(k)?.fixKind ?? 'unknown'} | ${v} |`);
    }
    L.push('');
    L.push(`Actions: ${fmtCounts(report.byAction) || '(none)'}. `
        + `Reclassified by probe evidence: ${report.reclassifiedByProbe}.`);
    L.push('');

    const byAction = new Map<TriageAction, VerdictRow[]>();
    for (const row of report.confirmed) {
        const list = byAction.get(row.action) ?? [];
        list.push(row);
        byAction.set(row.action, list);
    }
    L.push('## Confirmed verdicts');
    L.push('');
    if (report.confirmed.length === 0) L.push('_(none)_');
    for (const action of ['repoint', 'mark-corrupt', 'evict', 'ingest', 'pipeline-fix', 'triage', 'none'] as TriageAction[]) {
        const rows = byAction.get(action);
        if (!rows?.length) continue;
        L.push(`### action: \`${action}\` (${rows.length})`);
        L.push('');
        L.push('| seed | key | class | target | served | note |');
        L.push('| ---- | --- | ----- | ------ | ------ | ---- |');
        for (const r of rows) {
            const d = r.dossier;
            L.push(`| \`${mdEscape(r.seed)}\`${d.occurrences > 1 ? ` ×${d.occurrences}` : ''} `
                + `| \`${mdEscape(d.cacheKey)}\` | \`${r.classId}\` | ${r.targetId ? `\`${r.targetId}\`` : '—'} `
                + `| ${mdEscape(d.served.foodName ?? '—')} ${d.served.grams ?? '?'}g | ${mdEscape(r.note)} |`);
        }
        L.push('');
    }

    L.push('## Dismissed');
    L.push('');
    if (report.dismissed.length === 0) {
        L.push('_(none)_');
    } else {
        L.push('| seed | class | why not actionable |');
        L.push('| ---- | ----- | ------------------ |');
        for (const r of report.dismissed) {
            L.push(`| \`${mdEscape(r.seed)}\` | \`${r.classId}\` | ${mdEscape(r.note)} |`);
        }
    }
    L.push('');

    L.push('## Caveats that are facts, not classes');
    L.push('');
    for (const c of report.caveats) L.push(`- ${c}`);
    L.push('');
    return L.join('\n') + '\n';
}

export function renderConsole(report: TriageReport): void {
    console.log(`\nF3 drop triage — ${report.inputLabel}`);
    console.log(report.screened);
    console.log(`mode=${report.mode} concurrency=${report.concurrency} perClassCap=${report.perClassCap}`);
    for (const line of report.log) console.log(`  · ${line}`);
    console.log(`\nsuspects=${report.suspectCount} confirmed=${report.confirmedCount} dismissed=${report.dismissed.length}`);
    console.log(`byClass (coarse, confirmed only): ${JSON.stringify(report.byClass)}`);
    console.log(`byAction: ${JSON.stringify(report.byAction)}`);
    console.log('\nTop F2 classes among triaged dossiers:');
    for (const [k, v] of Object.entries(report.byFailureClass).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
        console.log(`  ${String(v).padStart(5)}  ${k} (${CLASS_BY_ID.get(k)?.fixKind ?? 'unknown'})`);
    }
    if (report.truncation.length > 0) {
        console.log('\n!! TRUNCATED — not covered by this run:');
        for (const t of report.truncation) console.log(`  ${t.classId}: triaged ${t.kept}/${t.seen} (dropped ${t.dropped})`);
    }
    if (report.withheldTargetCount > 0) {
        console.log(`\n!! ${report.withheldTargetCount} repoint target(s) WITHHELD (not expressible to `
            + 'apply-repoints.ts) — see the notes, act by hand.');
    }
    console.log('\n!! OUT OF SCOPE — absent by construction, not "looked and found none":');
    for (const note of report.scope.notes) console.log(`  ${note}`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function resolveOutBase(out: string | undefined, at: Date): string {
    if (out) return out.replace(/\.(json|md)$/i, '');
    const ts = at.toISOString().replace(/[:.]/g, '-');
    return path.join(__dirname, 'results', `triage-verdicts-${ts}`);
}

/** Thrown for a bad flag value; main() prints the message and exits non-zero. */
export class FlagError extends Error { }

/**
 * Parse an integer flag, or REFUSE the run.
 *
 * Every numeric flag here used to be `Number(val(flag) ?? default)`, unvalidated,
 * and each failed silently in its own way: `--concurrency 0` / `--concurrency abc`
 * built zero probe workers (a report that reads as fully probed while nothing was
 * probed), and `--limit abc` made `slice(0, NaN)` = [] — a fully-formed 0-row report
 * saying "nothing dropped — every distinct key is in this report". A typo must not
 * be able to manufacture a clean-looking empty run.
 */
export function parseIntFlag(flag: string, raw: string | undefined, fallback: number, min: number): number {
    if (raw === undefined) return fallback;
    const trimmed = raw.trim();
    const n = Number(trimmed);
    if (trimmed.length === 0 || !Number.isFinite(n) || !Number.isInteger(n)) {
        throw new FlagError(`${flag} must be an integer, got "${raw}". `
            + (trimmed.startsWith('--')
                ? `That looks like the next flag — ${flag} takes a value.`
                : 'A non-numeric value would silently degrade this run, so it is refused.'));
    }
    if (n < min) {
        throw new FlagError(`${flag} must be >= ${min}, got ${n}.`
            + (flag === '--concurrency' ? ' A concurrency below 1 builds zero workers and probes NOTHING.' : ''));
    }
    return n;
}

/**
 * Apply `--limit` to the `--in` rows and SAY SO. The old `rows.slice(0, limit)`
 * pushed nothing into log[], so every downstream count (rowCount, screened,
 * stageCounts, dropStageCounts) described the slice while reading as the file —
 * exactly the "covered everything" failure the header's TRUNCATION IS ALWAYS
 * REPORTED section exists to prevent. Both sizes are reported, always.
 */
export function applyInputLimit(rows: FunnelRow[], limit: number | undefined): { rows: FunnelRow[]; log: string[] } {
    if (limit === undefined) return { rows, log: [] };
    if (rows.length <= limit) {
        return { rows, log: [`--limit ${limit}: the input file had ${rows.length} row(s), all kept — no truncation.`] };
    }
    return {
        rows: rows.slice(0, limit),
        log: [`--limit ${limit}: TRUNCATED the input — the file had ${rows.length} row(s) and this run covers only `
            + `the FIRST ${limit}. ${rows.length - limit} row(s) were discarded before any stage filtering, so `
            + 'rowCount / screened / stageCounts below describe the KEPT SLICE, not the file. Raise or drop '
            + '--limit to cover the rest.'],
    };
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const has = (flag: string) => args.includes(flag);
    const val = (flag: string): string | undefined => {
        const i = args.indexOf(flag);
        return i >= 0 ? args[i + 1] : undefined;
    };

    const inFile = val('--in');
    const fromDb = has('--from-db');
    if (!inFile && !fromDb) {
        console.error('Usage: triage-drops.ts (--in <warm.json|.jsonl> | --from-db) [--since <date>] [--limit N]');
        console.error('  [--concurrency 4] [--per-class-cap 25] [--out <path>] [--no-probes] [--no-incumbent]');
        console.error('  [--fatsecret] [--dry]');
        console.error('');
        console.error('  --limit N     integer >= 1. Caps the DB read with --from-db; with --in it truncates the');
        console.error('                file to the first N rows, and the truncation is reported in the run log.');
        console.error('  --concurrency N        integer >= 1 (probe worker pool).');
        console.error('  --per-class-cap N      integer >= 0; 0 means UNLIMITED.');
        console.error('  --no-probes   classify only, zero retrieval calls (cheap mode)');
        console.error('  --dry         run everything, write nothing');
        console.error('  --fatsecret   include the FatSecret lane: spends FS API quota AND background-upserts');
        console.error('                FatSecretFood/FatSecretServing rows. OFF by default so a run is read-only.');
        process.exitCode = 1;
        return;
    }

    // Validated, not coerced: see parseIntFlag. `--per-class-cap 0` is the documented
    // "unlimited", so its floor is 0; a probe pool of 0 is meaningless, so that floor is 1.
    const concurrency = parseIntFlag('--concurrency', val('--concurrency'), 4, 1);
    const perClassCap = parseIntFlag('--per-class-cap', val('--per-class-cap'), 25, 0);
    const limitRaw = val('--limit');
    const limit = limitRaw === undefined ? undefined : parseIntFlag('--limit', limitRaw, 0, 1);
    const noProbes = has('--no-probes');
    const dry = has('--dry');
    const wantIncumbent = !has('--no-incumbent');
    const fatsecret = has('--fatsecret');
    const extraLog: string[] = [];

    let prisma: PrismaLike | null = null;
    let rows: FunnelRow[];
    let inputLabel: string;

    if (fromDb) {
        const sinceRaw = val('--since');
        const since = sinceRaw ? new Date(sinceRaw) : undefined;
        if (since && Number.isNaN(since.getTime())) throw new FlagError(`--since is not a date: ${sinceRaw}`);
        const dbLimit = limit ?? 20000;
        prisma = openPrisma();
        const inputs = await readFromDb(prisma, { since, limit: dbLimit });
        rows = inputs.map(makeFunnelRow);
        inputLabel = `MappingEventLog (SELECT only)${sinceRaw ? ` since ${sinceRaw}` : ''} limit ${dbLimit}`;
        if (inputs.length === dbLimit) {
            extraLog.push(`--limit ${dbLimit} was REACHED exactly (${inputs.length} rows read): the event log almost `
                + 'certainly holds older matching rows this run never saw. Raise --limit or narrow --since.');
        }
    } else {
        const fileRows = readInputRows(inFile!);
        const limited = applyInputLimit(fileRows, limit);
        rows = limited.rows;
        extraLog.push(...limited.log);
        const rel = path.relative(process.cwd(), inFile!);
        inputLabel = rel.startsWith('..') ? inFile! : rel;
        if (rows.length !== fileRows.length) {
            inputLabel += ` (--limit ${limit}: ${rows.length} of ${fileRows.length} rows)`;
        }
        // The approximate read. warm JSONL records no servingTier, so F2's
        // flat100gServing quality flag falls back to grams === 100 and counts
        // records whose label genuinely IS 100 g. --from-db has the real tier.
        extraLog.push('input is a warm file: servingTier is NOT recorded there, so the flat-100g signal falls '
            + 'back to grams === 100 and OVER-COUNTS serving-flat-100g-fallthrough. Use --from-db for the '
            + 'precise read.');
    }

    if (rows.length === 0) {
        // Fail closed (playbook §11 class B): an empty triage batch must not
        // read as "nothing to triage" — it means the input was empty or the
        // DB window matched nothing.
        console.error(`FAIL: ${inputLabel} yielded ZERO rows — an empty triage batch is a broken input, not a clean one; exit 2.`);
        process.exitCode = 2;
        if (prisma) await prisma.$disconnect();
        return;
    }

    if (wantIncumbent) {
        try {
            prisma = prisma ?? openPrisma();
            const keys = await attachIncumbents(prisma, rows);
            extraLog.push(`hadIncumbent resolved for ${keys} canonical cache keys (canonicalizeCacheKey applied — `
                + 'a raw normalizedForm join would report cached keys as cold).');
        } catch (err) {
            extraLog.push(`hadIncumbent lookup SKIPPED (${(err as Error).message}); incumbent counts read as unknown.`);
        }
    } else {
        extraLog.push('hadIncumbent lookup skipped (--no-incumbent); incumbent counts read as unknown.');
    }

    const selection = selectDrops(rows, { perClassCap });

    if (noProbes) {
        extraLog.push('probes: DISABLED (--no-probes). Verdicts rest on row facts only; no corpus-gap vs '
            + 'ranking-gap split and no repoint targets.');
        for (const d of selection.selected) d.evidence = deriveEvidence(d, null, probeQueryFor({ rawLine: d.seed, normalizedForm: d.normalizedForm } as FunnelRow));
    } else {
        extraLog.push(`probes: retrieval + filter-trace over ${selection.selected.length} distinct queries, `
            + `concurrency ${concurrency}. NO LLM calls (search + pure token logic only).`);
        extraLog.push(fatsecret
            ? 'FatSecret lane ON (--fatsecret): FS API quota is spent and FatSecretFood/FatSecretServing rows '
                + 'are background-upserted. This run is NOT strictly read-only.'
            : 'FatSecret lane OFF (default): FATSECRET_RETRIEVAL_ENABLED=false forced before the probe modules '
                + 'load, so no FS API calls and no FatSecretFood upserts. The candidate pool therefore excludes '
                + 'the fs lane — pass --fatsecret when triaging fs-related drops.');
        const probes = loadRealProbes({ fatsecret });
        await runProbes(selection.selected, probes, {
            concurrency,
            onProgress: (done, total) => {
                if (done % 25 === 0 || done === total) console.log(`  probed ${done}/${total}`);
            },
        });
    }

    const report = buildReport(selection, {
        inputLabel,
        mode: noProbes ? 'no-probes' : 'probes',
        concurrency,
        perClassCap,
        extraLog,
    });
    renderConsole(report);

    const base = resolveOutBase(val('--out'), new Date());
    const jsonPath = `${base}.json`;
    const mdPath = `${base}.md`;
    if (dry) {
        console.log(`\n--dry: nothing written. Would have written:\n  ${jsonPath}\n  ${mdPath}`);
    } else {
        fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
        fs.writeFileSync(jsonPath, JSON.stringify(report, null, 1));
        fs.writeFileSync(mdPath, renderMarkdown(report));
        console.log(`\nWrote:\n  ${jsonPath}\n  ${mdPath}`);
    }

    if (prisma) await prisma.$disconnect();
}

if (require.main === module) {
    main().catch(err => {
        // A bad flag is a user error, not a crash: print the message, not a stack.
        if (err instanceof FlagError) {
            console.error(`\n${err.message}\nRun with no arguments for usage. Nothing was written.`);
            process.exit(2);
        }
        console.error(err);
        process.exit(1);
    });
}
