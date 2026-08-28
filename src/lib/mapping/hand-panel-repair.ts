/**
 * hand-panel-repair.ts — the decision half of the hand-authored PANEL RESCALE.
 *
 * WHY THIS EXISTS. `corrupt-mark.ts` already names this class:
 * `rejectPanelInflatedServing()` documents "a per-SERVING panel stored in the
 * per-100g fields". Everything we own for that class MARKS the row, i.e.
 * deletes it from the corpus. Marking is the right instrument when the true
 * panel is unknowable. It is the WRONG instrument when the factor is exactly
 * determinable, because the row is not junk — it is a correct panel written on
 * the wrong basis, and suppressing it hands the query to whatever ranks next.
 *
 * Measured precedent (mobile sync-docs/reports/2026-08-28_batch6-one-write-and-seven-holds.md §2b):
 * `bun cha` resolved to the exact-name brandless OFF row for 19 days; our own
 * 2026-08-14 hand mark removed it, and every draw since has billed a char siu
 * BAO instead. The mark's own authored `reason` had already identified the
 * factor. The diagnosis was right and the instrument was wrong.
 *
 * WHAT LICENSES A REPAIR HERE — AND WHAT DOES NOT.
 * The class-defining factor is servingGrams/100: a per-serving panel divided by
 * S/100 is the per-100g panel. That formula is the exact INVERSE of
 * scripts/eval/repair-panel-scale-divided.ts, whose class is the OFF chain
 * import dividing a per-100g panel by S/100. The two must never be confused;
 * applying either to the other's rows doubles the error.
 *
 * The formula alone is NOT sufficient evidence. "The panel is impossible and
 * rescaling makes it plausible" is true of 162 corpus rows measured 2026-08-28
 * (77 unmarked + 85 already marked, servingGrams > 100) and it is a
 * *consequence* of the arithmetic, not evidence about any one row. So every
 * entry here REQUIRES an independent panel witness: another live row whose
 * stored per-100g panel already equals the repaired panel. That is a
 * measurement no rescale can manufacture, it is re-run against the LIVE witness
 * at replay time, and it is why this module cannot be pointed at the class
 * without new evidence per row.
 *
 * A witness is a claim about the PANEL, never about identity. The two rows may
 * be different products (bun cha: a pork dish and a chicken variant) — what the
 * witness establishes is the BASIS the numbers are written on.
 *
 * REPLAY, NOT RESTORE. The authored record lives beside
 * corrupt-off-handmarks.json in src/lib/mapping/ — git-tracked, so it survives
 * a corpus refresh, and NOT under any `data/` directory, which the box's
 * .stignore matches at every depth (see replay-hand-corrupt-marks.ts's header
 * for the measurement). Every entry carries the MEASUREMENTS it was authored
 * from; decideHandPanelRepair() re-runs the comparison against the live row and
 * the live witness before anything is written, and a row that has moved is
 * SKIPPED and reported, never repaired. A refresh that delivers a CORRECTED
 * panel therefore stops the replay instead of doubling it.
 *
 * NO CONSTANT IS RE-TUNED. Every threshold below is imported from
 * corrupt-mark.ts, so the repair path and the mark path cannot disagree about
 * what a plausible panel or a moved row is.
 */

import {
    ATWATER_CONSISTENT_TOL,
    HAND_MARK_PANEL_TOL,
    HAND_MARK_SERVING_TOL,
    MAX_COMPONENT_100G,
    MAX_KCAL_100G,
    MAX_MACRO_SUM_100G,
    MAX_SODIUM_100G,
    SERVING_WINDOW_MAX_G,
    SERVING_WINDOW_MIN_G,
    FAMILY_DEAD_ZONE_MAX_G,
    FAMILY_DEAD_ZONE_MIN_G,
} from './corrupt-mark';
import { normalizeNameKey } from '../search/dedupe-candidates';

/** The only class this module repairs. Named, not boolean, so a second class
 *  cannot be added by widening a flag. */
export type HandPanelRepairClass = 'serving-panel';

/** Panel keys that scale linearly with the basis mass. A live panel carrying
 *  any key NOT in this set is REFUSED rather than partially rescaled: a field
 *  whose scaling behaviour we have not reasoned about must not be silently
 *  divided, and must not be silently left behind on a different basis either. */
