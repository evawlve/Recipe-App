/**
 * replay-hand-corrupt-marks.ts — write and REPLAY the hand-authored half of
 * OffFood.corruptReason.
 *
 * WHY THIS EXISTS. `corruptReason` is one column holding two populations with
 * opposite recovery needs:
 *
 *   detector-derived  -> RE-DERIVED after a refresh (detect-corrupt-*.ts ->
 *                        mark-corrupt-off.ts). Never replayed, because a
 *                        refresh can deliver a CORRECTED panel and replaying a
 *                        stale mark would suppress a row OFF has since fixed.
 *   hand-authored     -> nothing re-derives them; no rule produces them. This
 *                        script is their mechanism.
 *
 * Treating them as one population is what lost the second. The 2026-07-21
 * triage batch wrote 50 hand marks; the 2026-07-30 refresh destroyed them and
 * the re-derive chain recovered zero, because re-derivation reproduces only
 * what a rule can find (owner: mobile
 * sync-docs/backend_integration_guide.md §"The hand-authored marks did not come
 * back"). The verdicts survived on disk and were not a restore input: 43 of 50
 * identified a row by seed and prose, and mark-corrupt-off.ts accepts nothing
 * but a scan JSON keyed by barcode.
 *
 * WHAT MAKES THIS A REPLAY AND NOT A RESTORE. The authored record lives in
 * src/lib/mapping/corrupt-off-handmarks.json — git-tracked, so it survives
 * a corpus truncate by construction, the same property corrupt-off-denylist.json
 * has. But every entry carries the MEASUREMENTS it was authored from, and
 * decideHandMark() (src/lib/mapping/corrupt-mark.ts) re-runs the human's
 * comparison against the live row before anything is written. A row whose panel,
 * name or serving mass has moved is SKIPPED and printed as a re-audit queue —
 * never re-marked. That is the same "re-run the verdict from measurements,
 * never trust a stored conclusion" discipline decideMark() applies to
 * panel-inflated-serving, and it is what keeps replay from reintroducing the
 * staleness the re-derive design exists to avoid.
 *
 * THE WRITE UNIT IS THE DUPLICATE GROUP, NOT THE BARCODE. Two measured
 * mechanisms make a single-barcode mark a no-op or self-reverting:
 *   - dedupe-off-mark.ts clears and recomputes every duplicateOfBarcode on each
 *     run and its isBetterRepresentative() ranks a CLEAN row above a marked one
 *     ahead of completeness. Marking only the elected representative therefore
 *     causes the next dedupe run to elect an unmarked twin and clear its
 *     duplicateOfBarcode, putting the identical bad panel back into the
 *     Typesense sync's WHERE.
 *   - a byte-identical panel under another brand is a different groupKey and
 *     survives untouched, so the re-resolution lands on it. That is the
 *     2026-08-08 eviction no-op (12 of 24 evicted keys re-resolved to the
 *     identical bad record) one layer up.
 * So the live group is recomputed here and the entry must either mark or
 * explicitly decline every member. A gap is FAIL-CLOSED.
 *
 * WHAT IS DELIBERATELY *NOT* SWEPT: rows that share only the calorie value with
 * an audited row. They are printed as `calorieTwins` for a human and never
 * written. Marking them would be a rule against an unmeasured false-positive
 * denominator, and a mark deletes a record from the corpus permanently — a
 * 100 kcal/100g row named "Sour cream" can legitimately be a light product.
 *
 * DRY-RUN BY DEFAULT. Two apply paths, deliberately different:
 *
 *   --apply --plan <approved.json>   FIRST-WRITE path. The plan is the approval
 *       record (emit it with --emit-plan): it enumerates the group expansion
 *       computed against the live corpus, and a human says yes to that SET.
 *       --apply refuses without it, refuses if the handmarks file has changed
 *       since the plan was emitted (sha256 pin), and refuses to write any
 *       barcode the plan does not list.
 *   --apply --replay                 REFRESH path, for refresh-off-from-parquet.sh.
 *       Writes only barcodes already enumerated in the git-tracked file — that
 *       enumeration IS the approval, reviewed when the file was committed — each
 *       re-verified by decideHandMark(). It cannot write a barcode the file does
 *       not name. If the live corpus has grown a group member the file does not
 *       cover, the entry is skipped and reported: exit 3, "completed with
 *       residue", the same contract restore-off-pointers.ts uses.
 *
 * Reason strings are `hand-triage-<authoredAt>:<class>`, so
 *   mark-corrupt-off.ts --clear --clear-prefix hand-triage-<date> --apply
 * reverses exactly one batch with no new rollback code. Verify the prefix is
 * selective with the same command WITHOUT --apply before trusting a batch.
 *
 * Run (from the backend repo root; DATABASE_URL must point at the target DB):
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
 *     scripts/replay-hand-corrupt-marks.ts --emit-plan /tmp/handmark-plan.json
 *   ... then, after approval:
 *   ... scripts/replay-hand-corrupt-marks.ts --apply --plan /tmp/handmark-plan.json
 *
 * Exit codes: 0 = success or dry run; 2 = refused (nothing written);
 *             3 = applied, with residue an operator must reconcile; 1 = crash.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import {
    HandMarkEntry,
    HandMarkLiveRow,
    HAND_MARK_PANEL_TOL,
    HAND_MARK_PREFIX,
    decideHandMark,
    handMarkGroupGaps,
    handMarkServingDrifted,
    handMarkUnitValid,
    handMarkUnits,
    readLivePanel,
} from '../src/lib/mapping/corrupt-mark';
import { normalizeNameKey, macroSignature } from '../src/lib/search/dedupe-candidates';

/**
 * The authored record. NOT under src/lib/mapping/data/ beside
 * corrupt-off-denylist.json, and the reason is measured, not stylistic: the
 * box's .stignore carries a bare unanchored `data` pattern (line 5), which
 * Syncthing matches at EVERY depth, so src/lib/mapping/data/ never reaches the
 * machine that runs the replay. Proved 2026-08-12 — a file written into that
 * directory did not arrive while scripts/replay-hand-corrupt-marks.ts, created
 * in the same minute, did; corrupt-off-denylist.json is present on the box only
 * because it predates the ignore and is hash-frozen there.
 *
 * That matters more here than anywhere else in the repo: a file whose entire
 * purpose is "it survives a refresh because it is in the repo" is worthless if
 * it never reaches the host that runs the refresh. Same failure class as the
 * PR #211 normalization-rules.json inertness, one directory level down.
 * Re-derive: ssh owner@192.168.1.133 'grep -n "^data$" /home/owner/Recipe-App/.stignore'
 */
