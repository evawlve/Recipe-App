/**
 * validator-triage-queue.ts — the FIRST reader of MappingValidationVerdict.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The async cache validator (PR #288, live on the box since 2026-08-11) has
 * written a verdict per organic save and per nightly-sweep re-save ever since,
 * at roughly $0.007/verdict. Until this script the table had TWO WRITERS AND
 * ZERO READERS — `src/lib/mapping/cache-validator.ts` and
 * `scripts/migrate-smoke.ts` both `.create()`, and nothing in `src/`, `scripts/`
 * or the app ever ran a findMany/findFirst/count/aggregate/groupBy against it,
 * in Prisma or in raw SQL (re-derive:
 * `grep -rin mappingvalidationverdict src scripts prisma --include='*.ts'`).
 * `reviewedAt` is declared in the schema and has never been written by anything:
 * it is NULL on every row.
 *
 * So "SUSPECT feeds a repair queue" was a HUMAN CONVENTION, not code, and it
 * failed the way conventions do. `avocado bowl cava harissa` — 7 of 7 verdicts
 * SUSPECT/identity, billing 28 g / 70 kcal for a full CAVA entrée — sat unread
 * from 2026-08-12 until a human happened to notice it and repaired it in repair
 * batch 4 on 2026-08-14. `core fairlife power` (3/3 SUSPECT/serving) is still
 * unrepaired at the time of writing.
 *
 * ---------------------------------------------------------------------------
 * THE RULE
 * ---------------------------------------------------------------------------
 * Emit a triage candidate when a `(normalizedForm, foodId)` pair has
 *   - n >= MIN_N (default 3) verdicts,
 *   - all n SUSPECT (k = n unanimity), and
 *   - identical `billedGrams` across all n.
 * Specified by mobile `sync-docs/reports/2026-08-14_validator-backlog-screen-
 * assessment.md` §5(2), which owns the rule and its costing.
 *
 * The repeats are FREE. The 04:30 nightly flywheel sweep re-saves the same mined
 * hot-head key set, so a key that stays wrong is re-judged every night out of the
 * sweep budget — production is already running the k-of-n experiment. This script
 * only reads the result.
 *
 * ---------------------------------------------------------------------------
 * TWO HONEST LIMITS — carried here, not papered over
 * ---------------------------------------------------------------------------
 * 1. **n >= 3 IS CHOSEN FOR CONSERVATISM, NOT FROM A MEASURED OPERATING POINT.**
 *    The assessment can only size a TWO-call rule; there is no measurement that
 *    says 3 beats 2 or 4. It is cheap to be wrong about a threshold on a free,
 *    ~1-row/day trickle, and that is the whole argument for it. Do not quote 3 as
 *    calibrated, and do not read "0 candidates" as "the cache is clean".
 *
 * 2. **THIS READER SURFACES THE HOT HEAD, NEVER THE TAIL.** The rule needs
 *    repeats and only the nightly sweep produces them, over the key set it mines
 *    from MappingEventLog. The 4,468-row `validatedBy='ai'` backlog accrues NO
 *    free repeats, so it is structurally invisible here. A backlog audit is a
 *    fleet tranche (owner: the tail-audit reports), not this script.
 *
 * ---------------------------------------------------------------------------
 * THE POINTER MAY HAVE MOVED — reported, never silently dropped
 * ---------------------------------------------------------------------------
 * MappingValidationVerdict has NO foreign key and is point-in-time by design: it
 * records what was billed at save time. A FoodMapping row can be repointed or
 * evicted afterwards, which makes the verdicts STALE EVIDENCE about a record the
 * cache no longer serves. `avocado bowl cava harissa` is exactly this today — its
 * seven verdicts judge `off_0898328002222`, and repair batch 4 repointed the row
 * to `fs_75421144` on 2026-08-15.
 *
 * Dropping those would be the wrong call twice over: it would hide the one row
 * that proves the reader was needed, and a reader that silently omits repaired
 * rows cannot be used to check whether a repair landed. So every qualifying pair
 * is reported with a `pointerStatus`:
 *   - `live`        — FoodMapping still points at the judged record. ACTIONABLE.
 *   - `repointed`   — the row now points elsewhere; verdicts predate the change.
 *   - `missing`     — no FoodMapping row for that key any more (evicted).
 *   - `unresolvable`— the row carries no off_/fdc_/fs_ target at all (the save
 *                     path refuses to write this; reported rather than crashed).
 *
 * ---------------------------------------------------------------------------
 * WHAT IT WRITES
 * ---------------------------------------------------------------------------
 * Its own two report files under scripts/eval/results/, and NOTHING else. It runs
 * SELECTs only: it never sets `reviewedAt`, never touches FoodMapping, never
 * calls the mapper, and makes no LLM call. Because it does not write `reviewedAt`,
 * **a candidate re-appears on every run until a human acts on it** — this is a
 * standing report, not a work queue that drains itself.
 *
 * Run (from the backend repo root):
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/eval/validator-triage-queue.ts
 *
 *   # show the comparator the rule is defended against, and every near miss
 *   ... scripts/eval/validator-triage-queue.ts --all
 *   # sensitivity: what a different threshold would have emitted
 *   ... scripts/eval/validator-triage-queue.ts --min-n 2
 *   # print only, write no files
 *   ... scripts/eval/validator-triage-queue.ts --dry
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// The threshold
// ---------------------------------------------------------------------------

/**
 * Minimum verdicts on a pair before unanimity means anything.
 *
 * CONSERVATISM, NOT CALIBRATION — see limit 1 in the header. Exported so the
 * tests and the report both quote the same number instead of restating it.
 */
