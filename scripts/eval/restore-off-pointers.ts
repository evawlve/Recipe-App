/**
 * restore-off-pointers.ts — put FoodMapping.offBarcode back after a --fresh OFF re-ingest.
 *
 * WHY THIS EXISTS: `ingest-off.ts --fresh` runs
 *   UPDATE "FoodMapping" SET "offBarcode" = NULL WHERE "offBarcode" IS NOT NULL
 * before `DELETE FROM "OffFood"`. That is not the pipeline discarding knowledge —
 * it is satisfying the real FK `FoodMapping.offBarcode -> OffFood.barcode`
 * (schema.prisma, `offFood` relation) so the delete can proceed. Measured on the
 * live DB 2026-07-30: 2,854 of 3,508 cache rows (81%) carry an offBarcode, so a
 * refresh silently strips the OFF pointer off four fifths of the cache and leaves
 * those rows with source='openfoodfacts' and nothing to hydrate from.
 *
 * Barcode is Open Food Facts' STABLE primary key — the same product keeps it
 * across exports — so the pointers are recoverable from a pre-refresh snapshot
 * for every product that still exists in the new corpus. That is the whole job.
 *
 * The residue is real and is the point of the report: a product OFF has actually
 * delisted cannot be repointed, and its cache row is now a broken
 * openfoodfacts-sourced row with no record behind it. Those keys are PRINTED as a
 * worklist. This script never deletes them — evicting cache rows is
 * `_evict_rows.ts`'s job and its own five-step procedure.
 *
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/eval/restore-off-pointers.ts \
 *     <pre-refresh-snapshot.json> [--execute]
 *
 * The snapshot is a `_snap_foodmapping.ts` file taken IMMEDIATELY BEFORE the
 * destructive ingest (Role B, restore anchor — see that script's header).
 *
 * Dry run by default, like every other cache-touching script here.
 *
 *   exit 0 = every snapshot pointer restored, nothing left over
 *   exit 3 = completed, but >=1 pointer was NOT restored — the printed lists are
 *            the reconciliation worklist (delisted products, keys evicted since,
 *            keys a live write already repointed)
 *   exit 2 = refused / error — INCLUDING the cases where the run would otherwise
 *            look like a clean no-op (see refusals below)
 *
 * REFUSALS, all of which would otherwise encode absence-of-restore as success
 * (mapping playbook §11 class B):
 *   - a snapshot holding zero offBarcode pointers: it is not a valid restore
 *     anchor for this operation, and "restored 0/0" would exit 0 and read green;
 *   - asking OffFood about N>0 barcodes and matching zero: that is an empty or
 *     still-loading corpus, not a corpus where every product was delisted. It
 *     would mark all 2,854 orphaned and restore nothing, reported as expected
 *     residue.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { loadSnapshot, type SnapshotRow } from './_evict_rows';

// ---------------------------------------------------------------------------
// Pure, unit-testable pieces (scripts/eval/__tests__/restore-off-pointers.test.ts)
// ---------------------------------------------------------------------------

export interface OffPointer {
    normalizedForm: string;
    offBarcode: string;
}

/**
 * The (key -> barcode) pairs a snapshot can restore. Rows without a pointer are
 * not part of this operation at all: FatSecret- and FDC-sourced rows never had
 * an offBarcode, and `--fresh` does not touch them.
 */
export function extractOffPointers(rows: SnapshotRow[]): OffPointer[] {
    const out: OffPointer[] = [];
    for (const r of rows) {
        const bc = r.offBarcode;
        if (typeof bc === 'string' && bc.trim() !== '') {
            out.push({ normalizedForm: r.normalizedForm, offBarcode: bc });
        }
    }
    return out;
}

export interface PointerPartition {
    /** live row exists, offBarcode is NULL, and the barcode survived the re-ingest */
    restorable: OffPointer[];
    /** the product is gone from the new corpus — repointing it would recreate an FK violation */
    orphaned: OffPointer[];
    /** the key no longer exists in FoodMapping (evicted or re-keyed since the snapshot) */
    missingRow: OffPointer[];
    /** a live write already set a pointer — never clobbered, same rule as _restore_rows.ts */
    alreadySet: OffPointer[];
}

/**
 * Pure: the caller supplies live state. `live` maps key -> current offBarcode
 * (null when the column is NULL); a key absent from the map does not exist.
 * `survivingBarcodes` is the set of snapshot barcodes still present in OffFood.
 */
export function partitionPointerRestore(
    pointers: OffPointer[],
    live: Map<string, string | null>,
    survivingBarcodes: Set<string>,
): PointerPartition {
    const p: PointerPartition = { restorable: [], orphaned: [], missingRow: [], alreadySet: [] };
    for (const ptr of pointers) {
        if (!live.has(ptr.normalizedForm)) p.missingRow.push(ptr);
        else if (live.get(ptr.normalizedForm) !== null) p.alreadySet.push(ptr);
        else if (!survivingBarcodes.has(ptr.offBarcode)) p.orphaned.push(ptr);
        else p.restorable.push(ptr);
    }
    return p;
}

/**
 * Matching zero barcodes out of a non-empty request is indistinguishable, in the
 * partition, from "OFF delisted every single product" — and that reading exits 3
 * with a tidy report instead of stopping the operator. Refuse instead.
 */
export function corpusLooksEmpty(requested: number, matched: number): boolean {
    return requested > 0 && matched === 0;
}

