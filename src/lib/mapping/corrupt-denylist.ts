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
 *
 * ==========================================================================
 * TWO SOURCE FILES, ONE SET  (2026-08-12)
 * ==========================================================================
 * The lookup now reads `corrupt-off-denylist.json` UNION
 * `corrupt-off-handmarks.json`. They are different populations and the
 * difference is load-bearing:
 *
 *   corrupt-off-denylist.json  — the 2026-07-20 warm-batch triage. Rank-time
 *                                ONLY, deliberately: several of its records
 *                                are current golden SEARCH winners, so they
 *                                stay in the Typesense index on purpose (the
 *                                `collidesWithGolden` field records which).
 *   corrupt-off-handmarks.json — HAND-AUTHORED `OffFood.corruptReason` marks.
 *                                Every entry here is also meant to carry a
 *                                `hand-triage-<authoredAt>:<class>` mark in
 *                                the database, written by the replay script,
 *                                which removes the record from Typesense and
 *                                from the Postgres fallback as well.
 *
 * Why the handmarks are duplicated into code rather than read from the DB:
 * a hand-authored mark is the one curation population NOTHING re-derives. The
 * 2026-07-30 corpus refresh destroyed all 50 marks from the 2026-07-21 triage
 * batch and the re-derivation recovered none of them, because no detector rule
 * produces them (owner: `sync-docs/backend_integration_guide.md` §"The
 * hand-authored marks did not come back"). Detector marks are RE-DERIVED after
 * a refresh — never replayed — because a refresh can deliver a CORRECTED panel
 * and a stale mark would suppress a row OFF has since fixed. Hand marks cannot
 * be re-derived at all, so they must be replayed from an authored record, and
 * that record has to live somewhere a corpus truncate cannot reach. This file's
 * sibling JSON is inside the git repo, so it survives by construction — the
 * same property `corrupt-off-denylist.json` has, which is why that list never
 * appeared in the refresh's blast radius while every `OffFood` curation column
 * did.
 *
 * The union therefore buys one thing the DB layer structurally cannot: rank-time
 * suppression during the window between a refresh and the replay — precisely the
 * window in which the 2026-07-30 loss went unnoticed for nine days.
 *
 * WHAT THIS FILE IS NOT. It is not the marking path and it is not a verdict.
 * A handmark entry is an ASSERTION about a row, and the replay script must
 * re-run that assertion against the live row (`observed` vs the live panel)
 * before writing anything — never trust the file's stored conclusion. That gate
 * lives with the replay script, deliberately outside this module: this module
 * only answers "is this id on the list".
 *
 * COST, and why this is a code-resident SET and not a DB read. Both files are
 * static imports resolved at build time and folded into ONE `Set<string>` at
 * module load. `isDenylistedOffRecord` stays a single `Set.has` — no I/O, no DB
 * round trip, no per-request work beyond the hash lookup it already did.
 * Measured 2026-08-12 on a 400-query frozen-pool replay (`winner-diff replay`,
 * gate-backstop, pool mean 27.6 candidates): **11,995 calls over 399 rows =
 * 30.1 calls per mapper line**, and `Set.has` costs 54-59 ns at BOTH set sizes
 * (25 before, 44 after) — a difference inside run-to-run variance. The union
 * adds one 7,955-byte `JSON.parse`, ~9 us, once per process. A per-candidate
 * database read on that path would be ~30 round trips per line instead, on the
 * hot rank path, for a set of a few dozen barcodes that changes by hand a few
 * times a year — and it would reintroduce exactly the corpus dependency this
 * file exists to escape.
 */

import corruptOffDenylist from './data/corrupt-off-denylist.json';
import corruptOffHandmarks from './data/corrupt-off-handmarks.json';

const OFF_ID_PREFIX = 'off_';

/**
 * DELIBERATELY NARROWER THAN THE FILE. `corrupt-mark.ts` owns the hand-mark
 * schema (`HandMarkEntry`, `HandMarkGroupMember`, `HandMarkGroupExclusion`) and
 * the `decideHandMark()` re-verification gate that reads `observed`. This
 * module needs one thing from each entry — which barcodes are suppressed — so
 * it declares only that. Structural typing lets the richer records assign to
 * these, and keeping the surface small means an edit to the evidence fields
 * cannot break the rank-time lookup. Once the replay-script PR lands, prefer
 * importing `HandMarkEntry` from `corrupt-mark.ts` over widening this.
 */
export interface CorruptHandMarkGroupMember {
    readonly barcode: string;
    /** 'duplicate-group' | 'panel-twin' — owned by corrupt-mark.ts. */
    readonly basis: string;
}

/** A group member the author looked at and DECLINED to mark. It must NOT be
 *  suppressed here either: an exclusion is a judgement that the row is a
 *  legitimate different product that merely shares a kcal value. */
export interface CorruptHandMarkGroupExclusion {
    readonly barcode: string;
    readonly why: string;
}

/**
 * One hand-authored corrupt mark, reduced to what rank time needs. `class` is
 * one of CORRUPT_HANDMARK_CLASSES and is typed `string` here only because
 * `resolveJsonModule` widens JSON string literals; the membership assertion is
 * a unit test, not the compiler.
 *
 * `group` is NOT decoration. `isBetterRepresentative()` in
 * `scripts/dedupe-off-mark.ts` ranks a clean row ABOVE a corrupt-marked one, so
 * marking the elected representative of a same-panel duplicate group makes the
 * next dedupe run elect an UNMARKED twin and clear its `duplicateOfBarcode` —
 * putting the identical bad panel straight back into the sync's WHERE. And a
 * `panel-twin` under a different brand was never in that group to begin with,
 * yet carries the identical bad VALUE, so suppressing only the target hands the
 * re-resolution straight to it. That is the 2026-08-08 eviction no-op one layer
 * up. The unit is the group, at the DB write and here.
 */
export interface CorruptHandMark {
    readonly barcode: string;
    readonly class: string;
    readonly seed: string;
    readonly reason: string;
    readonly source: string;
    readonly authoredAt: string;
    readonly group: readonly CorruptHandMarkGroupMember[];
    readonly groupExclusions?: readonly CorruptHandMarkGroupExclusion[];
}

/** The three defect classes a hand mark may claim. Asserted by unit test. */
export const CORRUPT_HANDMARK_CLASSES: readonly string[] = ['panel', 'serving', 'identity'];

/** The authored hand-mark record, exactly as the replay script reads it. */
export const CORRUPT_HANDMARKS: readonly CorruptHandMark[] = corruptOffHandmarks;

/**
 * Every barcode a hand mark covers: the authored barcode plus its co-marked
 * group members. `groupExclusions` are deliberately absent — they are the rows
 * the author looked at and declined.
 */
export const CORRUPT_HANDMARK_BARCODES: readonly string[] = CORRUPT_HANDMARKS
    .flatMap((entry) => [entry.barcode, ...entry.group.map((member) => member.barcode)]);

/**
 * Built once at module load — O(1) lookups thereafter. Union of the two
 * populations above; a barcode present in neither behaves exactly as it did
 * before the handmarks file existed, which is what makes this additive.
 */
const DENYLISTED_BARCODES: ReadonlySet<string> = new Set<string>([
    ...corruptOffDenylist.map((entry) => entry.barcode),
    ...CORRUPT_HANDMARK_BARCODES,
]);

/** Strip the `off_` prefix if present. Non-OFF ids are returned unchanged. */
function toBarcode(foodId: string): string {
    return foodId.startsWith(OFF_ID_PREFIX) ? foodId.slice(OFF_ID_PREFIX.length) : foodId;
}

/**
 * True when the given food id refers to a triage-confirmed corrupt OFF record.
 * Accepts both the prefixed form ("off_0062020001849") and the bare barcode
 * ("0062020001849"). Non-OFF ids (e.g. "fdc_171705"), unknown barcodes, and
 * empty/malformed ids return false.
 */
export function isDenylistedOffRecord(foodId: string): boolean {
    if (!foodId) return false;
    return DENYLISTED_BARCODES.has(toBarcode(foodId));
}

/**
 * Which population suppressed this id, or null when it is not suppressed.
 * Diagnostic only — nothing on the rank-time path calls it, because the answer
 * the pipeline needs is the boolean above. Exists so the replay script and the
 * tests can tell a handmark from a 2026-07-20 triage entry without duplicating
 * the union.
 */
export function denylistSourceFor(foodId: string): 'triage-denylist' | 'handmark' | null {
    if (!foodId) return null;
    const barcode = toBarcode(foodId);
    if (corruptOffDenylist.some((entry) => entry.barcode === barcode)) return 'triage-denylist';
    if (CORRUPT_HANDMARK_BARCODES.includes(barcode)) return 'handmark';
    return null;
}