export const HANDMARKS_PATH = path.join('src', 'lib', 'mapping', 'corrupt-off-handmarks.json');

/** Widest kcal gap two rows can have and still share a macroSignature bucket.
 *  macroSignature rounds kcal/10, so equal buckets imply |a-b| < 10. The group
 *  prefilter uses it as a SOUND (never-missing) narrowing of the corpus scan. */
export const GROUP_PREFILTER_KCAL_BAND = 10;
/** Two rows are "the same panel value" when every macro agrees this closely.
 *  Same tolerance the row-level staleness check uses. */
export const PANEL_TWIN_TOL = HAND_MARK_PANEL_TOL;
/** A name stem shorter than this makes the corpus prefilter useless (it would
 *  match most of a million rows), so an entry that produces one is refused
 *  rather than scanned. */
export const MIN_PREFILTER_STEM = 3;

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/** The OffFood columns this script reads. Nothing else is selected: the write
 *  touches one column and the verification reads the panel it was authored
 *  from. */
export interface OffRow {
    barcode: string;
    name: string;
    brandName: string | null;
    nutrientsPer100g: unknown;
    servingGrams: number | null;
    corruptReason: string | null;
    duplicateOfBarcode: string | null;
}

export type GroupBasisComputed = 'duplicate-group' | 'panel-twin' | 'calorie-twin';

export interface GroupClassification {
    /** Same dedupe groupKey() — the election can promote these. */
    duplicateGroup: OffRow[];
    /** Same normalized name key AND a byte-identical panel under another
     *  groupKey (usually another brand) — the re-resolution can land on these. */
    panelTwins: OffRow[];
    /** Same name key and the same calorie value but a DIFFERENT panel. Reported
     *  only: never written, never blocking. */
    calorieTwins: OffRow[];
}

// ---------------------------------------------------------------------------
// Pure helpers (no DB, no fs) — everything jest exercises lives here
// ---------------------------------------------------------------------------