/** Anything not restored is residue, and residue is its own outcome — never success. */
export function pointerExitCode(p: PointerPartition): number {
    return p.orphaned.length + p.missingRow.length + p.alreadySet.length > 0 ? 3 : 0;
}

/** Every unrestored key is printed: the lists ARE the reconciliation worklist. */
export function residueReportLines(p: PointerPartition): string[] {
    const lines: string[] = [];
    if (p.orphaned.length) {
        lines.push(
            `NOT RESTORED — ${p.orphaned.length} product(s) no longer in the OFF corpus (delisted upstream).`,
            '  These cache rows are now source=openfoodfacts with no record behind them. Triage with _evict_rows.ts:',
        );
        for (const o of p.orphaned) lines.push(`  ORPHANED ${JSON.stringify(o.normalizedForm)} -> ${o.offBarcode}`);
    }
    if (p.missingRow.length) {
        lines.push(`NOT RESTORED — ${p.missingRow.length} key(s) absent from FoodMapping (evicted or re-keyed since the snapshot):`);
        for (const m of p.missingRow) lines.push(`  MISSING ${JSON.stringify(m.normalizedForm)}`);
    }
    if (p.alreadySet.length) {
        // Not necessarily live traffic: a snapshot taken when the pointers were
        // still intact (a rehearsal) lands every row here too. State what is
        // observed — the column is set — not an inferred cause.
        lines.push(`NOT RESTORED — ${p.alreadySet.length} key(s) already carry an offBarcode (never clobbered):`);
        for (const a of p.alreadySet) lines.push(`  ALREADY SET ${JSON.stringify(a.normalizedForm)}`);
    }
    return lines;
}

// ---------------------------------------------------------------------------

const CHUNK = 1000;

function chunk<T>(xs: T[], n: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
    return out;
}

async function main(): Promise<number> {
    const args = process.argv.slice(2);
    const execute = args.includes('--execute');
    const snapPath = args.find(a => !a.startsWith('--'));
    if (!snapPath) throw new Error('usage: restore-off-pointers.ts <pre-refresh-snapshot.json> [--execute]');

    const parsed = loadSnapshot(snapPath);
    if (!parsed.ok) { console.error(`REFUSED: ${parsed.reason}`); return 2; }
    const snap = parsed.snap;

    const pointers = extractOffPointers(snap.rows);
    console.log(`snapshot: ${snap.rows.length} rows, taken ${snap.takenAt}`);
    console.log(`snapshot: ${pointers.length} carry an offBarcode`);
    if (pointers.length === 0) {
        console.error('REFUSED: snapshot holds no offBarcode pointers — wrong file, or taken after the ingest already NULLed them.');
        return 2;
    }

    const prisma = new PrismaClient();
    try {
        // Live FoodMapping state for exactly the snapshot's keys.
        const live = new Map<string, string | null>();
        for (const part of chunk(pointers.map(p => p.normalizedForm), CHUNK)) {
            const rows = await prisma.foodMapping.findMany({
                where: { normalizedForm: { in: part } },
                select: { normalizedForm: true, offBarcode: true },
            });
            for (const r of rows) live.set(r.normalizedForm, r.offBarcode);
        }

        // Which snapshot barcodes survived the re-ingest.
        const wanted = [...new Set(pointers.map(p => p.offBarcode))];
        const surviving = new Set<string>();
        for (const part of chunk(wanted, CHUNK)) {
            const rows = await prisma.offFood.findMany({
                where: { barcode: { in: part } },
                select: { barcode: true },
            });
            for (const r of rows) surviving.add(r.barcode);
        }
        console.log(`corpus: ${surviving.size}/${wanted.length} snapshot barcodes present in the new OffFood`);
        if (corpusLooksEmpty(wanted.length, surviving.size)) {
            console.error('REFUSED: zero of the snapshot barcodes are in OffFood — the corpus is empty or still ingesting.');
            console.error('         Proceeding would report every pointer as an upstream delisting and restore nothing.');
            return 2;
        }

        const p = partitionPointerRestore(pointers, live, surviving);
        console.log(`\nrestorable : ${p.restorable.length}`);
        console.log(`orphaned   : ${p.orphaned.length}`);
        console.log(`missing row: ${p.missingRow.length}`);
        console.log(`already set: ${p.alreadySet.length}`);

        if (!execute) {
            console.log('\nDRY RUN — nothing written. Re-run with --execute to apply.');
        } else {
            let applied = 0;
            for (const part of chunk(p.restorable, CHUNK)) {
                await prisma.$transaction(
                    part.map(ptr => prisma.foodMapping.updateMany({
                        // offBarcode: null in the predicate keeps this idempotent and
                        // race-safe: a key repointed between the read and this write is
                        // not overwritten, matching _restore_rows.ts's never-clobber rule.
                        where: { normalizedForm: ptr.normalizedForm, offBarcode: null },
                        data: { offBarcode: ptr.offBarcode },
                    })),
                );
                applied += part.length;
            }
            console.log(`\nrestored ${applied} offBarcode pointer(s).`);
        }

        const residue = residueReportLines(p);
        if (residue.length) { console.log(''); for (const l of residue) console.log(l); }
        return pointerExitCode(p);
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main()
        .then(c => process.exit(c))
        .catch(e => { console.error(e); process.exit(2); });
}