export const TRIAGE_MIN_N = 3;

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

/** One MappingValidationVerdict row, exactly the columns this screen reads. */
export interface VerdictRecord {
    /** Canonical FoodMapping key (token-sorted PK) — NOT MappingEventLog.normalizedForm. */
    normalizedForm: string;
    /** Prefixed record id judged at save time: off_/fdc_/fs_. */
    foodId: string;
    /** The line as judged. Carried VERBATIM — it is the measured-to-reach probe text. */
    phrase: string;
    verdict: string;
    axis: string;
    reason: string;
    model: string;
    billedGrams: number;
    billedKcal: number;
    servingTier: string | null;
    createdAt: Date;
}

/**
 * A FoodMapping row as this screen reads it. FoodMapping has no `foodId` column —
 * the target lives in one of three nullable columns — so the prefixed id has to be
 * reconstructed to be compared with a verdict's `foodId`.
 */
export interface MappingPointer {
    normalizedForm: string;
    source: string;
    offBarcode: string | null;
    fdcId: number | null;
    fsId: string | null;
    foodName: string;
    brandName: string | null;
    validatedBy: string;
    validatedAt: Date;
}

/**
 * Rebuild the prefixed record id from a FoodMapping row.
 *
 * The exact inverse of the decomposition in `saveValidatedMapping()`
 * (`src/lib/mapping/validated-mapping-helpers.ts`), which splits
 * `off_<barcode>` / `fdc_<digits>` / `fs_<digits>` into offBarcode / fdcId / fsId
 * and REFUSES to write a row with none of them. Returns null for such a row rather
 * than inventing a target — `pointerStatusOf()` reports it as `unresolvable`.
 */
export function mappingTargetId(m: Pick<MappingPointer, 'offBarcode' | 'fdcId' | 'fsId'>): string | null {
    if (m.offBarcode != null) return `off_${m.offBarcode}`;
    if (m.fdcId != null) return `fdc_${m.fdcId}`;
    if (m.fsId != null) return `fs_${m.fsId}`;
    return null;
}

export type PointerStatus = 'live' | 'repointed' | 'missing' | 'unresolvable';

