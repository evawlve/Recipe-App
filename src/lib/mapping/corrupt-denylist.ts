/**
 * Corrupt OFF Record Denylist — seam module (PR D pt3)
 *
 * Curated barcodes of OFF rows with triage-confirmed NUTRITION-corrupt panels
 * (2026-07-20 warm-batch triage): kJ-stored-as-kcal, per-serving panels stored
 * as per-100g, swapped/garbled macros. Identity-wrong-but-nutritionally-valid
 * records are deliberately NOT listed — those are repoint/write-guard
 * territory, and denylisting them would strand legitimate data.
 *
 * SEAM CONTRACT: the later corrupt-marking PR (OffFood corrupt column +
 * detector sweep) replaces ONLY this module's implementation — the JSON file
 * goes away and the lookup reads the DB-backed flag instead. Callers keep
 * calling isDenylistedOffRecord unchanged.
 *
 * Consumers (wired in a later sequenced step): the filter-stage block, the
 * rerank partition, and both fallback loops in map-ingredient-with-fallback —
 * always with an all-drop restore escape so corpus-gap queries cannot strand.
 */

import corruptOffDenylist from './data/corrupt-off-denylist.json';

const OFF_ID_PREFIX = 'off_';

/** Built once at module load — O(1) lookups thereafter. */
const DENYLISTED_BARCODES: ReadonlySet<string> = new Set(
    corruptOffDenylist.map((entry) => entry.barcode)
);

/**
 * True when the given food id refers to a triage-confirmed corrupt OFF record.
 * Accepts both the prefixed form ("off_0062020001849") and the bare barcode
 * ("0062020001849"). Non-OFF ids (e.g. "fdc_171705"), unknown barcodes, and
 * empty/malformed ids return false.
 */
export function isDenylistedOffRecord(foodId: string): boolean {
    if (!foodId) return false;
    const barcode = foodId.startsWith(OFF_ID_PREFIX)
        ? foodId.slice(OFF_ID_PREFIX.length)
        : foodId;
    return DENYLISTED_BARCODES.has(barcode);
}