export const SCALING_PANEL_FIELDS = new Set([
    'calories', 'energy', 'kcal', 'kj',
    'protein', 'fat', 'carbs', 'carbohydrates',
    'fiber', 'fibre', 'sugars', 'sugar',
    'sodium', 'salt', 'saturatedFat', 'transFat', 'cholesterol',
    'potassium', 'calcium', 'iron', 'vitaminA', 'vitaminC', 'vitaminD',
]);

/** Witness agreement: 1% of the witness value plus a 0.01 floor for values
 *  near zero. Tight on purpose — the witness is the whole licence, so it has to
 *  be an agreement rather than a resemblance. */
export const WITNESS_REL_TOL = 0.01;
export const WITNESS_ABS_TOL = 0.01;

export interface HandPanelObservation {
    /** Row name AS STORED at authoring time; compared by normalizeNameKey. */
    name: string;
    /** servingGrams AS STORED — this IS the repair factor's denominator. */
    servingGrams: number;
    /** The stored per-100g panel AS OBSERVED, every field. */
    panel: Record<string, number>;
}

export interface HandPanelWitness {
    barcode: string;
    /** Prose: why this row's panel pins the basis. Never parsed. */
    note: string;
}

export interface HandPanelRepairEntry {
    barcode: string;
    class: HandPanelRepairClass;
    /** The measured-to-reach replay phrase, verbatim. Not a verdict input — it
     *  is what a verification draw must send. */
    seed: string;
    /** Prose: what the human judged, and how. Never parsed. */
    reason: string;
    source: string;
    /** ISO date. Also the rollback selector for anything this batch wrote. */
    authoredAt: string;
    /** The corruptReason this repair CLEARS, verbatim, or null when the row
     *  carries none. A live value that is neither this string nor null means
     *  another writer has since marked the row: SKIP. */
    clearsMark: string | null;
    observed: HandPanelObservation;
    /** MANDATORY. See the header: the formula is not evidence. */
    witness: HandPanelWitness;
}

export interface HandPanelLiveRow {
    barcode: string;
    name: string;
    corruptReason: string | null;
    servingGrams: number | null;
    panel: Record<string, number>;
}

export type HandPanelSkip =
    | 'entry_invalid'
    | 'row_missing'
    | 'name_moved'
    | 'serving_moved'
    | 'panel_moved'
    | 'mark_moved'
    | 'unknown_panel_field'
    | 'serving_out_of_window'
    | 'before_not_atwater_consistent'
    | 'witness_missing'
    | 'witness_field_set_differs'
    | 'witness_mismatch'
    | 'guard_refused';

export type HandPanelDecision =
    | { repair: true; panel: Record<string, number>; clearsMark: string | null }
    | { repair: false; skip: HandPanelSkip; detail?: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && isFinite(v);
}

/** Pull the panel out of a raw OffFood row so the decision function stays pure
 *  and free of JSON-shape knowledge. Non-numeric and non-finite values are
 *  dropped here and therefore become an unknown-field refusal only if they
 *  were numeric at authoring time — a null micro is not a corruption signal. */
export function readRepairLiveRow(
    row: { barcode: string; name: string | null; corruptReason: string | null; nutrientsPer100g: unknown; servingGrams: number | null }
): HandPanelLiveRow {
    const raw = (row.nutrientsPer100g && typeof row.nutrientsPer100g === 'object')
        ? row.nutrientsPer100g as Record<string, unknown>
        : {};
    const panel: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
        if (isFiniteNumber(v)) panel[k] = v;
    }
    return {
        barcode: row.barcode,
        name: row.name ?? '',
        corruptReason: row.corruptReason,
        servingGrams: row.servingGrams,
        panel,
    };
}

/** kcal the panel's own macros imply. Local to the panel shape used here; the
 *  arithmetic is corrupt-mark.ts's atwaterKcal. */
function atwaterOf(panel: Record<string, number>): number {
    return 4 * (panel.protein ?? 0) + 4 * (panel.carbs ?? panel.carbohydrates ?? 0) + 9 * (panel.fat ?? 0);
}

function kcalOf(panel: Record<string, number>): number | null {
    const v = panel.calories ?? panel.energy ?? panel.kcal;
    return isFiniteNumber(v) ? v : null;
}