/** Where the cache points TODAY relative to the record these verdicts judged. */
export function pointerStatusOf(judgedFoodId: string, mapping: MappingPointer | null | undefined): PointerStatus {
    if (!mapping) return 'missing';
    const current = mappingTargetId(mapping);
    if (current == null) return 'unresolvable';
    return current === judgedFoodId ? 'live' : 'repointed';
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface PairGroup {
    normalizedForm: string;
    foodId: string;
    /** Every verdict on this pair, oldest first. */
    verdicts: VerdictRecord[];
    n: number;
    suspectCount: number;
    okCount: number;
    /**
     * Distinct billedGrams values, in first-seen order. EXACT equality, not a
     * tolerance: "identical" is the specified predicate, and a tolerance would be
     * a second knob nobody has measured. More than one entry means the bill moved
     * between judgements, so the verdicts are not all about the same claim.
     */
    distinctBilledGrams: number[];
    /** axis -> count, over the SUSPECT verdicts only (an OK always carries 'none'). */
    axisCounts: Record<string, number>;
    /**
     * Distinct phrases, in first-seen order. Usually one. More than one is worth
     * seeing: the replay phrase must be probed verbatim, so an ambiguous phrase is
     * a fact the reviewer needs rather than a detail to average away.
     */
    phrases: string[];
    firstSeen: Date;
    lastSeen: Date;
    /** Distinct UTC calendar days the verdicts span — the sweep runs once a night. */
    nights: number;
}

/** Group verdicts by `(normalizedForm, foodId)`, preserving first-seen order. */
export function groupByPair(verdicts: VerdictRecord[]): PairGroup[] {
    const byKey = new Map<string, VerdictRecord[]>();
    for (const v of verdicts) {
        // Newline separator, NOT a space: normalizedForm is itself a space-joined
        // token-sorted key, so a space-joined composite could collide across the
        // boundary. A newline cannot occur in either column.
        const key = `${v.normalizedForm}\n${v.foodId}`;
        const hit = byKey.get(key);
        if (hit) hit.push(v);
        else byKey.set(key, [v]);
    }

    const groups: PairGroup[] = [];
    for (const rows of byKey.values()) {
        const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        const distinctBilledGrams: number[] = [];
        const phrases: string[] = [];
        const axisCounts: Record<string, number> = {};
        let suspectCount = 0;
        const days = new Set<string>();
        for (const v of sorted) {
            if (!distinctBilledGrams.includes(v.billedGrams)) distinctBilledGrams.push(v.billedGrams);
            if (!phrases.includes(v.phrase)) phrases.push(v.phrase);
            if (v.verdict === 'SUSPECT') {
                suspectCount++;
                axisCounts[v.axis] = (axisCounts[v.axis] ?? 0) + 1;
            }
            days.add(v.createdAt.toISOString().slice(0, 10));
        }
        groups.push({
            normalizedForm: sorted[0].normalizedForm,
            foodId: sorted[0].foodId,
            verdicts: sorted,
            n: sorted.length,
            suspectCount,
            okCount: sorted.length - suspectCount,
            distinctBilledGrams,
            axisCounts,
            phrases,
            firstSeen: sorted[0].createdAt,
            lastSeen: sorted[sorted.length - 1].createdAt,
            nights: days.size,
        });
    }
    return groups;
}

// ---------------------------------------------------------------------------
// The predicate
// ---------------------------------------------------------------------------

export interface ScreenResult {
    qualifies: boolean;
    /** Why it did NOT qualify — empty iff `qualifies`. One entry per failed clause. */
    failReasons: string[];
}

/**
 * The rule, as three independent clauses. PURE — no DB, no clock.
 *
 * All three are evaluated even when the first fails, so a near miss reports
 * everything wrong with it rather than only the first thing checked. That is what
 * makes the `--all` near-miss table readable as a comparator instead of a
 * one-clause-at-a-time trace.
 */
export function screenPair(group: PairGroup, minN: number = TRIAGE_MIN_N): ScreenResult {
    const failReasons: string[] = [];
    if (group.n < minN) {
        failReasons.push(`n=${group.n} < ${minN} (not enough repeats yet; the nightly sweep adds ~1/night)`);
    }
    if (group.suspectCount !== group.n) {
        failReasons.push(`not unanimous: ${group.suspectCount}/${group.n} SUSPECT `
            + `(${group.okCount} OK) — a split panel is disagreement, not a finding`);
    }
    if (group.distinctBilledGrams.length !== 1) {
        failReasons.push(`billedGrams varies across the verdicts (${group.distinctBilledGrams.join(', ')}) `
            + '— the judgements are not about the same bill');
    }
    return { qualifies: failReasons.length === 0, failReasons };
}

/** "Any SUSPECT on a repeated pair" — the naive screen the rule is defended against. */
export function naiveAnySuspect(group: PairGroup): boolean {
    return group.n > 1 && group.suspectCount > 0;
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export interface TriageCandidate {
    normalizedForm: string;
    /** The record the verdicts judged. */
    foodId: string;
    n: number;
    /** The single billedGrams every verdict agreed on — the rule guarantees exactly one. */
    billedGrams: number;
    billedKcal: number[];
    servingTiers: (string | null)[];
    axisCounts: Record<string, number>;
    /** Verbatim. Probe these EXACTLY — they are the measured-to-reach text. */
    phrases: string[];
    /** One reason string per verdict, oldest first — the judge's own words. */
    reasons: string[];
    models: string[];
    firstSeen: string;
    lastSeen: string;
    nights: number;
    pointerStatus: PointerStatus;
    /** What the cache points at NOW; null when the row is gone or has no target. */
    currentFoodId: string | null;
    currentFoodName: string | null;
    currentBrandName: string | null;
    currentValidatedBy: string | null;
    currentValidatedAt: string | null;
    /** Plain-language statement of what the pointerStatus means for acting on this row. */
    note: string;
}

export interface NearMiss {
    normalizedForm: string;
    foodId: string;
    n: number;
    suspectCount: number;
    distinctBilledGrams: number[];
    axisCounts: Record<string, number>;
    failReasons: string[];
    /** True when the naive "any SUSPECT on a repeated pair" screen WOULD have emitted it. */
    naiveWouldEmit: boolean;
}

export interface TriageQueueReport {
    at: string;
    minN: number;
    /** Totals over the whole table, so a candidate count has a denominator. */
    verdictCount: number;
    suspectVerdictCount: number;
    distinctPairCount: number;
    repeatedPairCount: number;
    /** How many rows carry a reviewedAt — expected 0; nothing in either repo writes it. */
    reviewedCount: number;
    /** Pairs the rule emits. */
    candidates: TriageCandidate[];
    /** Of those, the ones still pointing at the judged record. */
    actionableCount: number;
    staleCount: number;
    byPointerStatus: Record<PointerStatus, number>;
    /** Pairs the naive comparator would emit — the receipt for the rule's strictness. */
    naiveCandidateCount: number;
    nearMisses: NearMiss[];
    caveats: string[];
    log: string[];
}

function iso(d: Date): string {
    return d.toISOString();
}

function noteFor(status: PointerStatus, judged: string, current: string | null, validatedBy: string | null): string {
    switch (status) {
        case 'live':
            return `ACTIONABLE — FoodMapping still points at ${judged}`
                + (validatedBy ? ` (validatedBy '${validatedBy}')` : '')
                + '. The verdicts describe what the cache serves today.';
        case 'repointed':
            return `STALE EVIDENCE — the verdicts judge ${judged}, but FoodMapping now points at `
                + `${current}${validatedBy ? ` (validatedBy '${validatedBy}')` : ''}. The row was repaired or `
                + 're-derived after these verdicts were written. Re-probe the phrase before acting; if it is '
                + 'now correct, this pair is evidence the repair landed, not a defect.';
        case 'missing':
            return 'STALE EVIDENCE — no FoodMapping row exists for this key any more (evicted, or the key '
                + 'changed under a RULES_VERSION/normalization bump). Nothing to repoint; re-probe the phrase '
                + 'to see what the pipeline returns cold.';
        case 'unresolvable':
            return 'ANOMALY — the FoodMapping row exists but carries no off_/fdc_/fs_ target. '
                + 'saveValidatedMapping() refuses to write such a row, so this is worth investigating on its '
                + 'own before treating the verdicts as a mapping defect.';
    }
}

/**
 * Screen the verdicts and attach today's pointer state.
 *
 * ORDER IS DELIBERATE: the rule is applied to the VERDICT EVIDENCE first, and the
 * pointer is consulted only to LABEL what came out. Screening on "still points at
 * the judged record" would silently drop every pair a repair already fixed, which
 * is both the wrong report (it hides the rows that prove the reader works) and
 * unusable for checking whether a repair landed.
 */
export function buildTriageQueue(
    verdicts: VerdictRecord[],
    mappings: MappingPointer[],
    opts: { minN?: number; at?: Date; reviewedCount?: number } = {},
): TriageQueueReport {
    const minN = opts.minN ?? TRIAGE_MIN_N;
    const at = opts.at ?? new Date();
    const byForm = new Map(mappings.map(m => [m.normalizedForm, m]));

    const groups = groupByPair(verdicts);
    const candidates: TriageCandidate[] = [];
    const nearMisses: NearMiss[] = [];
    const byPointerStatus: Record<PointerStatus, number> = { live: 0, repointed: 0, missing: 0, unresolvable: 0 };
    let naiveCandidateCount = 0;
    let repeatedPairCount = 0;

    for (const g of groups) {
        if (g.n > 1) repeatedPairCount++;
        const naive = naiveAnySuspect(g);
        if (naive) naiveCandidateCount++;

        const screen = screenPair(g, minN);
        if (!screen.qualifies) {
            // Only pairs with SUSPECT evidence are worth showing as near misses; an
            // all-OK pair is not a miss, it is a pass.
            if (g.suspectCount > 0) {
                nearMisses.push({
                    normalizedForm: g.normalizedForm,
                    foodId: g.foodId,
                    n: g.n,
                    suspectCount: g.suspectCount,
                    distinctBilledGrams: g.distinctBilledGrams,
                    axisCounts: g.axisCounts,
                    failReasons: screen.failReasons,
                    naiveWouldEmit: naive,
                });
            }
            continue;
        }

        const mapping = byForm.get(g.normalizedForm) ?? null;
        const status = pointerStatusOf(g.foodId, mapping);
        byPointerStatus[status]++;
        const current = mapping ? mappingTargetId(mapping) : null;
        candidates.push({
            normalizedForm: g.normalizedForm,
            foodId: g.foodId,
            n: g.n,
            billedGrams: g.distinctBilledGrams[0],
            billedKcal: Array.from(new Set(g.verdicts.map(v => v.billedKcal))),
            servingTiers: Array.from(new Set(g.verdicts.map(v => v.servingTier))),
            axisCounts: g.axisCounts,
            phrases: g.phrases,
            reasons: g.verdicts.map(v => v.reason),
            models: Array.from(new Set(g.verdicts.map(v => v.model))),
            firstSeen: iso(g.firstSeen),
            lastSeen: iso(g.lastSeen),
            nights: g.nights,
            pointerStatus: status,
            currentFoodId: current,
            currentFoodName: mapping?.foodName ?? null,
            currentBrandName: mapping?.brandName ?? null,
            currentValidatedBy: mapping?.validatedBy ?? null,
            currentValidatedAt: mapping ? iso(mapping.validatedAt) : null,
            note: noteFor(status, g.foodId, current, mapping?.validatedBy ?? null),
        });
    }

    // Worst first: most verdicts, then most recent.
    candidates.sort((a, b) => b.n - a.n || b.lastSeen.localeCompare(a.lastSeen) || a.normalizedForm.localeCompare(b.normalizedForm));
    nearMisses.sort((a, b) => b.suspectCount - a.suspectCount || b.n - a.n || a.normalizedForm.localeCompare(b.normalizedForm));

    const actionableCount = byPointerStatus.live;
    const staleCount = candidates.length - actionableCount;

    const caveats: string[] = [
        `RULE: n >= ${minN} verdicts on a (normalizedForm, foodId) pair, ALL SUSPECT, with identical `
        + 'billedGrams. Owner: mobile sync-docs/reports/2026-08-14_validator-backlog-screen-assessment.md §5(2).',
        `n >= ${minN} IS CHOSEN FOR CONSERVATISM, NOT FROM A MEASURED OPERATING POINT. No measurement says `
        + `${minN} beats 2 or 4; the assessment can only size a two-call rule. Do not quote it as calibrated.`,
        'THIS SURFACES THE HOT HEAD, NEVER THE TAIL. Only the 04:30 nightly sweep produces the free repeats '
        + "this rule needs, and it re-validates the key set it mines from MappingEventLog. The 4,468-row "
        + "validatedBy='ai' backlog accrues no repeats and is structurally invisible here — audit it with a "
        + 'fleet tranche, not this script.',
        'ZERO CANDIDATES IS NOT "THE CACHE IS CLEAN". It means no pair reached unanimity at this threshold in '
        + 'the verdicts written so far — a statement about ~1 row/day of evidence, not about the cache.',
        'reviewedAt IS NOT WRITTEN by this script (it is read-only), so a candidate RE-APPEARS on every run '
        + 'until a human acts. This is a standing report, not a self-draining queue.',
        'The verdict table has NO foreign key and is point-in-time. A candidate whose pointerStatus is not '
        + '`live` is stale evidence about a record the cache no longer serves — reported, never dropped.',
        'PROBE THE PHRASE VERBATIM. `phrases` carries the exact text each verdict judged; it is the '
        + 'measured-to-reach string, and re-typing it from the normalizedForm key mis-routes.',
    ];

    const log: string[] = [
        `read ${verdicts.length} verdict row(s) → ${groups.length} distinct (normalizedForm, foodId) pair(s), `
        + `${repeatedPairCount} of them repeated (n > 1).`,
        `rule (n >= ${minN}, unanimous SUSPECT, identical billedGrams) emits ${candidates.length} candidate(s): `
        + `${actionableCount} actionable (pointer still live), ${staleCount} stale.`,
        `comparator: the naive "any SUSPECT on a repeated pair" screen would emit ${naiveCandidateCount}.`,
    ];
    if (candidates.length === 0) {
        log.push('NOTE: zero candidates. See the caveat above — this is the expected steady state for a '
            + '~1-row/day stream, not a clean bill of health.');
    }

    return {
        at: iso(at),
        minN,
        verdictCount: verdicts.length,
        suspectVerdictCount: verdicts.filter(v => v.verdict === 'SUSPECT').length,
        distinctPairCount: groups.length,
        repeatedPairCount,
        reviewedCount: opts.reviewedCount ?? 0,
        candidates,
        actionableCount,
        staleCount,
        byPointerStatus,
        naiveCandidateCount,
        nearMisses,
        caveats,
        log,
    };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function fmtAxis(counts: Record<string, number>): string {
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return entries.length ? entries.map(([k, v]) => `${k} ${v}`).join(', ') : '—';
}

export function renderConsole(report: TriageQueueReport, opts: { all: boolean }): void {
    console.log('');
    console.log('MappingValidationVerdict — triage candidates');
    console.log('='.repeat(78));
    for (const line of report.log) console.log(`  ${line}`);
    if (report.reviewedCount > 0) {
        console.log(`  NOTE: ${report.reviewedCount} row(s) carry a reviewedAt. Nothing in either repo writes that `
            + 'column, so something outside the tracked code is now setting it.');
    }
    console.log('');

    if (report.candidates.length === 0) {
        console.log('  No candidates at this threshold.');
    }
    for (const c of report.candidates) {
        const tag = c.pointerStatus === 'live' ? 'ACTIONABLE' : `STALE/${c.pointerStatus}`;
        console.log(`  [${tag}] ${c.normalizedForm}`);
        console.log(`      judged ${c.foodId} · ${c.n}/${c.n} SUSPECT over ${c.nights} night(s) · axis ${fmtAxis(c.axisCounts)}`);
        console.log(`      billed ${c.billedGrams} g / ${c.billedKcal.join(', ')} kcal · tier ${c.servingTiers.map(t => t ?? 'null').join(', ')}`);
        console.log(`      phrase (probe VERBATIM): ${c.phrases.map(p => JSON.stringify(p)).join(' | ')}`);
        if (c.pointerStatus !== 'live') {
            console.log(`      now points at: ${c.currentFoodId ?? '(none)'}`
                + (c.currentFoodName ? ` "${c.currentFoodName}"${c.currentBrandName ? ` [${c.currentBrandName}]` : ''}` : '')
                + (c.currentValidatedBy ? ` (validatedBy '${c.currentValidatedBy}')` : ''));
        }
        console.log(`      ${c.note}`);
        console.log(`      judge: ${c.reasons[0]}`);
        console.log('');
    }

    if (opts.all) {
        console.log(`  Near misses (${report.nearMisses.length}) — pairs with SUSPECT evidence the rule does NOT emit:`);
        for (const m of report.nearMisses) {
            console.log(`    ${m.normalizedForm} → ${m.foodId} (${m.suspectCount}/${m.n} SUSPECT`
                + `${m.naiveWouldEmit ? ', NAIVE WOULD EMIT' : ''})`);
            for (const r of m.failReasons) console.log(`      · ${r}`);
        }
        console.log('');
    } else if (report.nearMisses.length > 0) {
        console.log(`  ${report.nearMisses.length} near miss(es) not shown — pass --all.`);
        console.log('');
    }

    console.log('  Caveats:');
    for (const c of report.caveats) console.log(`   - ${c}`);
    console.log('');
}

export function renderMarkdown(report: TriageQueueReport): string {
    const L: string[] = [];
    L.push('# MappingValidationVerdict — triage candidates');
    L.push('');
    L.push(`Generated ${report.at} · rule: n >= ${report.minN}, unanimous SUSPECT, identical billedGrams.`);
    L.push('');
    L.push('## Run');
    L.push('');
    for (const line of report.log) L.push(`- ${line}`);
    L.push('');
    L.push('## Candidates');
    L.push('');
    if (report.candidates.length === 0) {
        L.push('_None at this threshold. See the caveats — this is the expected steady state, not a clean bill of health._');
    } else {
        L.push('| status | normalizedForm | judged foodId | n | billed g | axis | nights | now points at |');
        L.push('|---|---|---|---:|---:|---|---:|---|');
        for (const c of report.candidates) {
            L.push(`| ${c.pointerStatus} | \`${c.normalizedForm}\` | \`${c.foodId}\` | ${c.n} | ${c.billedGrams} `
                + `| ${fmtAxis(c.axisCounts)} | ${c.nights} | ${c.pointerStatus === 'live' ? '(unchanged)' : `\`${c.currentFoodId ?? 'none'}\``} |`);
        }
        L.push('');
        for (const c of report.candidates) {
            L.push(`### \`${c.normalizedForm}\` → \`${c.foodId}\``);
            L.push('');
            L.push(`- **${c.pointerStatus}** — ${c.note}`);
            L.push(`- ${c.n}/${c.n} SUSPECT over ${c.nights} night(s), ${c.firstSeen} → ${c.lastSeen}`);
            L.push(`- billed **${c.billedGrams} g / ${c.billedKcal.join(', ')} kcal**, tier ${c.servingTiers.map(t => t ?? 'null').join(', ')}`);
            L.push(`- axis: ${fmtAxis(c.axisCounts)}`);
            L.push(`- phrase (probe VERBATIM): ${c.phrases.map(p => `\`${p}\``).join(' | ')}`);
            L.push(`- judged by: ${c.models.join(', ')}`);
            L.push('- judge reasons:');
            for (const r of c.reasons) L.push(`  - ${r}`);
            L.push('');
        }
    }
    L.push('## Near misses');
    L.push('');
    L.push(`The naive "any SUSPECT on a repeated pair" screen would emit **${report.naiveCandidateCount}**; `
        + `this rule emits **${report.candidates.length}**.`);
    L.push('');
    if (report.nearMisses.length === 0) {
        L.push('_None._');
    } else {
        L.push('| normalizedForm | foodId | k/n SUSPECT | naive would emit | why not emitted |');
        L.push('|---|---|---|---|---|');
        for (const m of report.nearMisses) {
            L.push(`| \`${m.normalizedForm}\` | \`${m.foodId}\` | ${m.suspectCount}/${m.n} | `
                + `${m.naiveWouldEmit ? 'yes' : 'no'} | ${m.failReasons.join('; ')} |`);
        }
    }
    L.push('');
    L.push('## Caveats');
    L.push('');
    for (const c of report.caveats) L.push(`- ${c}`);
    L.push('');
    return L.join('\n');
}

// ---------------------------------------------------------------------------
// DB access (never reached by the unit tests)
// ---------------------------------------------------------------------------

export interface PrismaLike {
    mappingValidationVerdict: {
        findMany: (args: unknown) => Promise<VerdictRecord[]>;
        count: (args?: unknown) => Promise<number>;
    };
    foodMapping: { findMany: (args: unknown) => Promise<MappingPointer[]> };
    $disconnect: () => Promise<void>;
}

export function openPrisma(): PrismaLike {
    // Required lazily so the unit tests never construct a client.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv/config');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaClient } = require('@prisma/client');
    return new PrismaClient() as PrismaLike;
}

/** SELECT only. Reads the whole table — it is ~100 rows and grows ~1/day. */
export async function readVerdicts(prisma: PrismaLike): Promise<VerdictRecord[]> {
    return prisma.mappingValidationVerdict.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
            normalizedForm: true, foodId: true, phrase: true, verdict: true, axis: true,
            reason: true, model: true, billedGrams: true, billedKcal: true, servingTier: true,
            createdAt: true,
        },
    });
}