export function sha256Hex(data: string | Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/** Narrow an OffRow to exactly the fields readLivePanel() reads. Explicit
 *  rather than a spread so a column added to OffRow later cannot silently
 *  change what the panel comparison sees. */
export function panelOf(row: OffRow): HandMarkLiveRow {
    return readLivePanel({
        barcode: row.barcode,
        name: row.name,
        corruptReason: row.corruptReason,
        nutrientsPer100g: row.nutrientsPer100g,
        servingGrams: row.servingGrams,
    });
}

/** kcal of a raw OffFood panel, with the same key aliases readLivePanel() uses. */
export function rowKcal(row: OffRow): number | null {
    return panelOf(row).kcal100;
}

/** The dedupe election's own group key, recomputed here from the same two
 *  functions dedupe-off-mark.ts uses. Deliberately not re-derived: this gate
 *  reasons about which rows that election can promote, so it has to group
 *  exactly the way the election does. */
export function offGroupKey(row: OffRow): string {
    const live = panelOf(row);
    return [
        normalizeNameKey(row.name ?? ''),
        (row.brandName ?? '').trim().toLowerCase(),
        macroSignature({
            kcal: live.kcal100 ?? 0,
            protein: live.protein ?? 0,
            carbs: live.carbs ?? 0,
            fat: live.fat ?? 0,
            per100g: true,
        }),
    ].join('|');
}

/**
 * A substring every same-name-key row is guaranteed to contain, used to narrow
 * the corpus scan before groupKey() is computed in JS.
 *
 * SOUNDNESS (this is the whole reason the prefilter is allowed to exist): two
 * rows share a normalizeNameKey only if, for each key token T, the other row's
 * raw name contains some token R with singularize(R) === T. singularize() only
 * ever strips a suffix or maps <stem>ies -> <stem>y, so R always contains T
 * minus a trailing "y". Taking the LONGEST token and stripping a trailing "y"
 * therefore cannot miss a group member. Returns null when no token survives the
 * MIN_PREFILTER_STEM floor — a caller must refuse rather than scan.
 */
export function prefilterStem(name: string): string | null {
    const tokens = normalizeNameKey(name).split(' ').filter(Boolean);
    let best: string | null = null;
    for (const t of tokens) {
        const stem = t.endsWith('y') ? t.slice(0, -1) : t;
        if (stem.length < MIN_PREFILTER_STEM) continue;
        if (!best || stem.length > best.length) best = stem;
    }
    return best;
}

function panelsMatch(a: OffRow, b: OffRow): boolean {
    const pa = panelOf(a);
    const pb = panelOf(b);
    const fields: Array<keyof HandMarkLiveRow> = ['kcal100', 'protein', 'fat', 'carbs'];
    for (const f of fields) {
        const va = pa[f] as number | null;
        const vb = pb[f] as number | null;
        if (va == null || vb == null) return false;
        if (Math.abs(va - vb) > PANEL_TWIN_TOL) return false;
    }
    return true;
}

/**
 * Split the corpus candidates for one target into the three bases. Precedence
 * is duplicate-group > panel-twin > calorie-twin so the sets are disjoint and a
 * row is reported under the strongest reason it qualifies for.
 */
export function classifyGroupCandidates(target: OffRow, candidates: readonly OffRow[]): GroupClassification {
    const key = offGroupKey(target);
    const nameKey = normalizeNameKey(target.name ?? '');
    const targetKcal = rowKcal(target);
    const out: GroupClassification = { duplicateGroup: [], panelTwins: [], calorieTwins: [] };
    for (const c of candidates) {
        if (c.barcode === target.barcode) continue;
        if (offGroupKey(c) === key) { out.duplicateGroup.push(c); continue; }
        if (normalizeNameKey(c.name ?? '') !== nameKey) continue;
        if (panelsMatch(target, c)) { out.panelTwins.push(c); continue; }
        const k = rowKcal(c);
        if (targetKcal != null && k != null && Math.abs(k - targetKcal) <= 0.5) out.calorieTwins.push(c);
    }
    return out;
}

/** The live members an entry must either mark or explicitly decline. Calorie
 *  twins are NOT here on purpose — see the header. */
export function blockingGroupBarcodes(g: GroupClassification): string[] {
    return [...g.duplicateGroup, ...g.panelTwins].map(r => r.barcode);
}

// ---------------------------------------------------------------------------
// Handmarks file
// ---------------------------------------------------------------------------

export type HandmarksParse =
    | { ok: true; entries: HandMarkEntry[]; sha256: string }
    | { ok: false; reason: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse and structurally validate the authored file. Fail-closed on anything
 * ambiguous, because every field here ends up deciding whether a row leaves the
 * search corpus.
 *
 * The duplicate-barcode check spans the WHOLE file (targets and group members
 * together): two entries claiming the same barcode would write two reason
 * strings for one row, and which one landed would depend on statement order.
 */
export function parseHandmarks(text: string): HandmarksParse {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch (e) {
        return { ok: false, reason: `handmarks file is not valid JSON: ${(e as Error).message}` };
    }
    if (!Array.isArray(raw)) return { ok: false, reason: 'handmarks file must be a JSON array' };

    const seen = new Map<string, string>();
    for (const [i, e] of (raw as HandMarkEntry[]).entries()) {
        const at = `entry ${i}`;
        if (!e || typeof e !== 'object') return { ok: false, reason: `${at}: not an object` };
        if (typeof e.barcode !== 'string' || !e.barcode.trim()) return { ok: false, reason: `${at}: missing barcode` };
        if (!['panel', 'serving', 'identity'].includes(e.class)) {
            return { ok: false, reason: `${at} (${e.barcode}): class must be panel|serving|identity, got ${JSON.stringify(e.class)}` };
        }
        if (typeof e.authoredAt !== 'string' || !ISO_DATE.test(e.authoredAt)) {
            return { ok: false, reason: `${at} (${e.barcode}): authoredAt must be YYYY-MM-DD` };
        }
        for (const f of ['seed', 'reason', 'source'] as const) {
            if (typeof e[f] !== 'string' || !e[f].trim()) return { ok: false, reason: `${at} (${e.barcode}): ${f} must be a non-empty string` };
        }
        if (!Array.isArray(e.group)) return { ok: false, reason: `${at} (${e.barcode}): group must be an array (use [] for none)` };
        for (const m of e.group) {
            if (!m || typeof m.barcode !== 'string' || !m.barcode.trim()) return { ok: false, reason: `${at} (${e.barcode}): group member missing barcode` };
            if (m.basis !== 'duplicate-group' && m.basis !== 'panel-twin') {
                return { ok: false, reason: `${at} (${e.barcode}): group member ${m.barcode} basis must be duplicate-group|panel-twin` };
            }
        }
        if (e.groupExclusions !== undefined) {
            if (!Array.isArray(e.groupExclusions)) return { ok: false, reason: `${at} (${e.barcode}): groupExclusions must be an array` };
            for (const x of e.groupExclusions) {
                if (!x || typeof x.barcode !== 'string' || typeof x.why !== 'string' || !x.why.trim()) {
                    return { ok: false, reason: `${at} (${e.barcode}): every groupExclusion needs a barcode and a non-empty why` };
                }
            }
        }
        // Structural validity of every unit's observations, via the same
        // predicate decideHandMark() gates on, so a malformed file is caught
        // here rather than silently producing entry_invalid skips at write time.
        for (const u of handMarkUnits(e)) {
            if (!handMarkUnitValid(u)) {
                return { ok: false, reason: `${at} (${e.barcode}): unit ${u.barcode} has an incomplete observed panel` };
            }
            const prev = seen.get(u.barcode);
            if (prev) return { ok: false, reason: `barcode ${u.barcode} appears twice (entries ${prev} and ${e.barcode})` };
            seen.set(u.barcode, e.barcode);
        }
    }
    return { ok: true, entries: raw as HandMarkEntry[], sha256: sha256Hex(text) };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface PlanUnit {
    barcode: string;
    basis: 'target' | 'duplicate-group' | 'panel-twin';
    verdict: 'write' | 'skip';
    reason?: string;
    skip?: string;
    detail?: string;
    /** Reported, never blocking: a panel/identity-class row whose serving mass
     *  moved since authoring. */
    servingDrift?: boolean;
}

export interface PlanEntry {
    barcode: string;
    class: string;
    seed: string;
    authoredReason: string;
    units: PlanUnit[];
    /** Live members the entry neither marks nor declines. Non-empty => refusal. */
    groupGaps: string[];
    /** Same name + same calories, different panel. Human review, never written. */
    calorieTwins: Array<{ barcode: string; name: string; brandName: string | null; kcal: number | null }>;
    affectedCacheRows: Array<{ normalizedForm: string; foodName: string | null; validatedBy: string | null }>;
}

export interface HandMarkPlan {
    at: string;
    generator: string;
    handmarksFile: string;
    handmarksSha256: string;
    reasonPrefixes: string[];
    entries: PlanEntry[];
    /** The exact rows --apply may write, and nothing else. */
    write: Array<{ barcode: string; reason: string }>;
    censusBefore: Record<string, number>;
    snapshotSql: { pre: string; post: string };
}

/** Sentinel written into groupGaps when the live group could not be computed at
 *  all (target row gone, or its name yields no usable prefilter stem). It is a
 *  gap, not an empty group: "0 members found" and "not looked at" are different
 *  states, and conflating them is the fail-open that lets a partial mark ship.
 *  Same lesson detect-panel-scale-divided.ts documents as "0 flagged means NOT
 *  LOOKED AT, not CLEAN". */
export const GROUP_NOT_SCANNED = '(group-not-scanned)';

export interface BuildPlanInput {
    entries: HandMarkEntry[];
    handmarksSha256: string;
    /** Live OffFood rows, by barcode, for every authored unit. */
    liveByBarcode: Map<string, OffRow>;
    /** Live group classification per target barcode. `null` means the scan could
     *  not run for that target — fail-closed, never treated as "no members". */
    groups: Map<string, GroupClassification | null>;
    cacheRows: Map<string, PlanEntry['affectedCacheRows']>;
    censusBefore: Record<string, number>;
    at: string;
}

/**
 * Compute the plan. PURE: every DB read is an input, so jest exercises the
 * entire decision surface — which units are written, which are skipped and why,
 * and whether the batch is refusable — with no database at all.
 */
export function buildPlan(input: BuildPlanInput): HandMarkPlan {
    const planEntries: PlanEntry[] = [];
    const write: Array<{ barcode: string; reason: string }> = [];
    const prefixes = new Set<string>();

    for (const entry of input.entries) {
        const group = input.groups.get(entry.barcode) ?? null;
        const empty: GroupClassification = { duplicateGroup: [], panelTwins: [], calorieTwins: [] };
        // An already-marked live member is covered: it is out of the index, so
        // the election cannot promote it over a marked twin for being clean.
        const alreadyMarked = new Set(
            [...(group ?? empty).duplicateGroup, ...(group ?? empty).panelTwins]
                .filter(r => r.corruptReason != null)
                .map(r => r.barcode)
        );
        const gaps = group
            ? handMarkGroupGaps(entry, blockingGroupBarcodes(group), alreadyMarked)
            : [GROUP_NOT_SCANNED];

        const units: PlanUnit[] = [];
        const entryWrites: Array<{ barcode: string; reason: string }> = [];
        const entryPrefixes = new Set<string>();
        for (const unit of handMarkUnits(entry)) {
            const raw = input.liveByBarcode.get(unit.barcode);
            const live = raw ? readLivePanel({ ...raw }) : null;
            const decision = decideHandMark(unit, live);
            const basis: PlanUnit['basis'] = unit.isGroupMember ? (unit.basis ?? 'panel-twin') : 'target';
            if (decision.mark) {
                entryPrefixes.add(`${HAND_MARK_PREFIX}${unit.authoredAt}`);
                units.push({
                    barcode: unit.barcode,
                    basis,
                    verdict: 'write',
                    reason: decision.reason,
                    servingDrift: live ? handMarkServingDrifted(unit, live) : false,
                });
                entryWrites.push({ barcode: unit.barcode, reason: decision.reason });
            } else {
                units.push({ barcode: unit.barcode, basis, verdict: 'skip', skip: decision.skip, detail: decision.detail });
            }
        }

        // A refusable entry contributes NO writes: the group gate is fail-closed
        // at the ENTRY level, not per row, because a partially marked group is
        // exactly the state dedupe re-elects out of.
        //
        // Both conditions are load-bearing and the second one used to be missing.
        // `gaps` proves only that the group is DECLARED covered — it is built from
        // the entry's barcode, group and groupExclusions, never from what will
        // actually be written. So a member that trips decideHandMark (panel_moved,
        // say) was recorded as a skip while its target was still pushed, which is
        // precisely the partial-group state this gate exists to prevent, and it
        // fired unattended on every --replay refresh. Commit only when the
        // declaration is complete AND every unit resolved to a write.
        if (gaps.length === 0 && units.every(u => u.verdict === 'write')) {
            for (const w of entryWrites) write.push(w);
            for (const p of entryPrefixes) prefixes.add(p);
        }

        planEntries.push({
            barcode: entry.barcode,
            class: entry.class,
            seed: entry.seed,
            authoredReason: entry.reason,
            units,
            groupGaps: gaps,
            calorieTwins: (group ?? empty).calorieTwins.map(r => ({
                barcode: r.barcode, name: r.name, brandName: r.brandName, kcal: rowKcal(r),
            })),
            affectedCacheRows: input.cacheRows.get(entry.barcode) ?? [],
        });
    }

    const barcodes = write.map(w => w.barcode);
    return {
        at: input.at,
        generator: 'scripts/replay-hand-corrupt-marks.ts',
        handmarksFile: HANDMARKS_PATH,
        handmarksSha256: input.handmarksSha256,
        reasonPrefixes: [...prefixes].sort(),
        entries: planEntries,
        write,
        censusBefore: input.censusBefore,
        snapshotSql: {
            pre: snapshotSql(barcodes),
            post: snapshotSql(barcodes),
        },
    };
}

/** The COPY the operator runs on the box either side of --apply. A corruptReason
 *  write is self-inverting (NULL is the only prior value it writes over) but the
 *  repoint campaign's lesson is that an UPDATE rollback wants both sides. */
export function snapshotSql(barcodes: readonly string[]): string {
    const list = barcodes.map(b => `'${b.replace(/'/g, "''")}'`).join(',');
    return `COPY (SELECT barcode, "corruptReason", "duplicateOfBarcode", "nutrientsPer100g", "servingGrams", "updatedAt" ` +
        `FROM "OffFood" WHERE barcode IN (${list}) ORDER BY barcode) TO STDOUT WITH (FORMAT csv, HEADER)`;
}

export type PlanParse = { ok: true; plan: HandMarkPlan } | { ok: false; reason: string };

/** Fail-closed plan validation. Anything a hand edit could use to widen the
 *  write set is checked, because --apply's whole contract is "nothing outside
 *  the approved set". */
export function validatePlanText(text: string): PlanParse {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch (e) {
        return { ok: false, reason: `plan is not valid JSON: ${(e as Error).message}` };
    }
    const p = raw as HandMarkPlan;
    if (!p || typeof p !== 'object') return { ok: false, reason: 'plan must be an object' };
    if (p.generator !== 'scripts/replay-hand-corrupt-marks.ts') {
        return { ok: false, reason: `plan was not produced by this script (generator=${JSON.stringify(p.generator)})` };
    }
    if (typeof p.handmarksSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(p.handmarksSha256)) {
        return { ok: false, reason: 'plan is missing a valid handmarksSha256' };
    }
    if (!Array.isArray(p.write)) return { ok: false, reason: 'plan.write must be an array' };
    const seen = new Set<string>();
    for (const w of p.write) {
        if (!w || typeof w.barcode !== 'string' || !w.barcode.trim()) return { ok: false, reason: 'plan.write entry missing barcode' };
        if (typeof w.reason !== 'string' || !w.reason.startsWith(HAND_MARK_PREFIX)) {
            return { ok: false, reason: `plan.write ${w.barcode}: reason must start with ${HAND_MARK_PREFIX} (got ${JSON.stringify(w.reason)})` };
        }
        if (seen.has(w.barcode)) return { ok: false, reason: `plan.write lists ${w.barcode} twice` };
        seen.add(w.barcode);
    }
    return { ok: true, plan: p };
}

export interface ApplySet {
    toWrite: Array<{ barcode: string; reason: string }>;
    /** Rows the plan approved that live no longer supports — staleness, not an
     *  error: printed and dropped. */
    droppedSincePlan: Array<{ barcode: string; skip: string; detail?: string }>;
    /** Rows live now wants that the plan does not approve — a REFUSAL: the group
     *  grew after approval, which is exactly what §3.2 predicts. */
    notInPlan: string[];
    /** Entries whose live group is not fully covered — a REFUSAL. */
    gaps: Array<{ entry: string; missing: string[] }>;
}

/**
 * Reconcile the freshly-recomputed live verdict against the approved plan.
 * PURE, and the direction matters: the plan can only ever SHRINK the write set.
 * A barcode live wants and the plan does not name is refused, never written.
 */
export function reconcileWithPlan(plan: HandMarkPlan, fresh: HandMarkPlan): ApplySet {
    const approved = new Map(plan.write.map(w => [w.barcode, w.reason]));
    const toWrite: ApplySet['toWrite'] = [];
    const notInPlan: string[] = [];
    for (const w of fresh.write) {
        if (!approved.has(w.barcode)) { notInPlan.push(w.barcode); continue; }
        toWrite.push({ barcode: w.barcode, reason: w.reason });
    }
    const freshWrite = new Set(fresh.write.map(w => w.barcode));
    const droppedSincePlan: ApplySet['droppedSincePlan'] = [];
    for (const w of plan.write) {
        if (freshWrite.has(w.barcode)) continue;
        const unit = fresh.entries.flatMap(e => e.units).find(u => u.barcode === w.barcode);
        droppedSincePlan.push({ barcode: w.barcode, skip: unit?.skip ?? 'not_reachable', detail: unit?.detail });
    }
    const gaps = fresh.entries
        .filter(e => e.groupGaps.length > 0)
        .map(e => ({ entry: e.barcode, missing: e.groupGaps }));
    return { toWrite, droppedSincePlan, notInPlan, gaps };
}

/**
 * Refresh-path write set: everything the file enumerates that still verifies.
 * No plan, because the git-tracked enumeration IS the approval — but the group
 * gate still applies, so an entry whose live group has grown is skipped whole
 * and reported as residue.
 */
export function replaySet(fresh: HandMarkPlan): ApplySet {
    return {
        toWrite: fresh.write.map(w => ({ barcode: w.barcode, reason: w.reason })),
        droppedSincePlan: fresh.entries.flatMap(e => e.units)
            .filter(u => u.verdict === 'skip')
            .map(u => ({ barcode: u.barcode, skip: u.skip ?? 'unknown', detail: u.detail })),
        notInPlan: [],
        gaps: fresh.entries.filter(e => e.groupGaps.length > 0).map(e => ({ entry: e.barcode, missing: e.groupGaps })),
    };
}

/**
 * Every apply-time refusal, in one pure predicate. Extracted from main() on
 * purpose: a gate that lives inside an async DB function is a gate no test can
 * kill, and this repo has shipped exactly that (a rule that scored 100% on its
 * fixture and false-evicted 73.8% of the real cache). Returns null when the
 * write may proceed.
 *
 * Mode matters: under --plan a group gap is a REFUSAL (the set was approved
 * without it); under --replay it is residue the caller reports and exits 3 on,
 * because aborting there would leave a rebuilt corpus with no hand marks at all.
 */
export function refuseApplySet(input: {
    set: ApplySet;
    mode: 'plan' | 'replay';
    /** sha256 recorded in the approved plan; null in replay mode. */
    planSha: string | null;
    /** sha256 of the handmarks file as read right now. */
    fileSha: string;
}): string | null {
    if (input.mode === 'plan') {
        if (input.planSha !== input.fileSha) {
            return `the handmarks file changed since this plan was emitted (plan ${input.planSha}, file ${input.fileSha}) — re-emit and get the new set approved`;
        }
        if (input.set.gaps.length) {
            return `live group members are neither marked nor declined: ` +
                input.set.gaps.map(g => `${g.entry} -> ${g.missing.join(',')}`).join('; ');
        }
    }
    if (input.set.notInPlan.length) {
        return `live wants to mark ${input.set.notInPlan.length} barcode(s) the approved plan does not list: ${input.set.notInPlan.join(', ')}`;
    }
    if (input.set.toWrite.length === 0) {
        // Same fail-closed reasoning as mark-corrupt-off.ts's --only-reasons
        // guard: an unattended caller must not read "marked 0" as success.
        return 'nothing to write — refusing to report a no-op as a result';
    }
    return null;
}

/**
 * The write statement. `AND f."corruptReason" IS NULL` is not decoration: it is
 * what makes the write non-destructive of a detector mark that landed between
 * the plan and the apply, and it is the SQL half of decideHandMark()'s
 * already_marked skip.
 */
export function buildMarkStatement(batch: ReadonlyArray<{ barcode: string; reason: string }>): Prisma.Sql {
    const values = Prisma.join(batch.map(w => Prisma.sql`(${w.barcode}, ${w.reason})`));
    return Prisma.sql`
        UPDATE "OffFood" AS f
        SET "corruptReason" = v.reason
        FROM (VALUES ${values}) AS v(barcode, reason)
        WHERE f.barcode = v.barcode AND f."corruptReason" IS NULL
    `;
}

export interface Args {
    apply: boolean;
    replay: boolean;
    plan: string | null;
    emitPlan: string | null;
    handmarks: string;
}

export function parseArgs(argv: readonly string[]): Args {
    const value = (flag: string): string | null => {
        const i = argv.indexOf(flag);
        return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
    };
    return {
        apply: argv.includes('--apply'),
        replay: argv.includes('--replay'),
        plan: value('--plan'),
        emitPlan: value('--emit-plan'),
        handmarks: value('--handmarks') ?? HANDMARKS_PATH,
    };
}

/** The gate on --apply, as a pure predicate so the refusal is testable without
 *  a database. Returns null when the invocation is allowed. */
export function refuseApply(args: Args): string | null {
    if (!args.apply) return null;
    if (args.replay && args.plan) return '--replay and --plan are different approval routes; pass one';
    if (!args.replay && !args.plan) {
        return '--apply refuses without --plan <approved plan.json> (emit one with --emit-plan) or --replay for the refresh chain';
    }
    return null;
}

// ---------------------------------------------------------------------------
// DB wiring
// ---------------------------------------------------------------------------

let prismaSingleton: PrismaClient | null = null;
/** Lazy so importing this module in jest never constructs a client or reads
 *  DATABASE_URL — the same import-safety property dedupe-off-mark.ts needed
 *  before its election logic could be tested at all. */
function db(): PrismaClient {
    if (!prismaSingleton) prismaSingleton = new PrismaClient();
    return prismaSingleton;
}

const OFF_SELECT = {
    barcode: true, name: true, brandName: true, nutrientsPer100g: true,
    servingGrams: true, corruptReason: true, duplicateOfBarcode: true,
} as const;

async function fetchByBarcode(barcodes: string[]): Promise<Map<string, OffRow>> {
    const out = new Map<string, OffRow>();
    for (let i = 0; i < barcodes.length; i += 500) {
        const rows = await db().offFood.findMany({
            where: { barcode: { in: barcodes.slice(i, i + 500) } },
            select: OFF_SELECT,
        });
        for (const r of rows) out.set(r.barcode, r as unknown as OffRow);
    }
    return out;
}

/**
 * Corpus scan for group candidates, narrowed by prefilterStem() + the
 * macroSignature kcal band. Both narrowings are proved sound above; the exact
 * grouping is then done in JS with the election's own functions.
 *
 * One pass over OffFood, not one per target (measured 2026-08-12: ~5s for the
 * 17-entry batch against the live corpus).
 */
async function fetchGroupCandidates(targets: OffRow[]): Promise<OffRow[]> {
    const terms: Prisma.Sql[] = [];
    const likes: Prisma.Sql[] = [];
    for (const t of targets) {
        const stem = prefilterStem(t.name ?? '');
        const kcal = rowKcal(t);
        if (!stem || kcal == null) continue;
        const like = `%${stem}%`;
        likes.push(Prisma.sql`lower(name) LIKE ${like}`);
        terms.push(Prisma.sql`(lower(s.name) LIKE ${like} AND abs(s.k - ${kcal}) <= ${GROUP_PREFILTER_KCAL_BAND})`);
    }
    if (terms.length === 0) return [];
    const rows = await db().$queryRaw<OffRow[]>(Prisma.sql`
        SELECT s.barcode, s.name, s."brandName", s."nutrientsPer100g", s."servingGrams",
               s."corruptReason", s."duplicateOfBarcode"
        FROM (
            SELECT barcode, name, "brandName", "nutrientsPer100g", "servingGrams",
                   "corruptReason", "duplicateOfBarcode",
                   CASE
                     WHEN jsonb_typeof("nutrientsPer100g"->'calories') = 'number' THEN ("nutrientsPer100g"->>'calories')::numeric
                     WHEN jsonb_typeof("nutrientsPer100g"->'energy')   = 'number' THEN ("nutrientsPer100g"->>'energy')::numeric
                     WHEN jsonb_typeof("nutrientsPer100g"->'kcal')     = 'number' THEN ("nutrientsPer100g"->>'kcal')::numeric
                     ELSE NULL END AS k
            FROM "OffFood"
            WHERE ${Prisma.join(likes, ' OR ')}
        ) s
        WHERE s.k IS NOT NULL AND (${Prisma.join(terms, ' OR ')})
    `);
    return rows.map(r => ({ ...r, servingGrams: r.servingGrams == null ? null : Number(r.servingGrams) }));
}

async function readCensus(): Promise<Record<string, number>> {
    const rows = await db().$queryRaw<Array<{ gen: string; n: bigint }>>(Prisma.sql`
        SELECT split_part("corruptReason", ':', 1) AS gen, count(*)::bigint AS n
        FROM "OffFood" WHERE "corruptReason" IS NOT NULL GROUP BY 1 ORDER BY 2 DESC
    `);
    const out: Record<string, number> = {};
    for (const r of rows) out[r.gen] = Number(r.n);
    return out;
}

async function readCacheRows(barcodes: string[]): Promise<Map<string, PlanEntry['affectedCacheRows']>> {
    const rows = await db().foodMapping.findMany({
        where: { offBarcode: { in: barcodes } },
        select: { normalizedForm: true, offBarcode: true, foodName: true, validatedBy: true },
    });
    const out = new Map<string, PlanEntry['affectedCacheRows']>();
    for (const r of rows) {
        if (!r.offBarcode) continue;
        const list = out.get(r.offBarcode) ?? [];
        list.push({ normalizedForm: r.normalizedForm, foodName: r.foodName, validatedBy: r.validatedBy });
        out.set(r.offBarcode, list);
    }
    return out;
}

/** One full read-only pass: live rows, live groups, census, affected cache. */
async function computeFresh(entries: HandMarkEntry[], handmarksSha: string): Promise<HandMarkPlan> {
    const unitBarcodes = entries.flatMap(e => handMarkUnits(e).map(u => u.barcode));
    const liveByBarcode = await fetchByBarcode(unitBarcodes);
    const targets = entries.map(e => liveByBarcode.get(e.barcode)).filter((r): r is OffRow => !!r);
    // A target with no usable stem is NOT scanned, and buildPlan must see that
    // as a gap rather than as an empty group.
    const scannable = targets.filter(t => prefilterStem(t.name ?? '') !== null && rowKcal(t) != null);
    const candidates = await fetchGroupCandidates(scannable);
    const groups = new Map<string, GroupClassification | null>();
    for (const e of entries) groups.set(e.barcode, null);
    for (const t of scannable) groups.set(t.barcode, classifyGroupCandidates(t, candidates));
    const groupBarcodes = [...groups.values()]
        .filter((g): g is GroupClassification => g !== null)
        .flatMap(g => blockingGroupBarcodes(g));
    return buildPlan({
        entries,
        handmarksSha256: handmarksSha,
        liveByBarcode,
        groups,
        cacheRows: await readCacheRows([...new Set([...unitBarcodes, ...groupBarcodes])]),
        censusBefore: await readCensus(),
        at: new Date().toISOString(),
    });
}

function printFresh(fresh: HandMarkPlan): void {
    console.log(`\nCensus before: ${JSON.stringify(fresh.censusBefore)}`);
    for (const e of fresh.entries) {
        console.log(`\n${e.barcode} [${e.class}] seed="${e.seed}"`);
        console.log(`  ${e.authoredReason}`);
        for (const u of e.units) {
            const tag = u.verdict === 'write'
                ? `WRITE ${u.reason}${u.servingDrift ? '  (serving mass drifted since authoring — reported, not blocking)' : ''}`
                : `SKIP  ${u.skip}${u.detail ? ` — ${u.detail}` : ''}`;
            console.log(`    ${u.basis.padEnd(15)} ${u.barcode.padEnd(26)} ${tag}`);
        }
        if (e.groupGaps.length) {
            console.log(`    ❌ GROUP INCOMPLETE — live members neither marked nor declined: ${e.groupGaps.join(', ')}`);
        }
        if (e.calorieTwins.length) {
            console.log(`    ℹ️  calorie-only twins (REVIEW, never written): ` +
                e.calorieTwins.map(t => `${t.barcode} "${t.name}"${t.brandName ? ` [${t.brandName}]` : ''} ${t.kcal}kcal`).join('; '));
        }
        for (const c of e.affectedCacheRows) {
            const tag = c.validatedBy === 'human-triage' ? '  ** HUMAN-TRIAGE **' : '';
            console.log(`    cache: ${c.normalizedForm} -> ${c.foodName ?? '?'} (${c.validatedBy ?? '-'})${tag}`);
        }
    }
    const skipCounts: Record<string, number> = {};
    for (const u of fresh.entries.flatMap(e => e.units)) if (u.verdict === 'skip') skipCounts[u.skip ?? 'unknown'] = (skipCounts[u.skip ?? 'unknown'] ?? 0) + 1;
    console.log(`\nWould write ${fresh.write.length} rows; skips ${JSON.stringify(skipCounts)}`);
    console.log(`Reason prefixes: ${fresh.reasonPrefixes.join(', ') || '(none)'}`);
    console.log(`Rollback (dry-run FIRST, it must report exactly ${fresh.write.length}):`);
    for (const p of fresh.reasonPrefixes) {
        console.log(`  scripts/mark-corrupt-off.ts --clear --clear-prefix ${p}          # dry run`);
        console.log(`  scripts/mark-corrupt-off.ts --clear --clear-prefix ${p} --apply  # revert`);
    }
}

async function main(): Promise<number> {
    const args = parseArgs(process.argv.slice(2));

    const refusal = refuseApply(args);
    if (refusal) { console.error(`❌ ${refusal}`); return 2; }

    let text: string;
    try { text = fs.readFileSync(args.handmarks, 'utf8'); } catch (e) {
        console.error(`❌ cannot read ${args.handmarks}: ${(e as Error).message}`);
        console.error('   This file IS the hand-authored population. A missing file is permanent data loss, not an empty batch.');
        return 2;
    }
    const parsed = parseHandmarks(text);
    if (!parsed.ok) { console.error(`❌ ${parsed.reason}`); return 2; }
    console.log(`Handmarks: ${parsed.entries.length} entries, ` +
        `${parsed.entries.reduce((n, e) => n + 1 + e.group.length, 0)} write units, sha256 ${parsed.sha256}`);

    const fresh = await computeFresh(parsed.entries, parsed.sha256);
    printFresh(fresh);

    if (args.emitPlan) {
        fs.writeFileSync(args.emitPlan, JSON.stringify(fresh, null, 2));
        console.log(`\nPlan written: ${args.emitPlan}`);
        console.log('Approval is a human reading the group expansion and saying yes to the SET.');
        if (fresh.entries.some(e => e.groupGaps.length)) {
            console.error('❌ this plan is NOT applyable: at least one entry has an incomplete group.');
            return 2;
        }
    }

    if (!args.apply) {
        console.log('\n[dry-run] nothing written.');
        return 0;
    }

    // ---- apply ----
    let set: ApplySet;
    let planSha: string | null = null;
    if (args.plan) {
        const pv = validatePlanText(fs.readFileSync(args.plan, 'utf8'));
        if (!pv.ok) { console.error(`❌ ${pv.reason}`); return 2; }
        planSha = pv.plan.handmarksSha256;
        set = reconcileWithPlan(pv.plan, fresh);
    } else {
        set = replaySet(fresh);
    }

    const mode = args.plan ? 'plan' : 'replay';
    const refusedWrite = refuseApplySet({ set, mode, planSha, fileSha: parsed.sha256 });
    if (refusedWrite) {
        console.error(`❌ REFUSING: ${refusedWrite}`);
        if (set.gaps.length) {
            console.error('   Marking a partial group lets the next dedupe-off-mark.ts run elect an unmarked twin.');
        }
        return 2;
    }
    if (mode === 'replay' && set.gaps.length) {
        console.error('⚠️  group members appeared that the handmarks file does not cover — those entries were NOT written:');
        for (const g of set.gaps) console.error(`   ${g.entry}: ${g.missing.join(', ')}`);
    }
    for (const d of set.droppedSincePlan) {
        console.log(`  dropped since plan: ${d.barcode} — ${d.skip}${d.detail ? ` (${d.detail})` : ''}`);
    }

    const written = await db().$executeRaw(buildMarkStatement(set.toWrite));
    console.log(`\nMarked ${written} rows (${set.toWrite.length} attempted; a gap means another instrument marked one first).`);
    console.log(`Census after: ${JSON.stringify(await readCensus())}`);

    const outPath = path.join('scripts', 'eval', 'results',
        `hand-corrupt-mark-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    // The results dir is gitignored, so a fresh worktree does not have it — and
    // this write runs AFTER the UPDATE, so an ENOENT here left the mark applied
    // with no receipt on disk (2026-08-14 plan §7 item 1; again 2026-08-25).
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({
        at: new Date().toISOString(),
        mode: args.plan ? 'plan' : 'replay',
        plan: args.plan ?? null,
        handmarksSha256: parsed.sha256,
        attempted: set.toWrite,
        written,
        droppedSincePlan: set.droppedSincePlan,
        gaps: set.gaps,
    }, null, 2));
    console.log(`Audit record: ${outPath}`);
    console.log('Next: scripts/purge-corrupt-typesense.ts to drop the marked docs from the live index.');

    return (set.gaps.length || set.droppedSincePlan.length) ? 3 : 0;
}

// Guarded so jest can import the pure decision surface above without this
// script connecting to the production database on import — the same
// require.main discipline dedupe-off-mark.ts needed before its election logic
// became testable. The disconnect happens BEFORE process.exit, because a
// .finally() chained after process.exit() never runs.
if (require.main === module) {
    main()
        .then(async code => {
            if (prismaSingleton) await prismaSingleton.$disconnect();
            process.exit(code);
        })
        .catch(async err => {
            console.error(err);
            if (prismaSingleton) await prismaSingleton.$disconnect();
            process.exit(1);
        });
}