/**
 * The repair itself: a per-SERVING panel divided back onto a 100 g basis.
 * Pure, total, and the ONLY place the factor is computed. Callers must never
 * copy an "after" value out of a plan file — they recompute it from the live
 * row through this function, so a hand-edited plan cannot reach the database.
 */
export function rescaleServingPanelTo100g(
    panel: Record<string, number>,
    servingGrams: number
): Record<string, number> {
    const factor = servingGrams / 100;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(panel)) out[k] = v / factor;
    return out;
}

function withinTol(a: number, b: number, tol: number): boolean {
    return Math.abs(a - b) <= tol;
}

function witnessAgrees(a: number, b: number): boolean {
    return Math.abs(a - b) <= WITNESS_ABS_TOL + WITNESS_REL_TOL * Math.abs(b);
}

/**
 * The output plausibility guard. One-sided ceilings only, exactly as
 * corrupt-mark.ts defines them — and note the asymmetry that makes this safe
 * here and unsafe in the divided-panel repair: this repair DIVIDES, so it can
 * only move a panel down. A ceiling guard cannot catch a bad shrink, which is
 * precisely why the witness above is mandatory rather than decorative.
 */
export function guardRepairedPanel(panel: Record<string, number>): string | null {
    const kcal = kcalOf(panel);
    if (kcal == null) return 'no_calories';
    if (!(kcal > 0)) return 'calories_not_positive';
    if (kcal > MAX_KCAL_100G) return `calories_above_${MAX_KCAL_100G}`;

    for (const [k, v] of Object.entries(panel)) {
        if (v < 0) return `negative_${k}`;
    }

    const macroSum = (panel.protein ?? 0) + (panel.fat ?? 0) + (panel.carbs ?? panel.carbohydrates ?? 0);
    if (macroSum > MAX_MACRO_SUM_100G) return `macro_sum_above_${MAX_MACRO_SUM_100G}`;

    for (const k of ['protein', 'fat', 'carbs', 'carbohydrates', 'fiber', 'fibre', 'sugars', 'sugar']) {
        const v = panel[k];
        if (isFiniteNumber(v) && v > MAX_COMPONENT_100G) return `${k}_above_${MAX_COMPONENT_100G}`;
    }

    const sodium = panel.sodium;
    if (isFiniteNumber(sodium) && sodium > MAX_SODIUM_100G) return `sodium_above_${MAX_SODIUM_100G}`;

    return null;
}

function entryInvalidReason(entry: HandPanelRepairEntry): string | null {
    if (!entry || typeof entry !== 'object') return 'not_an_object';
    if (!entry.barcode || typeof entry.barcode !== 'string') return 'barcode';
    if (entry.class !== 'serving-panel') return 'class';
    if (!entry.seed || typeof entry.seed !== 'string') return 'seed';
    if (!entry.reason || typeof entry.reason !== 'string') return 'reason';
    if (!entry.source || typeof entry.source !== 'string') return 'source';
    if (!ISO_DATE.test(entry.authoredAt ?? '')) return 'authoredAt';
    if (entry.clearsMark !== null && typeof entry.clearsMark !== 'string') return 'clearsMark';
    const o = entry.observed;
    if (!o || typeof o !== 'object') return 'observed';
    if (typeof o.name !== 'string' || !o.name) return 'observed.name';
    if (!isFiniteNumber(o.servingGrams)) return 'observed.servingGrams';
    if (!o.panel || typeof o.panel !== 'object') return 'observed.panel';
    if (Object.keys(o.panel).length === 0) return 'observed.panel_empty';
    for (const [k, v] of Object.entries(o.panel)) {
        if (!isFiniteNumber(v)) return `observed.panel.${k}`;
    }
    const w = entry.witness;
    if (!w || typeof w !== 'object') return 'witness';
    if (!w.barcode || typeof w.barcode !== 'string') return 'witness.barcode';
    if (w.barcode === entry.barcode) return 'witness.barcode_is_target';
    if (!w.note || typeof w.note !== 'string') return 'witness.note';
    return null;
}

/**
 * Re-run the human's comparison against the live corpus and decide.
 *
 * `witness` is the LIVE witness row, read at replay time — never a stored copy.
 * Passing the authored numbers here would make the check a tautology.
 */