/** SELECT only. Chunked because `in` lists are the one thing that gets long here. */
export async function readMappings(
    prisma: PrismaLike,
    normalizedForms: string[],
    chunkSize = 500,
): Promise<MappingPointer[]> {
    const out: MappingPointer[] = [];
    for (let i = 0; i < normalizedForms.length; i += chunkSize) {
        const chunk = normalizedForms.slice(i, i + chunkSize);
        const rows = await prisma.foodMapping.findMany({
            where: { normalizedForm: { in: chunk } },
            select: {
                normalizedForm: true, source: true, offBarcode: true, fdcId: true, fsId: true,
                foodName: true, brandName: true, validatedBy: true, validatedAt: true,
            },
        });
        out.push(...rows);
    }
    return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Thrown for a bad flag value; main() prints the message and exits non-zero. */
export class FlagError extends Error { }

/**
 * Parse an integer flag, or REFUSE the run. A typo must not be able to
 * manufacture a clean-looking empty report — `--min-n abc` silently coerced to
 * NaN would make every comparison false and emit zero candidates.
 */
export function parseIntFlag(flag: string, raw: string | undefined, fallback: number, min: number): number {
    if (raw === undefined) return fallback;
    const trimmed = raw.trim();
    const n = Number(trimmed);
    if (trimmed.length === 0 || !Number.isFinite(n) || !Number.isInteger(n)) {
        throw new FlagError(`${flag} must be an integer, got "${raw}". `
            + (trimmed.startsWith('--')
                ? `That looks like the next flag — ${flag} takes a value.`
                : 'A non-numeric value would silently emit an empty queue, so it is refused.'));
    }
    if (n < min) throw new FlagError(`${flag} must be >= ${min}, got ${n}.`);
    return n;
}

export function resolveOutBase(out: string | undefined, at: Date): string {
    if (out) return out.replace(/\.(json|md)$/i, '');
    const ts = at.toISOString().replace(/[:.]/g, '-');
    return path.join(__dirname, 'results', `validator-triage-queue-${ts}`);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const has = (flag: string) => args.includes(flag);
    const val = (flag: string): string | undefined => {
        const i = args.indexOf(flag);
        return i >= 0 ? args[i + 1] : undefined;
    };

    if (has('--help') || has('-h')) {
        console.log('Usage: validator-triage-queue.ts [--min-n N] [--all] [--dry] [--out <path>]');
        console.log('');
        console.log('  Reads MappingValidationVerdict (SELECT only) and emits triage candidates:');
        console.log(`  a (normalizedForm, foodId) pair with n >= ${TRIAGE_MIN_N} verdicts, ALL SUSPECT, identical billedGrams.`);
        console.log('');
        console.log('  --min-n N   integer >= 1 (default 3). CONSERVATISM, not a measured operating point.');
        console.log('  --all       also print every near miss and why the rule skipped it.');
        console.log('  --dry       print the report, write no files.');
        console.log('  --out P     write to P.json / P.md instead of scripts/eval/results/.');
        console.log('');
        console.log('  Writes nothing to the database. reviewedAt is never set, so candidates re-appear');
        console.log('  on every run until a human acts on them.');
        return;
    }

    const minN = parseIntFlag('--min-n', val('--min-n'), TRIAGE_MIN_N, 1);
    const all = has('--all');
    const dry = has('--dry');

    const prisma = openPrisma();
    try {
        const verdicts = await readVerdicts(prisma);

        if (verdicts.length === 0) {
            // Fail closed. An empty verdict TABLE is a broken input, not a clean
            // cache: the validator is disabled, mis-keyed, or the table was
            // truncated. (Zero CANDIDATES from a non-empty table is a legitimate
            // result and exits 0 — see below.)
            console.error('FAIL: MappingValidationVerdict is EMPTY. That is a broken input, not a clean cache — '
                + 'check CACHE_VALIDATOR_ENABLED and VALIDATOR_AI_MODEL on the serving host, and that this '
                + 'process is pointed at the right DATABASE_URL. Exit 2.');
            process.exitCode = 2;
            return;
        }

        const reviewedCount = await prisma.mappingValidationVerdict.count({ where: { reviewedAt: { not: null } } });
        const forms = Array.from(new Set(verdicts.map(v => v.normalizedForm)));
        const mappings = await readMappings(prisma, forms);

        const report = buildTriageQueue(verdicts, mappings, { minN, reviewedCount });
        renderConsole(report, { all });

        const base = resolveOutBase(val('--out'), new Date());
        const jsonPath = `${base}.json`;
        const mdPath = `${base}.md`;
        if (dry) {
            console.log(`--dry: nothing written. Would have written:\n  ${jsonPath}\n  ${mdPath}`);
        } else {
            fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
            fs.writeFileSync(jsonPath, JSON.stringify(report, null, 1));
            fs.writeFileSync(mdPath, renderMarkdown(report));
            console.log(`Wrote:\n  ${jsonPath}\n  ${mdPath}`);
        }
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main().catch(err => {
        if (err instanceof FlagError) {
            console.error(`\n${err.message}\nRun with --help for usage. Nothing was written.`);
            process.exit(2);
        }
        console.error(err);
        process.exit(1);
    });
}