export function decideHandPanelRepair(
    entry: HandPanelRepairEntry,
    live: HandPanelLiveRow | null | undefined,
    witness: HandPanelLiveRow | null | undefined
): HandPanelDecision {
    const invalid = entryInvalidReason(entry);
    if (invalid) return { repair: false, skip: 'entry_invalid', detail: invalid };
    if (!live) return { repair: false, skip: 'row_missing' };

    // The mark the entry expects to clear must be exactly what is on the row.
    // null-for-null is fine (a repair that does not clear anything); anything
    // else means another writer has touched the row since authoring.
    if ((live.corruptReason ?? null) !== (entry.clearsMark ?? null)) {
        return { repair: false, skip: 'mark_moved', detail: `live=${live.corruptReason ?? 'null'} authored=${entry.clearsMark ?? 'null'}` };
    }

    if (normalizeNameKey(live.name) !== normalizeNameKey(entry.observed.name)) {
        return { repair: false, skip: 'name_moved', detail: `live=${live.name}` };
    }

    if (live.servingGrams == null || !withinTol(live.servingGrams, entry.observed.servingGrams, HAND_MARK_SERVING_TOL)) {
        return { repair: false, skip: 'serving_moved', detail: `live=${live.servingGrams ?? 'null'}` };
    }

    // The dead zone is not pedantry: at servingGrams ~100 the factor is ~1, so
    // the "repair" is a no-op that would still clear a mark. Refuse it.
    if (
        live.servingGrams < SERVING_WINDOW_MIN_G ||
        live.servingGrams > SERVING_WINDOW_MAX_G ||
        (live.servingGrams >= FAMILY_DEAD_ZONE_MIN_G && live.servingGrams <= FAMILY_DEAD_ZONE_MAX_G)
    ) {
        return { repair: false, skip: 'serving_out_of_window', detail: `${live.servingGrams}` };
    }

    const liveKeys = Object.keys(live.panel).sort();
    const authoredKeys = Object.keys(entry.observed.panel).sort();
    if (liveKeys.join(',') !== authoredKeys.join(',')) {
        return { repair: false, skip: 'panel_moved', detail: `fields live=[${liveKeys}] authored=[${authoredKeys}]` };
    }
    for (const k of liveKeys) {
        if (!SCALING_PANEL_FIELDS.has(k)) {
            return { repair: false, skip: 'unknown_panel_field', detail: k };
        }
        if (!withinTol(live.panel[k], entry.observed.panel[k], HAND_MARK_PANEL_TOL)) {
            return { repair: false, skip: 'panel_moved', detail: `${k} live=${live.panel[k]} authored=${entry.observed.panel[k]}` };
        }
    }

    // The BEFORE panel must be internally coherent. A whole-panel basis slip
    // preserves the Atwater identity exactly; a single corrupt field breaks it.
    // Checked before the repair because dividing every field by one factor
    // preserves the ratio, so the same check AFTER would be vacuous.
    const beforeKcal = kcalOf(live.panel);
    if (beforeKcal == null || beforeKcal <= 0) {
        return { repair: false, skip: 'before_not_atwater_consistent', detail: 'no_calories' };
    }
    const beforeAtwater = atwaterOf(live.panel);
    if (Math.abs(beforeAtwater - beforeKcal) > ATWATER_CONSISTENT_TOL * beforeKcal) {
        return { repair: false, skip: 'before_not_atwater_consistent', detail: `atwater=${beforeAtwater.toFixed(1)} kcal=${beforeKcal}` };
    }

    const after = rescaleServingPanelTo100g(live.panel, live.servingGrams);

    if (!witness) return { repair: false, skip: 'witness_missing', detail: entry.witness.barcode };
    const witnessKeys = Object.keys(witness.panel).sort();
    if (witnessKeys.join(',') !== liveKeys.join(',')) {
        return { repair: false, skip: 'witness_field_set_differs', detail: `witness=[${witnessKeys}]` };
    }
    for (const k of liveKeys) {
        if (!witnessAgrees(after[k], witness.panel[k])) {
            return {
                repair: false,
                skip: 'witness_mismatch',
                detail: `${k} repaired=${after[k]} witness=${witness.panel[k]}`,
            };
        }
    }

    const guard = guardRepairedPanel(after);
    if (guard) return { repair: false, skip: 'guard_refused', detail: guard };

    return { repair: true, panel: after, clearsMark: entry.clearsMark };
}
